export function deviceColorSelections(snapshot) {
  const device = snapshot.currentDevice;
  const seen = new Set();
  return (snapshot.colorVariants || []).filter((variant) => variant.asin && !seen.has(variant.asin) && seen.add(variant.asin)).map((variant) => ({
    asin: variant.asin,
    expectedColor: variant.label,
    expectedDevice: device,
  }));
}

export function deviceColorPreview(snapshot) {
  return {
    device: snapshot.currentDevice,
    colors: deviceColorSelections(snapshot).map(({ asin, expectedColor }) => ({ asin, label: expectedColor })),
  };
}
