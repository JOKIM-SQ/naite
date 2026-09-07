const form = document.querySelector('#review-form');
const input = document.querySelector('#amazon-url');
const submit = document.querySelector('#analyze-button');
const status = document.querySelector('#status');
const result = document.querySelector('#result');

function addResult(label, value) {
  const article = document.createElement('article');
  const heading = document.createElement('h3');
  const copy = document.createElement('p');
  heading.textContent = label;
  copy.textContent = Array.isArray(value) ? value.join(' · ') : value;
  article.append(heading, copy);
  result.append(article);
}

function renderAnalysis(product, analysis) {
  result.replaceChildren();
  addResult('분석한 PDP', product.title || product.asin);
  addResult('핵심 요약', analysis.summary);
  addResult('긍정 요인', analysis.positiveFactors);
  addResult('부정 요인', analysis.negativeFactors);
  addResult('페인 포인트', analysis.painPoints);
  addResult('다음 개선', analysis.recommendedFocus);
  result.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = input.value.trim();
  if (!url) return;

  submit.disabled = true;
  status.textContent = 'Amazon PDP의 상위 리뷰를 읽고 Claude가 요약하고 있습니다…';
  result.hidden = true;
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '리뷰 분석에 실패했습니다.');
    renderAnalysis(payload.product, payload.analysis);
    status.textContent = `${payload.product.reviews.length}개 리뷰를 분석했습니다. 결과는 다섯 줄로만 정리했습니다.`;
  } catch (error) {
    status.textContent = error.message || '리뷰 분석에 실패했습니다.';
  } finally {
    submit.disabled = false;
  }
});
