const labels = {download:'URL에서 이미지를 가져오는 중',decoding:'이미지 확인 · 읽는 중',palette:'다섯 가지 대표색 추출 중',pixels:'픽셀아트 변환 중',saving:'공유 보드에 저장 중',complete:'저장 완료',error:'작업을 완료하지 못했어요'};
/** @param {Document} doc @param {Pick<typeof URL,'createObjectURL'|'revokeObjectURL'>} url @param {(text:string)=>void} announce */
export function createProcessingFeedback(doc,url,announce) {
  /** @param {string} id */
  const el=id=>doc.getElementById(id);
  const image=/** @type {HTMLImageElement} */(el('processing-preview'));
  const panel=el('processing-indicator');
  let timer;let preview='';let started=0;
  function cleanup(){clearInterval(timer);if(preview){url.revokeObjectURL(preview);preview='';}el('processing-preview').removeAttribute('src');el('processing-preview').hidden=true;}
  function stage(stage,colors){panel.dataset.stage=stage;el('processing-stage').textContent=labels[stage];announce(labels[stage]);if(colors)for(const [index,swatch] of [...el('processing-colors').children].entries())/** @type {HTMLElement} */(swatch).style.backgroundColor=colors[index];}
  function source(file){if(preview)url.revokeObjectURL(preview);preview=url.createObjectURL(file);image.src=preview;el('processing-preview').hidden=false;el('processing-filename').textContent=file.name;}
  function start(name,index=1,total=1){cleanup();panel.hidden=false;panel.setAttribute('aria-busy','true');el('processing-title').textContent='이미지를 받았어요';el('processing-filename').textContent=name;el('processing-batch').textContent=`${index} / ${total} 이미지`;el('processing-note').textContent='이미지에서 다섯 가지 색과 픽셀아트를 만들어요.';for(const swatch of el('processing-colors').children)swatch.removeAttribute('style');started=Date.now();el('processing-clock').textContent='0초 경과';timer=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);el('processing-clock').textContent=`${seconds}초 경과`;if(seconds>=12)el('processing-note').textContent='첫 변환은 준비 시간이 필요해요. 큰 이미지는 더 오래 걸릴 수 있어요.';},1000);timer.unref?.();stage('decoding');}
  function finish(error,summary){cleanup();panel.setAttribute('aria-busy','false');stage(error?'error':'complete');el('processing-title').textContent=error?'이미지를 다시 확인해 주세요':'색과 픽셀아트가 준비됐어요';if(summary)el('processing-stage').textContent=summary;el('processing-note').textContent=error?`${error} 다른 이미지나 주소로 다시 시도해 주세요.`:'보드에서 색을 복사하거나 픽셀아트를 확인해 보세요.';if(error)announce(error);}
  return {start,source,stage,finish};
}
/** Let the received image feedback paint before synchronous canvas work. */
export async function paintFeedback(){
  if(typeof requestAnimationFrame!=='function')return;
  await new Promise(resolve=>{
    let settled=false;
    let frame;
    let paintTimer;
    // Hidden tabs may suspend animation frames. A frame is a paint opportunity,
    // not a prerequisite for starting the queued image work.
    const fallback=setTimeout(finish,80);
    function finish(){
      if(settled)return;
      settled=true;
      clearTimeout(fallback);clearTimeout(paintTimer);
      if(frame!==undefined&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame);
      resolve(undefined);
    }
    frame=requestAnimationFrame(()=>{
      if(settled)return;
      frame=undefined;
      paintTimer=setTimeout(finish,0);
    });
  });
}
