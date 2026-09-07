const finiteRating = (value) => Number.isFinite(Number(value));

export function summarizeTodaySignals({ today, products = [], snapshots = [], analyses = [] }) {
  const todayAnalyses = analyses.filter((analysis) => analysis.analyzed_on === today);
  const painPoints = new Set(todayAnalyses.flatMap((analysis) => analysis.analysis?.painPoints || [])
    .map((value) => String(value || '').trim()).filter(Boolean));
  const ratingChanges = [];
  const snapshotsByProduct = new Map();
  snapshots.forEach((snapshot) => {
    const values = snapshotsByProduct.get(snapshot.product_id) || [];
    values.push(snapshot); snapshotsByProduct.set(snapshot.product_id, values);
  });
  snapshotsByProduct.forEach((values) => {
    const ordered = values.slice().sort((a, b) => String(b.tracked_on).localeCompare(String(a.tracked_on)));
    const todaySnapshot = ordered.find((snapshot) => snapshot.tracked_on === today);
    const previous = ordered.find((snapshot) => snapshot.tracked_on < todaySnapshot?.tracked_on);
    if (todaySnapshot && previous && finiteRating(todaySnapshot.rating) && finiteRating(previous.rating)) ratingChanges.push(Number(todaySnapshot.rating) - Number(previous.rating));
  });
  const lastCheckedAt = products.map((product) => product.last_checked_at).filter(Boolean).sort().at(-1) || null;
  return {
    trackedProducts: products.length,
    newReviews: todayAnalyses.reduce((total, analysis) => total + Number(analysis.review_count || 0), 0),
    newPainPoints: painPoints.size,
    ratingDelta: ratingChanges.length ? Number((ratingChanges.reduce((total, value) => total + value, 0) / ratingChanges.length).toFixed(1)) : 0,
    lastCheckedAt,
  };
}
