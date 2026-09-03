export function selectableVariantAsins(variants = []) {
  return [...new Set(variants.filter((variant) => !variant.selected).map((variant) => variant.asin))];
}

export function derivedVariantAsins(snapshot = {}) {
  return selectableVariantAsins([...(snapshot.colorVariants || []), ...(snapshot.deviceVariants || [])]);
}

export function allSelectableVariantsSelected(selectedAsins, variants = []) {
  const selectable = selectableVariantAsins(variants);
  return selectable.length > 0 && selectable.every((asin) => selectedAsins.has(asin));
}

export function toggleAllSelectableVariants(selectedAsins, variants = []) {
  const next = new Set(selectedAsins);
  const selectable = selectableVariantAsins(variants);
  if (allSelectableVariantsSelected(selectedAsins, variants)) {
    selectable.forEach((asin) => next.delete(asin));
  } else {
    selectable.forEach((asin) => next.add(asin));
  }
  return next;
}
