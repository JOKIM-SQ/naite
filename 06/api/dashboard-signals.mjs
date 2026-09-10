import { deduplicateAnalyses, deduplicateReviews } from './tracking-core.mjs';

const finiteRating = (value) => Number.isFinite(Number(value));
const reviewDate = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

export function summarizeTodaySignals({ today, products = [], snapshots = [], reviews = [], analyses = [] }) {
  const uniqueAnalyses = deduplicateAnalyses(analyses, reviews);
  const todayAnalyses = uniqueAnalyses.filter((analysis) => analysis.analyzed_on === today);
  const todayReviews = deduplicateReviews(reviews).filter((review) => reviewDate(review.first_seen_at) === today);
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
    newReviews: reviews.length ? todayReviews.length : todayAnalyses.reduce((total, analysis) => total + Number(analysis.review_count || 0), 0),
    newPainPoints: painPoints.size,
    ratingDelta: ratingChanges.length ? Number((ratingChanges.reduce((total, value) => total + value, 0) / ratingChanges.length).toFixed(1)) : 0,
    lastCheckedAt,
  };
}
