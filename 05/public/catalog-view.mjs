export function isDashboardView(filter) {
  return !filter?.category && !filter?.model && !filter?.color;
}
