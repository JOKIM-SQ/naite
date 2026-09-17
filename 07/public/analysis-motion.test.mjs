import test from 'node:test';
import assert from 'node:assert/strict';
import { initAnalysisMotion } from './analysis-motion.mjs';

class Element extends EventTarget {
  dataset = { playing: 'false' };
  hidden = true;
}

function fixture({ reduced = false, observer = true, hidden = false } = {}) {
  const preview = new Element();
  const note = new Element();
  const root = new EventTarget();
  root.hidden = hidden;
  root.querySelector = selector => ({ '#analysis-preview': preview, '#analysis-motion-note': note })[selector];
  const media = new EventTarget();
  media.matches = reduced;
  let observation;
  class Observer {
    constructor(callback) { this.callback = callback; observation = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    reveal(ratio) { if (!this.disconnected) this.callback([{ target: this.target, isIntersecting: ratio > 0, intersectionRatio: ratio }]); }
  }
  const cleanup = initAnalysisMotion({ root, media, Observer: observer ? Observer : undefined });
  return {
    preview, note, cleanup,
    reveal: ratio => observation?.reveal(ratio),
    visibility: hidden => { root.hidden = hidden; root.dispatchEvent(new Event('visibilitychange')); },
    preference: reduced => { media.matches = reduced; media.dispatchEvent(new Event('change')); },
  };
}

test('화면에 보이는 동안 유한 종료 타이머 없이 반복 재생 상태를 유지한다', t => {
  t.mock.method(globalThis, 'setTimeout', () => assert.fail('CSS 반복 재생에는 종료 타이머가 필요하지 않다'));
  const view = fixture();
  assert.equal(view.preview.dataset.playing, 'false');
  view.reveal(0.4);
  assert.equal(view.preview.dataset.playing, 'false');
  view.reveal(0.6);
  assert.equal(view.preview.dataset.playing, 'true');
  view.reveal(1);
  assert.equal(view.preview.dataset.playing, 'true');
  view.cleanup();
});

test('화면 밖에서는 완성 그림으로 멈추고 재진입하면 자동 반복을 재개한다', () => {
  const view = fixture();
  view.reveal(1);
  assert.equal(view.preview.dataset.playing, 'true');
  view.reveal(0);
  assert.equal(view.preview.dataset.playing, 'false');
  view.reveal(1);
  assert.equal(view.preview.dataset.playing, 'true');
  view.cleanup();
});

test('탭을 숨기면 멈추고 보이는 미리보기는 탭 복귀 시 자동으로 재개한다', () => {
  const view = fixture();
  view.reveal(1);
  view.visibility(true);
  assert.equal(view.preview.dataset.playing, 'false');
  view.visibility(false);
  assert.equal(view.preview.dataset.playing, 'true');
  view.reveal(0);
  view.visibility(true);
  view.visibility(false);
  assert.equal(view.preview.dataset.playing, 'false');
  view.cleanup();
});

test('처음부터 비활성 탭이면 노출을 관찰해도 정지하고 탭 복귀 때 재생한다', () => {
  const view = fixture({ hidden: true });
  view.reveal(1);
  assert.equal(view.preview.dataset.playing, 'false');
  view.visibility(false);
  assert.equal(view.preview.dataset.playing, 'true');
  view.cleanup();
});

test('움직임 줄이기 초기 설정에서는 완성 그림을 보이고 해제하면 보이는 동안 반복한다', () => {
  const view = fixture({ reduced: true });
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.note.hidden, false);
  view.reveal(1);
  assert.equal(view.preview.dataset.playing, 'false');
  view.preference(false);
  assert.equal(view.preview.dataset.playing, 'true');
  assert.equal(view.note.hidden, true);
  view.cleanup();
});

test('움직임 줄이기를 켜면 즉시 정지하고 해제 시 현재 화면 노출에 따라 재개한다', () => {
  const view = fixture();
  view.reveal(1);
  view.preference(true);
  assert.equal(view.preview.dataset.playing, 'false');
  assert.equal(view.note.hidden, false);
  view.preference(false);
  assert.equal(view.preview.dataset.playing, 'true');
  assert.equal(view.note.hidden, true);
  view.reveal(0);
  view.preference(true);
  view.preference(false);
  assert.equal(view.preview.dataset.playing, 'false');
  view.cleanup();
});

test('관찰 API가 없어도 활성 탭에서 반복하고 사용자 모션 설정에 맞춰 재개한다', () => {
  const view = fixture({ observer: false });
  assert.equal(view.preview.dataset.playing, 'true');
  view.visibility(true);
  assert.equal(view.preview.dataset.playing, 'false');
  view.visibility(false);
  assert.equal(view.preview.dataset.playing, 'true');
  view.preference(true);
  assert.equal(view.preview.dataset.playing, 'false');
  view.preference(false);
  assert.equal(view.preview.dataset.playing, 'true');
  view.cleanup();
});

test('정리 후에는 노출·탭·모션 설정 이벤트로 재생을 다시 시작하지 않는다', () => {
  const view = fixture();
  view.reveal(1);
  view.cleanup();
  assert.equal(view.preview.dataset.playing, 'false');
  view.reveal(1);
  view.visibility(true);
  view.visibility(false);
  view.preference(true);
  view.preference(false);
  assert.equal(view.preview.dataset.playing, 'false');
});
