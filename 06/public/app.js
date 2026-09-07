const form = document.querySelector('#review-form');
const input = document.querySelector('#reviews');
const count = document.querySelector('#review-count');
const submit = document.querySelector('#analyze-button');
const status = document.querySelector('#status');
const result = document.querySelector('#result');

const readReviews = () => input.value.split('\n').map((review) => review.trim()).filter(Boolean);

function renderCount() {
  const total = readReviews().length;
  count.textContent = `${total} / 10–20개`;
  count.classList.toggle('ready', total >= 10 && total <= 20);
}

function addResult(label, value) {
  const article = document.createElement('article');
  const heading = document.createElement('h3');
  const copy = document.createElement('p');
  heading.textContent = label;
  copy.textContent = Array.isArray(value) ? value.join(' · ') : value;
  article.append(heading, copy);
  result.append(article);
}

function renderAnalysis(analysis) {
  result.replaceChildren();
  addResult('핵심 요약', analysis.summary);
  addResult('긍정 요인', analysis.positiveFactors);
  addResult('부정 요인', analysis.negativeFactors);
  addResult('페인 포인트', analysis.painPoints);
  addResult('다음 개선', analysis.recommendedFocus);
  result.hidden = false;
}

input.addEventListener('input', renderCount);
renderCount();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const reviews = readReviews();
  if (reviews.length < 10 || reviews.length > 20) {
    status.textContent = '리뷰를 한 줄에 하나씩, 10개에서 20개 사이로 입력하세요.';
    return;
  }

  submit.disabled = true;
  status.textContent = 'Claude가 리뷰를 읽고 있습니다…';
  result.hidden = true;
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reviews }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '리뷰 분석에 실패했습니다.');
    renderAnalysis(payload.analysis);
    status.textContent = '분석이 완료되었습니다. 결과는 다섯 줄로만 정리했습니다.';
  } catch (error) {
    status.textContent = error.message || '리뷰 분석에 실패했습니다.';
  } finally {
    submit.disabled = false;
  }
});
