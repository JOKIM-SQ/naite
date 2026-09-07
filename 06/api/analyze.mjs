const MIN_REVIEWS = 10;
const MAX_REVIEWS = 20;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const fieldNames = ['summary', 'positiveFactors', 'negativeFactors', 'painPoints', 'recommendedFocus'];

export function parseReviewInput(value) {
  return String(value || '')
    .split('\n')
    .map((review) => review.trim())
    .filter(Boolean);
}

function validateReviews(reviews) {
  if (!Array.isArray(reviews) || reviews.length < MIN_REVIEWS) {
    throw new Error(`리뷰를 ${MIN_REVIEWS}개 이상 입력하세요.`);
  }
  if (reviews.length > MAX_REVIEWS) {
    throw new Error(`리뷰는 ${MAX_REVIEWS}개 이하로 입력하세요.`);
  }
  if (reviews.some((review) => typeof review !== 'string' || !review.trim())) {
    throw new Error('빈 리뷰 없이 한 줄에 하나씩 입력하세요.');
  }
}

function asStringList(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Claude 응답의 ${field} 형식이 올바르지 않습니다.`);
  }
  return value.map((item) => item.trim()).slice(0, 3);
}

export function parseStructuredAnalysis(value) {
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
    positiveFactors: asStringList(parsed.positiveFactors, 'positiveFactors'),
    negativeFactors: asStringList(parsed.negativeFactors, 'negativeFactors'),
    painPoints: asStringList(parsed.painPoints, 'painPoints'),
    recommendedFocus: parsed.recommendedFocus.trim(),
  };
}

function makePrompt(reviews) {
  return [
    '다음 고객 리뷰를 분석하세요.',
    '반드시 JSON 객체 하나만 반환하세요. Markdown 코드 펜스와 설명은 쓰지 마세요.',
    '스키마: {"summary":"문자열","positiveFactors":["문자열"],"negativeFactors":["문자열"],"painPoints":["문자열"],"recommendedFocus":"문자열"}',
    '각 배열은 핵심 항목 1~3개로 제한하고, 관찰되지 않은 사실을 만들지 마세요.',
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
      max_tokens: 700,
      messages: [{ role: 'user', content: makePrompt(reviews) }],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error?.message === 'string' ? payload.error.message : `Claude 요청이 실패했습니다 (${response.status}).`;
    throw new Error(message);
  }

  const text = payload.content?.find((block) => block.type === 'text')?.text;
  return parseStructuredAnalysis(text);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'POST 요청만 지원합니다.' });
  }

  const reviews = Array.isArray(req.body?.reviews) ? req.body.reviews.map((review) => String(review).trim()) : [];
  try {
    const analysis = await analyzeReviews({
      reviews,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    });
    return res.status(200).json({ analysis });
  } catch (error) {
    return res.status(error.message.includes('입력하세요') || error.message.includes('이하') ? 400 : 502)
      .json({ message: error.message || '리뷰 분석에 실패했습니다.' });
  }
}
