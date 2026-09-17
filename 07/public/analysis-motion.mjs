export function initAnalysisMotion({
  root = globalThis.document,
  media = globalThis.matchMedia('(prefers-reduced-motion: reduce)'),
  Observer = globalThis.IntersectionObserver,
} = {}) {
  const preview = root.querySelector('#analysis-preview');
  const note = root.querySelector('#analysis-motion-note');
  let visible = !Observer;
  let observer;

  function update() {
    preview.dataset.playing = String(visible && !root.hidden && !media.matches);
    note.hidden = !media.matches;
  }

  update();
  media.addEventListener('change', update);
  root.addEventListener('visibilitychange', update);
  if (Observer) {
    observer = new Observer(records => {
      for (const entry of records) visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      update();
    }, { threshold: 0.5 });
    observer.observe(preview);
  }

  return () => {
    observer?.disconnect();
    media.removeEventListener('change', update);
    root.removeEventListener('visibilitychange', update);
    visible = false;
    update();
  };
}

if (typeof document !== 'undefined') initAnalysisMotion();
