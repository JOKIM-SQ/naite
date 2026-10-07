/**
 * Robust cell colors followed by deterministic weighted median-cut quantization.
 * At most 16 source samples per cell: no full-resolution convolution or dithering.
 * @param {Uint8ClampedArray} pixels
 * @param {number} width
 * @param {number} height
 * @param {{width:number,height:number}} grid
 */
export function stylizeGrid(pixels, width, height, grid) {
  const data = new Uint8ClampedArray(grid.width * grid.height * 4);
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const nx = Math.min(4, Math.max(1, Math.floor(width / grid.width)));
    const ny = Math.min(4, Math.max(1, Math.floor(height / grid.height)));
    const samples = [];
    let alpha = 0;
    for (let sy = 0; sy < ny; sy++) for (let sx = 0; sx < nx; sx++) {
      const px = Math.min(width - 1, Math.floor((x + (sx + .5) / nx) * width / grid.width));
      const py = Math.min(height - 1, Math.floor((y + (sy + .5) / ny) * height / grid.height));
      const offset = (py * width + px) * 4;
      alpha += pixels[offset + 3];
      if (pixels[offset + 3]) samples.push([...pixels.subarray(offset, offset + 4)]);
    }
    const offset = (y * grid.width + x) * 4;
    if (!samples.length) continue;
    data[offset + 3] = Math.max(1, Math.round(alpha / (nx * ny)));
    for (let channel = 0; channel < 3; channel++) {
      samples.sort((a,b) => a[channel] - b[channel]);
      let accumulated = 0;
      for (const sample of samples) {
        accumulated += sample[3];
        if (accumulated >= alpha / 2) { data[offset + channel] = sample[channel]; break; }
      }
    }
  }

  // Hidden RGB never contributes to the palette. Alpha weights translucent colors.
  const histogram = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    const entry = histogram.get(key);
    if (entry) entry.weight += data[i + 3];
    else histogram.set(key, { rgb: [data[i], data[i + 1], data[i + 2]], weight: data[i + 3], key });
  }
  if (histogram.size <= 32) return { data, ...grid };
  const describe = entries => {
    const ranges = [0,1,2].map(c => {
      let low = 255, high = 0;
      for (const entry of entries) { low = Math.min(low, entry.rgb[c]); high = Math.max(high, entry.rgb[c]); }
      return high - low;
    });
    const channel = ranges.indexOf(Math.max(...ranges));
    const weight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    return { entries, channel, weight, score: ranges[channel] * Math.sqrt(weight) };
  };
  const boxes = [describe([...histogram.values()])];
  while (boxes.length < 32) {
    boxes.sort((a,b) => b.score - a.score);
    const index = boxes.findIndex(box => box.entries.length > 1);
    if (index < 0) break;
    const box = boxes.splice(index, 1)[0];
    box.entries.sort((a,b) => a.rgb[box.channel] - b.rgb[box.channel] || a.key - b.key);
    let sum = 0, split = 0;
    do { sum += box.entries[split++].weight; } while (sum < box.weight / 2 && split < box.entries.length - 1);
    boxes.push(describe(box.entries.slice(0,split)), describe(box.entries.slice(split)));
  }
  const palette = boxes.map(box => [0,1,2].map(c => Math.round(box.entries.reduce((sum, entry) => sum + entry.rgb[c] * entry.weight, 0) / box.weight)));
  const mapped = new Map();
  for (const entry of histogram.values()) {
    let best = palette[0], distance = Infinity;
    for (const color of palette) {
      const d = color.reduce((sum, value, c) => sum + (value - entry.rgb[c]) ** 2, 0);
      if (d < distance) { best = color; distance = d; }
    }
    mapped.set(entry.key, best);
  }
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) data.set(mapped.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]), i);
  return { data, ...grid };
}
