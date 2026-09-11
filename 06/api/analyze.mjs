import { normalizeAmazonPdpUrl } from './amazon-reviews.mjs';
import { fetchPdpReviewsWithBrowserbase } from '../lib/browserbase-reviews.mjs';

const MIN_REVIEWS = 1;
const MAX_REVIEWS = 5;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const fieldNames = ['summary', 'positiveFactors', 'negativeFactors', 'painPoints', 'recommendedFocus', 'reviewSignals'];
const signalFields = ['positiveFactors', 'negativeFactors', 'painPoints'];

function validateReviews(reviews) {
  if (!Array.isArray(reviews) || reviews.length < MIN_REVIEWS) {
    throw new Error(`리뷰가 ${MIN_REVIEWS}개 이상 필요합니다.`);
  }
  if (reviews.length > MAX_REVIEWS) {
    throw new Error(`리뷰는 ${MAX_REVIEWS}개 이하만 분석합니다.`);
  }
  if (reviews.some((review) => typeof review !== 'string' || !review.trim())) {
    throw new Error('빈 리뷰 없이 한 줄에 하나씩 입력하세요.');
  }
}

function asStringList(value, field, limit = 3) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Claude 응답의 ${field} 형식이 올바르지 않습니다.`);
  }
  return value.map((item) => item.trim()).slice(0, limit);
}

function parseReviewSignals(value, reviewCount) {
  if (!Array.isArray(value)) {
    throw new Error('Claude 응답의 reviewSignals 형식이 올바르지 않습니다.');
  }
  const indices = new Set();
  const signals = value.map((signal) => {
    if (!signal || typeof signal !== 'object' || !Number.isInteger(signal.reviewIndex) || signal.reviewIndex < 1 || (reviewCount && signal.reviewIndex > reviewCount) || indices.has(signal.reviewIndex)) {
      throw new Error('Claude 응답의 리뷰별 근거 형식이 올바르지 않습니다.');
    }
    indices.add(signal.reviewIndex);
    return {
      reviewIndex: signal.reviewIndex,
      ...Object.fromEntries(signalFields.map((field) => [field, asStringList(signal[field], `reviewSignals.${field}`)])),
    };
  });
  if (reviewCount && indices.size !== reviewCount) {
    throw new Error('Claude 응답에 모든 리뷰의 근거가 없습니다. 다시 시도하세요.');
  }
  return signals.sort((a, b) => a.reviewIndex - b.reviewIndex);
}

export function parseStructuredAnalysis(value, reviewCount) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Claude가 JSON 형식으로 응답하지 않았습니다. 다시 시도하세요.');
  }

  if (!parsed || typeof parsed !== 'object' || fieldNames.some((field) => !(field in parsed))) {
    throw new Error('Claude 응답에 필요한 분석 항목이 없습니다. 다시 시도하세요.');
  }
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim() || typeof parsed.recommendedFocus !== 'string' || !parsed.recommendedFocus.trim()) {
    throw new Error('Claude 응답의 요약 형식이 올바르지 않습니다.');
  }

  return {
    summary: parsed.summary.trim(),
    positiveFactors: asStringList(parsed.positiveFactors, 'positiveFactors', 1),
    negativeFactors: asStringList(parsed.negativeFactors, 'negativeFactors', 1),
    painPoints: asStringList(parsed.painPoints, 'painPoints', 1),
    recommendedFocus: parsed.recommendedFocus.trim(),
    reviewSignals: parseReviewSignals(parsed.reviewSignals, reviewCount),
  };
}

function makePrompt(reviews) {
  return [
    '다음 고객 리뷰를 분석하세요.',
    '반드시 JSON 객체 하나만 반환하세요. Markdown 코드 펜스와 설명은 쓰지 마세요.',
    '스키마: {"summary":"문자열","positiveFactors":["문자열"],"negativeFactors":["문자열"],"painPoints":["문자열"],"recommendedFocus":"문자열","reviewSignals":[{"reviewIndex":1,"positiveFactors":["문자열"],"negativeFactors":["문자열"],"painPoints":["문자열"]}]}',
    'reviewSignals에는 입력된 모든 리뷰 번호별 객체를 정확히 하나씩 넣으세요. 각 항목은 해당 리뷰 본문에 명시된 사실만 담고, 해당하지 않는 배열은 빈 배열로 반환하세요.',
    '사용자 노출용 전체 분석은 summary·positiveFactors[0]·negativeFactors[0]·painPoints[0]·recommendedFocus의 최대 5줄입니다. 전체 요인 배열은 각각 0~1개만 넣고 관찰되지 않은 사실을 만들지 마세요.',
    '',
    ...reviews.map((review, index) => `${index + 1}. ${review}`),
  ].join('\n');
}

export async function analyzeReviews({ reviews, apiKey, model = 'claude-sonnet-4-6', fetchImpl = fetch }) {
  validateReviews(reviews);
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 환경변수가 없습니다.');

  const response = await fetchImpl(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      messages: [{ role: 'user', content: makePrompt(reviews) }],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error?.message === 'string' ? payload.error.message : `Claude 요청이 실패했습니다 (${response.status}).`;
    throw new Error(message);
  }

  const text = payload.content?.find((block) => block.type === 'text')?.text;
  return parseStructuredAnalysis(text, reviews.length);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'POST 요청만 지원합니다.' });
  }

  let product;
  try {
    const { asin, sourceUrl } = normalizeAmazonPdpUrl(req.body?.url);
    product = await fetchPdpReviewsWithBrowserbase({ sourceUrl, asin });
  } catch (error) {
    return res.status(422).json({ message: error.message || 'Amazon PDP에서 리뷰를 읽지 못했습니다.' });
  }

  try {
    const reviews = product.reviews.map((review) => [
      review.rating == null ? null : `${review.rating}점`,
      review.title,
      review.text,
    ].filter(Boolean).join(' · '));
    const analysis = await analyzeReviews({
      reviews,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    });
    return res.status(200).json({ product: { asin: product.asin, title: product.title, reviews: product.reviews }, analysis });
  } catch (error) {
    return res.status(502).json({ message: error.message || '리뷰 분석에 실패했습니다.' });
  }
}
