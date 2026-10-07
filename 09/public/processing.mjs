import { stylizeGrid } from './pixel-style.mjs';
import { getPalette } from './vendor/color-thief.mjs';

/** @typedef {'style' | 'original'} PixelMode */

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_EDGE = 16_384;

/** @param {Blob} file */
export function validateImageFile(file) {
  if (!(file instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('JPG, PNG 또는 WebP 이미지 파일을 선택해 주세요.');
  }
  if (!file.size) throw new Error('비어 있는 이미지 파일입니다.');
  if (file.size > MAX_BYTES) throw new Error('이미지는 12MB 이하로 선택해 주세요.');
}

/** @param {number} width @param {number} height @param {number} columns */
export function gridDimensions(width, height, columns) {
  if (![width, height, columns].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('이미지 크기와 픽셀 칸 수가 올바르지 않습니다.');
  }
  if (width * height > MAX_PIXELS || Math.max(width, height) > MAX_EDGE) {
    throw new Error('이미지가 너무 큽니다. 4천만 픽셀, 한 변 16,384px 이하로 줄여 주세요.');
  }
  const gridWidth = Math.min(columns, width);
  return { width: gridWidth, height: Math.max(1, Math.round(height * gridWidth / width)) };
}

/** @param {Uint8ClampedArray} pixels @param {number} width @param {number} height @param {number} columns */
export function samplePixelGrid(pixels, width, height, columns) {
  const grid = gridDimensions(width, height, columns);
  if (pixels.length !== width * height * 4) throw new Error('이미지 픽셀 데이터가 올바르지 않습니다.');
  return sampleGrid(pixels, width, height, grid);
}

/** @param {Uint8ClampedArray} pixels @param {number} width @param {number} height @param {{width:number,height:number}} grid */
function sampleGrid(pixels, width, height, grid) {
  const data = new Uint8ClampedArray(grid.width * grid.height * 4);
  for (let y = 0; y < grid.height; y++) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / grid.height));
    for (let x = 0; x < grid.width; x++) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / grid.width));
      const offset = (sourceY * width + sourceX) * 4;
      data.set(pixels.subarray(offset, offset + 4), (y * grid.width + x) * 4);
    }
  }
  return { data, ...grid };
}

/** @param {Uint8ClampedArray} pixels @param {number} width @param {number} height @param {number} columns */
export function stylePixelGrid(pixels, width, height, columns) {
  const grid = gridDimensions(width, height, columns);
  if (pixels.length !== width * height * 4) throw new Error('이미지 픽셀 데이터가 올바르지 않습니다.');
  return stylizeGrid(pixels, width, height, grid);
}

/** @param {string} mode */
function validatePixelMode(mode) {
  if (!['style', 'original'].includes(mode)) throw new Error('픽셀 모드가 올바르지 않습니다.');
}

/** @param {number} width @param {number} height */
function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 브라우저에서 이미지 변환을 시작할 수 없습니다.');
  return { canvas, context };
}

/** @param {HTMLCanvasElement} canvas @returns {Promise<Blob>} */
function encodePNG(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (blob?.size) resolve(blob);
    else reject(new Error('PNG 파일을 생성하지 못했습니다. 다시 시도해 주세요.'));
  }, 'image/png'));
}

