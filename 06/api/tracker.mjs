import { analyzeReviews } from './analyze.mjs';
import { fetchPdpSnapshotWithRetries } from '../lib/browserbase-reviews.mjs';
import { newReviewsOnly, reviewFingerprint } from './tracking-core.mjs';

const reviewPromptText = (review) => [review.rating == null ? null : `${review.rating}점`, review.title, review.text].filter(Boolean).join(' · ');

export async function syncTrackedProduct({ store, product, snapshot, now = new Date(), apiKey, model, fetchImpl = fetch, onStage }) {
  const current = snapshot || await fetchPdpSnapshotWithRetries({
    sourceUrl: product.source_url, asin: product.asin, fetchImpl,
    onAttempt: ({ attempt, maxAttempts }) => onStage?.({ id: 'render', attempt, maxAttempts, message: 'Amazon PDP를 열고 공개 리뷰를 렌더링하는 중입니다.' }),
    onRetry: ({ nextAttempt, maxAttempts }) => onStage?.({ id: 'retry', attempt: nextAttempt, maxAttempts, message: '응답이 불안정해 새 원격 세션으로 다시 시도합니다.' }),
  });
  onStage?.({ id: 'snapshot', message: '별점·가격·공개 리뷰를 오늘의 스냅샷으로 저장하는 중입니다.' });
  await store.updateProduct(product.id, {
    title: current.title || product.title || null, displayed_price: current.displayedPrice || null,
    rating: current.rating ?? null, image_url: current.imageUrl || null, last_checked_at: now.toISOString(),
  });
  await store.saveSnapshot(product.id, current, now);
  const known = await store.reviewFingerprints(product.id);
  const fresh = newReviewsOnly(current.reviews, known).map((review) => ({ ...review, fingerprint: reviewFingerprint(review) }));
  if (!fresh.length) return { visibleReviews: current.reviews.length, newReviews: 0, analyzed: false };
  onStage?.({ id: 'claude', message: `새 리뷰 ${fresh.length}개를 Claude로 분석하는 중입니다.` });
  const analysis = await analyzeReviews({ reviews: fresh.map(reviewPromptText), apiKey, model, fetchImpl });
  onStage?.({ id: 'store', message: '리뷰 근거와 분석 신호를 추적 카드에 저장하는 중입니다.' });
  await store.saveReviews(product.id, fresh, now);
  await store.saveAnalysis(product.id, analysis, fresh.map((review) => review.fingerprint), now);
  return { visibleReviews: current.reviews.length, newReviews: fresh.length, analyzed: true, analysis };
}
