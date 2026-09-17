export function initAnalysisMotion({
  root = globalThis.document,
  media = globalThis.matchMedia('(prefers-reduced-motion: reduce)'),
  Observer = globalThis.IntersectionObserver,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  const preview = root.querySelector('#analysis-preview');
  const replay = root.querySelector('#replay-analysis');
  const note = root.querySelector('#analysis-motion-note');
  let timer;
  let observer;

  function stop() {
    clearTimer(timer);
    timer = undefined;
    preview.dataset.playing = 'false';
    replay.disabled = media.matches;
    note.hidden = !media.matches;
  }

  function play() {
    if (media.matches || root.hidden || preview.dataset.playing === 'true') return;
    observer?.disconnect();
    preview.dataset.playing = 'true';
    replay.disabled = true;
    timer = setTimer(stop, 4500);
  }

  function preferenceChanged() {
    if (media.matches) observer?.disconnect();
    stop();
  }

  function visibilityChanged() {
    if (root.hidden) stop();
  }

  stop();
  replay.addEventListener('click', play);
  media.addEventListener('change', preferenceChanged);
  root.addEventListener('visibilitychange', visibilityChanged);
  if (!media.matches) {
    if (Observer) {
      observer = new Observer(records => {
        if (records.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5)) play();
      }, { threshold: 0.5 });
      observer.observe(preview);
    } else play();
  }

  return () => {
    observer?.disconnect();
    replay.removeEventListener('click', play);
    media.removeEventListener('change', preferenceChanged);
    root.removeEventListener('visibilitychange', visibilityChanged);
    stop();
  };
}

if (typeof document !== 'undefined') initAnalysisMotion();
