import { analyzeReviews } from './analyze.mjs';
import { fetchPdpSnapshotWithBrowserbase } from './browserbase-reviews.mjs';
import { newReviewsOnly, reviewFingerprint } from './tracking-core.mjs';

const reviewPromptText = (review) => [review.rating == null ? null : `${review.rating}점`, review.title, review.text].filter(Boolean).join(' · ');

export async function syncTrackedProduct({ store, product, snapshot, now = new Date(), apiKey, model, fetchImpl = fetch }) {
  const current = snapshot || await fetchPdpSnapshotWithBrowserbase({ sourceUrl: product.source_url, asin: product.asin, fetchImpl });
  await store.updateProduct(product.id, {
    title: current.title || product.title || null, displayed_price: current.displayedPrice || null,
    rating: current.rating ?? null, image_url: current.imageUrl || null, last_checked_at: now.toISOString(),
  });
  await store.saveSnapshot(product.id, current, now);
  const known = await store.reviewFingerprints(product.id);
  const fresh = newReviewsOnly(current.reviews, known).map((review) => ({ ...review, fingerprint: reviewFingerprint(review) }));
  if (!fresh.length) return { visibleReviews: current.reviews.length, newReviews: 0, analyzed: false };
  const analysis = await analyzeReviews({ reviews: fresh.map(reviewPromptText), apiKey, model, fetchImpl });
  await store.saveReviews(product.id, fresh, now);
  await store.saveAnalysis(product.id, analysis, fresh.map((review) => review.fingerprint), now);
  return { visibleReviews: current.reviews.length, newReviews: fresh.length, analyzed: true, analysis };
}