/** @param {number} width @param {number} height @param {number} maximum */
function fitDimensions(width, height, maximum) {
  const ratio = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** @param {HTMLCanvasElement} source @param {number} columns @param {PixelMode} pixelMode */
async function pixelFromCanvas(source, columns, pixelMode) {
  const context = source.getContext('2d');
  if (!context) throw new Error('이미지 데이터를 읽지 못했습니다.');
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  const requested = gridDimensions(source.width, source.height, columns);
  // Extremely tall/wide inputs still need a grid that fits the export limit.
  const dimensions = fitDimensions(requested.width, requested.height, 1600);
  const sampled = pixelMode === 'style'
    ? stylizeGrid(pixels, source.width, source.height, dimensions)
    : sampleGrid(pixels, source.width, source.height, dimensions);
  const grid = createCanvas(sampled.width, sampled.height);
  const imageData = grid.context.createImageData(sampled.width, sampled.height);
  imageData.data.set(sampled.data);
  grid.context.putImageData(imageData, 0, 0);
  const scale = Math.max(1, Math.floor(1600 / Math.max(sampled.width, sampled.height)));
  const size = { width: sampled.width * scale, height: sampled.height * scale };
  const output = createCanvas(size.width, size.height);
  try {
    output.context.imageSmoothingEnabled = false;
    output.context.drawImage(grid.canvas, 0, 0, output.canvas.width, output.canvas.height);
    return { pixelBlob: await encodePNG(output.canvas), gridWidth: sampled.width, gridHeight: sampled.height, pixelMode };
  } finally {
    grid.canvas.width = grid.canvas.height = 0;
    output.canvas.width = output.canvas.height = 0;
  }
}

/** @param {Blob} blob */
async function decodeCanvas(blob) {
  // Browser decoding is the only full-resolution decode; validate before allocating a Canvas.
  /** @type {ImageBitmap} */
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (cause) {
    throw new Error('이미지를 읽을 수 없습니다. 파일이 손상되었는지 확인하고 다른 이미지를 선택해 주세요.', { cause });
  }
  try {
    gridDimensions(bitmap.width, bitmap.height, 1);
    const result = createCanvas(bitmap.width, bitmap.height);
    result.context.drawImage(bitmap, 0, 0);
    return result.canvas;
  } finally {
    bitmap.close();
  }
}

/** @typedef {string | { hex(): string }} PaletteColor */
/** @typedef {(canvas: HTMLCanvasElement) => Promise<PaletteColor[] | null> | PaletteColor[] | null} PaletteExtractor */

/** @param {PaletteColor[] | null} colors */
function normalizePalette(colors) {
  if (!Array.isArray(colors) || !colors.length) throw new Error('대표색을 추출하지 못했습니다. 다른 이미지를 선택해 주세요.');
  const hexes = colors.slice(0, 5).map(color => typeof color === 'string' ? color : color?.hex());
  if (hexes.some(hex => typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex))) {
    throw new Error('대표색을 추출하지 못했습니다. 다른 이미지를 선택해 주세요.');
  }
  return Array.from({ length: 5 }, (_, index) => hexes[index % hexes.length].toUpperCase());
}

/**
 * @param {Blob} file
 * @param {{ columns?: number, pixelMode?: PixelMode, extractPalette?: PaletteExtractor }} [options]
 */
export async function processImage(file, { columns = 64, pixelMode = 'style', extractPalette = canvas => getPalette(canvas, { colorCount: 5, ignoreWhite: false, quality: 5, alphaThreshold: 1 }) } = {}) {
  validateImageFile(file);
  validatePixelMode(pixelMode);
  const source = await decodeCanvas(file);
  try {
    gridDimensions(source.width, source.height, columns);
    const context = source.getContext('2d');
    if (!context) throw new Error('이미지 데이터를 읽지 못했습니다.');
    const pixels = context.getImageData(0, 0, source.width, source.height).data;
    let visible = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) { visible = true; break; }
    }
    if (!visible) throw new Error('완전히 투명한 이미지에서는 대표색을 추출할 수 없습니다.');
    const palette = normalizePalette(await extractPalette(source));
    const pixel = await pixelFromCanvas(source, columns, pixelMode);
    const size = fitDimensions(source.width, source.height, 640);
    const thumbnail = createCanvas(size.width, size.height);
    try {
      thumbnail.context.drawImage(source, 0, 0, size.width, size.height);
      return { sourceBlob: file, thumbnailBlob: await encodePNG(thumbnail.canvas), ...pixel, palette, width: source.width, height: source.height, columns };
    } finally {
      thumbnail.canvas.width = thumbnail.canvas.height = 0;
    }
  } finally {
    source.width = source.height = 0;
  }
}

/** @param {Blob} sourceBlob @param {number} columns @param {PixelMode} [pixelMode] */
export async function renderPixelArt(sourceBlob, columns, pixelMode = 'original') {
  validateImageFile(sourceBlob);
  validatePixelMode(pixelMode);
  const source = await decodeCanvas(sourceBlob);
  try { return await pixelFromCanvas(source, columns, pixelMode); }
  finally { source.width = source.height = 0; }
}
