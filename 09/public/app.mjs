import { createBoardStore } from './storage.mjs';
import { processImage, renderPixelArt } from './processing.mjs';
/** @typedef {import('./storage.mjs').BoardRecord} Record */
/** @typedef {Awaited<ReturnType<typeof createBoardStore>>} Store */
/**
 * @param {{document?: Document, store?: Store, processImage?: typeof processImage, renderPixelArt?: typeof renderPixelArt, clipboard?: Pick<Clipboard,'writeText'>, url?: Pick<typeof URL,'createObjectURL'|'revokeObjectURL'>}} [options]
 */
export function createApp(options = {}) {
  const doc = options.document ?? document;
  const processor = options.processImage ?? processImage;
  const pixelRenderer = options.renderPixelArt ?? renderPixelArt;
  const clipboard = options.clipboard ?? globalThis.navigator?.clipboard;
  const url = options.url ?? URL;
  /** @type {Store} */ let store = options.store;
  /** @type {Map<string,Record>} */ const records = new Map();
  /** @type {Map<string,{source:string,pixel:string,sourceBlob:Blob,pixelBlob:Blob}>} */ const urls = new Map();
  let ready = false;
  let selected = '';
  let generation = 0;
  let pixelView = false;
  /** @type {Map<string,{columns:number,pixelMode:'original'|'style'|'detail'}>} */ const pendingSettings = new Map();
  let pendingDelete = '';
  let queue = Promise.resolve();
  let toastTimer;
  /** @param {string} id */ const el = id => /** @type {HTMLElement} */ (doc.getElementById(id));
  const nameInput = /** @type {HTMLInputElement} */ (el('detail-name'));
  const columnsInput = /** @type {HTMLSelectElement} */ (el('pixel-columns'));
  const modeInput = /** @type {HTMLSelectElement} */ (el('pixel-mode'));
  const fileInput = /** @type {HTMLInputElement} */ (el('file-input'));
  const detail = /** @type {HTMLDialogElement} */ (el('detail-dialog'));
  const deletion = /** @type {HTMLDialogElement} */ (el('delete-dialog'));
  /** @param {unknown} error */ const message = error => error instanceof Error ? error.message : '작업을 완료하지 못했습니다. 다시 시도해 주세요.';
  /** @param {string} text */ function status(text) { el('status-message').textContent = text; }
  /** @param {string} text */ function toast(text) {
    clearTimeout(toastTimer); el('toast').textContent = text; el('toast').hidden = false; el('toast').classList.add('is-visible');
    toastTimer = setTimeout(() => { el('toast').hidden = true; el('toast').classList.remove('is-visible'); }, 5000);
  }
  /** @param {() => Promise<void>} task */ function enqueue(task) { queue = queue.then(task).catch(error => status(message(error))); return queue; }
  /** @param {Record} record */ function imageUrls(record) {
    let entry = urls.get(record.id);
    if (entry && (entry.sourceBlob !== record.sourceBlob || entry.pixelBlob !== record.pixelBlob)) { url.revokeObjectURL(entry.source); url.revokeObjectURL(entry.pixel); urls.delete(record.id); entry = undefined; }
    if (!entry) { entry = {source:url.createObjectURL(record.sourceBlob),pixel:url.createObjectURL(record.pixelBlob),sourceBlob:record.sourceBlob,pixelBlob:record.pixelBlob}; urls.set(record.id,entry); }
    return entry;
  }
  /** @param {string} tag @param {string} className @param {string} [text] */ function node(tag,className,text='') { const n=doc.createElement(tag); n.className=className; n.textContent=text; return n; }
  /** @param {HTMLElement} parent @param {Record} record */ function palette(parent,record) {
    parent.replaceChildren();
    for (const color of record.palette) {
      const button = /** @type {HTMLButtonElement} */ (node('button','swatch')); button.type='button'; button.style.backgroundColor=color; button.setAttribute('aria-label',`${color} 복사`);
      button.append(node('span','swatch-code',color));
      button.addEventListener('click',async()=> { try { if (!clipboard) throw Error('clipboard unavailable'); await clipboard.writeText(color); toast(`${color} 복사했습니다.`); } catch { toast(`복사 권한이 없습니다. 코드를 선택해 복사하세요: ${color}`); el('toast').style.userSelect='text'; let fallback=/** @type {HTMLInputElement} */(parent.parentElement.querySelector('.copy-fallback')); if(!fallback){fallback=doc.createElement('input');fallback.className='copy-fallback';fallback.readOnly=true;fallback.setAttribute('aria-label','복사할 HEX 코드');parent.after(fallback);} fallback.value=color;fallback.focus();fallback.select?.(); } });
      parent.append(button);
    }
  }
  /** @param {HTMLAnchorElement} anchor @param {Record} record */ function download(anchor,record) { anchor.href=imageUrls(record).pixel; anchor.download=`${record.name.replace(/[\\/:*?"<>|]/g,'_') || 'chroma'}-pixel.png`; }
  function renderBoard() {
    el('board').replaceChildren();
    for (const record of [...records.values()].sort((a,b)=>b.createdAt-a.createdAt)) {
      const card=node('article','mood-card'); card.dataset.id=record.id;
      const media=node('div','card-media'); const img=/** @type {HTMLImageElement} */(node('img','card-image')); img.src=imageUrls(record).source; img.alt=record.name; media.append(img);
      const tabs=node('div','card-tabs');
      for(const [label,isPixel] of /** @type {[string,boolean][]} */([['원본',false],['픽셀',true]])) {
        const tab=node('button','card-tab',label); tab.setAttribute('aria-selected',String(!isPixel)); tab.classList.toggle('is-active',!isPixel);
        tab.addEventListener('click',()=>{img.src=isPixel?imageUrls(record).pixel:imageUrls(record).source;img.classList.toggle('is-pixel',isPixel);for(const other of tabs.children){other.setAttribute('aria-selected',String(other===tab));other.classList.toggle('is-active',other===tab);}}); tabs.append(tab);
      }
      media.append(tabs); const body=node('div','card-body');body.append(node('h2','card-name',record.name),node('p','card-caption',`${record.width} × ${record.height} · ${record.pixelMode === 'detail' ? '세밀' : record.pixelMode === 'style' ? '픽셀 스타일' : '원본 색 유지'} · ${record.columns}칸`));
      const colors=node('div','card-palette');palette(colors,record);body.append(colors);
      const actions=node('div','card-actions');const open=node('button','card-open','자세히 보기');open.addEventListener('click',()=>openDetail(record.id));
      const anchor=/** @type {HTMLAnchorElement} */(node('a','card-download','PNG 저장'));download(anchor,record);actions.append(open,anchor);body.append(actions);card.append(media,body);el('board').append(card);
    }
    el('board-count').textContent=String(records.size);el('empty-state').hidden=records.size>0;
  }
  function renderDetail() {
    const record=records.get(selected);if(!record)return;
    const pending=pendingSettings.get(record.id);
    const mode=pending?.pixelMode??record.pixelMode??'original';
    columnsInput.value=String(pending?.columns??record.columns);modeInput.value=mode;
    columnsInput.disabled=modeInput.disabled=Boolean(pending);
    el('pixel-settings').setAttribute('aria-busy',String(Boolean(pending)));
    el('pixel-mode-description').textContent=mode==='detail'?'얇은 윤곽 · 최대 64색 · 디더링 없음':mode==='style'?'잔질감 정리 · 32색 · 디더링 없음':'원본 색을 그대로 담아요.';
    el('pixel-settings-status').textContent=pending?'픽셀아트를 만들고 저장하고 있어요…':'';
    el('detail-meta').textContent=`${record.width} × ${record.height} · 픽셀 ${record.gridWidth} × ${record.gridHeight}`;
    const img=/** @type {HTMLImageElement} */(el('detail-image'));img.src=pixelView?imageUrls(record).pixel:imageUrls(record).source;img.alt=record.name;img.classList.toggle('is-pixel',pixelView);
    for(const [id,active] of /** @type {[string,boolean][]} */([['detail-source-tab',!pixelView],['detail-pixel-tab',pixelView]])){el(id).setAttribute('aria-selected',String(active));el(id).classList.toggle('is-active',active);}
    palette(el('detail-palette'),record);
  }
  /** @param {string} id */ function openDetail(id) { selected=id;generation++;pixelView=false;nameInput.value=records.get(id)?.name??'';renderDetail();detail.showModal(); }
  function closeDetail(){selected='';generation++;detail.close();}
  el('detail-close').addEventListener('click',closeDetail); detail.addEventListener('cancel',()=>{selected='';generation++;});
  el('detail-source-tab').addEventListener('click',()=>{pixelView=false;renderDetail();});el('detail-pixel-tab').addEventListener('click',()=>{pixelView=true;renderDetail();});
  function saveTitle(){
    const id=selected;const token=generation;const name=nameInput.value.trim();if(!id)return;
    if(!name){nameInput.value=records.get(id)?.name??'';toast('제목을 입력해 주세요.');return;}
    enqueue(async()=>{const old=records.get(id);if(!old||old.name===name)return;const next={...old,name};await store.put(next);records.set(id,next);renderBoard();if(selected===id&&generation===token)el('detail-image').setAttribute('alt',name);toast('제목을 저장했습니다.');});
  }
  nameInput.addEventListener('change',saveTitle);nameInput.addEventListener('blur',saveTitle);
  function savePixelSettings(){
    const id=selected;const token=generation;const columns=Number(columnsInput.value);const pixelMode=modeInput.value;
    if(!records.has(id)||![32,64,96,128].includes(columns)||(pixelMode!=='original'&&pixelMode!=='style'&&pixelMode!=='detail'))return;
    /** @type {{columns:number,pixelMode:'original'|'style'|'detail'}} */ const settings={columns,pixelMode};pendingSettings.set(id,settings);renderDetail();
    enqueue(async()=>{
      const old=records.get(id);if(!old)return;
      status('픽셀아트를 변환하고 있습니다…');
      try{
        const result=await pixelRenderer(old.sourceBlob,columns,pixelMode);
        /** @type {Record} */ const next={...old,...result,...settings};
        await store.put(next);records.set(id,next);renderBoard();
        if(selected===id&&generation===token&&pendingSettings.get(id)===settings&&(pixelMode==='style'||pixelMode==='detail'))pixelView=true;
        status('픽셀 설정을 저장했습니다.');
      }finally{
        if(pendingSettings.get(id)===settings)pendingSettings.delete(id);
        if(selected===id)renderDetail();
      }
    });
  }
  columnsInput.addEventListener('change',savePixelSettings);modeInput.addEventListener('change',savePixelSettings);
  el('download-pixel').addEventListener('click',()=>{const record=records.get(selected);if(!record)return;const anchor=doc.createElement('a');download(anchor,record);doc.body.append(anchor);anchor.click();anchor.remove();});
  el('delete-card').addEventListener('click',()=>{pendingDelete=selected;deletion.showModal();});
  el('delete-cancel').addEventListener('click',()=>{pendingDelete='';deletion.close();});
  el('delete-confirm').addEventListener('click',()=>{const id=pendingDelete;pendingDelete='';deletion.close();if(!id)return;enqueue(async()=>{await store.remove(id);records.delete(id);if(selected===id)closeDetail();const entry=urls.get(id);if(entry){url.revokeObjectURL(entry.source);url.revokeObjectURL(entry.pixel);urls.delete(id);}renderBoard();toast('카드를 삭제했습니다.');});});
  const retry=/** @type {HTMLButtonElement} */(node('button','restore-retry','다시 불러오기'));retry.hidden=true;el('status-message').after(retry);retry.addEventListener('click',()=>{void init();});
  async function init(){ready=false;status('저장된 카드를 불러오고 있습니다…');try{store??=await createBoardStore();const restored=await store.list();records.clear();for(const entry of urls.values()){url.revokeObjectURL(entry.source);url.revokeObjectURL(entry.pixel);}urls.clear();for(const record of restored)records.set(record.id,record);renderBoard();ready=true;retry.hidden=true;status('이미지를 올리면 팔레트와 픽셀아트를 함께 저장합니다.');}catch(error){status(`복원 실패: ${message(error)}`);retry.hidden=false;}}
  /** @param {Iterable<File>} files */ function addFiles(files){const list=[...files];return enqueue(async()=>{
    if(!ready){status('저장된 카드를 먼저 불러와 주세요. 다시 불러오기를 눌러 주세요.');return;}
    el('processing-indicator').hidden=false;
    try{for(const file of list){status(`${file.name} 처리 중…`);try{const result=await processor(file,{pixelMode:'detail',columns:96});const record={...result,id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'')||file.name,createdAt:Date.now()};await store.put(record);records.set(record.id,record);renderBoard();status(`${file.name} 저장 완료`);toast('팔레트와 픽셀아트를 저장했습니다.');}catch(error){status(`${file.name}: ${message(error)}`);}}}finally{el('processing-indicator').hidden=true;fileInput.value='';}
  });}
  el('upload-trigger').addEventListener('click',()=>fileInput.click());fileInput.addEventListener('change',()=>{void addFiles(Array.from(fileInput.files??[]));});
  for(const type of ['dragover','dragenter'])el('drop-zone').addEventListener(type,event=>{event.preventDefault();el('drop-zone').classList.add('is-dragover');});
  el('drop-zone').addEventListener('dragleave',()=>el('drop-zone').classList.remove('is-dragover'));
  el('drop-zone').addEventListener('drop',event=>{event.preventDefault();el('drop-zone').classList.remove('is-dragover');void addFiles(Array.from(event.dataTransfer?.files??[]));});
  return {init,addFiles};
}
if (typeof document !== 'undefined') { const app=createApp(); void app.init(); }
