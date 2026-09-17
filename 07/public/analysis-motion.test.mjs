import test from 'node:test';
import assert from 'node:assert/strict';
import { initAnalysisMotion } from './analysis-motion.mjs';

class Element extends EventTarget {
  dataset = { playing: 'false' };
  disabled = false;
  hidden = true;
  textContent = '다시 보기 ↗';
}

function fixture({ reduced = false, observer = true } = {}) {
  const preview = new Element();
  const replay = new Element();
  const note = new Element();
  const root = new EventTarget();
  root.hidden = false;
  root.querySelector = selector => ({ '#analysis-preview': preview, '#replay-analysis': replay, '#analysis-motion-note': note })[selector];
  const media = new EventTarget();
  media.matches = reduced;
  const timers = new Map();
  let timerId = 0;
  let observation;
  class Observer {
    constructor(callback) { this.callback = callback; observation = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    reveal(ratio) { if (!this.disconnected) this.callback([{ target: this.target, isIntersecting: ratio > 0, intersectionRatio: ratio }]); }
  }
  const cleanup = initAnalysisMotion({ root, media, Observer: observer ? Observer : undefined,
    setTimer: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimer: id => timers.delete(id),
  });
  return {
    preview, replay, note, root, timers, cleanup,
    reveal: ratio => observation?.reveal(ratio),
    click: () => replay.dispatchEvent(new Event('click')),
    preference: reduced => { media.matches = reduced; media.dispatchEvent(new Event('change')); },
    finish: () => { for (const { callback, delay } of [...timers.values()]) { assert.ok(delay > 0 && delay <= 4500, '재생은 유한 시간 안에 끝난다'); callback(); } },
  };
}

test('처음 화면에 절반 이상 나타날 때 한 번 재생하고 완료 뒤 노출만으로 다시 시작하지 않는다', () => {
  const view = fixture();
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.timers.size, 0);
  view.reveal(0.4);
  assert.equal(view.preview.dataset.playing, 'false');
  view.reveal(0.6);
  assert.equal(view.preview.dataset.playing, 'true');
  assert.equal(view.timers.size, 1);
  view.finish();
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.timers.size, 0);
  view.reveal(1);
  assert.equal(view.preview.dataset.playing, 'false');
  view.cleanup();
});

test('중복 재생을 막고 완료 후 다시 보기로 재생하며 버튼 내용은 유지한다', () => {
  const view = fixture();
  view.reveal(1);
  assert.equal(view.replay.disabled, true);
  view.click();
  assert.equal(view.timers.size, 1);
  view.finish();
  assert.equal(view.replay.disabled, false);
  view.click();
  assert.equal(view.preview.dataset.playing, 'true');
  assert.equal(view.timers.size, 1);
  assert.equal(view.replay.textContent, '다시 보기 ↗');
  view.finish();
  assert.equal(view.preview.dataset.playing, 'false');
  view.cleanup();
});

test('관찰 API가 없는 브라우저에서도 한 번 재생 후 정지한다', () => {
  const view = fixture({ observer: false });
  assert.equal(view.preview.dataset.playing, 'true');
  view.finish();
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.timers.size, 0);
  view.cleanup();
});

test('움직임 줄이기 초기 설정에서는 완성 그림과 안내만 보이고 재생하지 않는다', () => {
  const view = fixture({ reduced: true });
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.replay.disabled, true);
  assert.equal(view.note.hidden, false);
  view.reveal(1);
  view.click();
  assert.equal(view.timers.size, 0);
  assert.equal(view.preview.dataset.playing, 'false');
  view.cleanup();
});

test('움직임 줄이기로 바꾸면 즉시 취소하고 해제 후에는 직접 다시 보기만 허용한다', () => {
  const view = fixture();
  view.reveal(1);
  view.preference(true);
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.timers.size, 0);
  assert.equal(view.replay.disabled, true);
  assert.equal(view.note.hidden, false);
  view.preference(false);
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.replay.disabled, false);
  assert.equal(view.note.hidden, true);
  view.click();
  assert.equal(view.preview.dataset.playing, 'true');
  view.cleanup();
});

test('첫 노출 전 움직임 줄이기 설정을 바꿔도 해제 시 자동 재생을 다시 예약하지 않는다', () => {
  const view = fixture();
  view.preference(true);
  view.preference(false);
  view.reveal(1);
  assert.equal(view.preview.dataset.playing, 'false');
  view.click();
  assert.equal(view.preview.dataset.playing, 'true');
  view.cleanup();
});

test('탭이 숨겨지거나 정리 함수를 호출하면 멈추고 타이머와 이벤트를 정리한다', () => {
  const view = fixture();
  view.reveal(1);
  view.root.hidden = true;
  view.root.dispatchEvent(new Event('visibilitychange'));
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.timers.size, 0);
  view.root.hidden = false;
  view.click();
  assert.equal(view.preview.dataset.playing, 'true');
  view.cleanup();
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.timers.size, 0);
  view.click();
  assert.equal(view.preview.dataset.playing, 'false');
});
