export function duplicateAsins(requestedAsins, savedAsins) {
  const saved = new Set(savedAsins);
  return [...new Set(requestedAsins)].filter((asin) => saved.has(asin));
}

export function assertNoDuplicateAsins(requestedAsins, savedAsins) {
  const duplicates = duplicateAsins(requestedAsins, savedAsins);
  if (duplicates.length) throw new Error(`이미 저장된 ASIN입니다: ${duplicates.join(', ')}`);
}
