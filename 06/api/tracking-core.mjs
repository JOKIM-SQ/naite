import { createHash } from 'node:crypto';

const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const cleanReviewText = (value) => compact(value)
  .replace(/^Brief content visible, double tap to read full content\.?\s*Full content visible, double tap to read brief content\.?\s*/i, '')
  .replace(/\s*Read\s*more\s*Read\s*less\s*$/i, '')
  .trim();

export function reviewFingerprint(review) {
  return createHash('sha256')
    .update([review?.rating ?? '', compact(review?.review_title ?? review?.title).toLowerCase(), cleanReviewText(review?.review_text ?? review?.text).toLowerCase()].join('|'))
    .digest('hex');
}

export function knownReviewFingerprints(reviews = []) {
  return new Set(reviews.flatMap((review) => [review?.fingerprint, reviewFingerprint({
    rating: review?.rating, title: review?.review_title ?? review?.title, text: review?.review_text ?? review?.text,
  })]).filter(Boolean));
}

export function deduplicateReviews(reviews = []) {
  const unique = new Map();
  reviews.forEach((review) => {
    const fingerprint = reviewFingerprint({ rating: review?.rating, title: review?.review_title ?? review?.title, text: review?.review_text ?? review?.text });
    const existing = unique.get(fingerprint);
    if (!existing) {
      unique.set(fingerprint, { ...review, fingerprint });
      return;
    }
    const firstSeen = [existing.first_seen_at, review.first_seen_at].filter(Boolean).sort()[0] || null;
    const lastSeen = [existing.last_seen_at, review.last_seen_at].filter(Boolean).sort().at(-1) || null;
    unique.set(fingerprint, { ...existing, first_seen_at: firstSeen, last_seen_at: lastSeen });
  });
  return [...unique.values()];
}

export function deduplicateAnalyses(analyses = [], reviews = []) {
  const aliases = new Map(reviews.map((review) => [review.fingerprint, reviewFingerprint({
    rating: review.rating, title: review.review_title ?? review.title, text: review.review_text ?? review.text,
  })]));
  const seen = new Set(); const accepted = new Set();
  [...analyses].sort((a, b) => String(a.created_at || a.analyzed_on).localeCompare(String(b.created_at || b.analyzed_on))).forEach((analysis, index) => {
    if (!Array.isArray(analysis.review_fingerprints) || !analysis.review_fingerprints.length) {
      accepted.add(analysis);
      return;
    }
    const fingerprints = (analysis.review_fingerprints || []).map((fingerprint) => aliases.get(fingerprint) || fingerprint).sort();
    const key = `${analysis.product_id || index}|${fingerprints.join('|')}`;
    if (seen.has(key)) return;
    seen.add(key); accepted.add(analysis);
  });
  return analyses.filter((analysis) => accepted.has(analysis));
}

export function newReviewsOnly(reviews = [], knownFingerprints = new Set()) {
  return reviews.filter((review) => !knownFingerprints.has(reviewFingerprint(review)));
}

function ranked(values = []) {
  const counts = new Map();
  values.forEach((value) => {
    const label = compact(value);
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'ko'));
}

export function themeDistribution(analyses = []) {
  return {
    positives: ranked(analyses.flatMap((analysis) => analysis?.positiveFactors || [])),
    negatives: ranked(analyses.flatMap((analysis) => analysis?.negativeFactors || [])),
    painPoints: ranked(analyses.flatMap((analysis) => analysis?.painPoints || [])),
  };
}
