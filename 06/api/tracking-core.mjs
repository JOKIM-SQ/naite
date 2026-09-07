import { createHash } from 'node:crypto';

const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export function reviewFingerprint(review) {
  return createHash('sha256')
    .update([review?.rating ?? '', compact(review?.title).toLowerCase(), compact(review?.text).toLowerCase()].join('|'))
    .digest('hex');
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
