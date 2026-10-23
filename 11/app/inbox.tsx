'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, CheckCheck, CircleAlert, Clock3, Copy, Inbox as InboxIcon, Layers3, LoaderCircle, LockKeyhole, Mail, MessageSquare, Plus, RefreshCw, Send, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react';
import type { DemoMode, NewTicket, Ticket, TicketCategory, TicketChannel, TicketStatus } from '../lib/contracts';

type Filter = 'all' | 'processing' | 'review' | 'failed';
const categoryLabels: Record<TicketCategory, string> = { billing:'결제 · 환불', account:'계정 · 로그인', technical:'기술 지원', delivery:'배송 · 주문', other:'기타 문의' };
const channelLabels: Record<TicketChannel, string> = {email:'이메일',chat:'채팅',web:'웹 문의'};
const statusLabels: Record<TicketStatus, string> = {queued:'접수됨',classifying:'문의 분류 중',drafting:'초안 작성 중',retrying:'재시도 대기',completed:'처리 완료',failed:'처리 실패'};
const active = (ticket: Ticket) => !['completed','failed'].includes(ticket.status);
const dateLabel = (date: string, time = false) => new Intl.DateTimeFormat('ko-KR', time ? {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false} : {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(date));
const presets = [
  {name:'결제 · 환불',subject:'중복 결제 확인을 부탁드려요',message:'오늘 월간 구독을 결제했는데 같은 금액이 두 번 청구됐습니다. 중복 결제인지 확인해 주시고, 중복이라면 취소 절차를 안내해 주세요.'},
  {name:'복합 문의',subject:'로그인도 안 되고 배송도 확인이 안 돼요',message:'어제 비밀번호를 바꾼 뒤 로그인이 안 됩니다. 지난주 주문한 상품의 배송 상태도 확인하고 싶은데 어디서 확인할 수 있나요?'},
  {name:'기술 지원',subject:'파일 업로드 중 오류가 발생해요',message:'크롬 브라우저에서 PDF 파일을 올리면 업로드가 멈추고 오류가 표시됩니다. 다른 파일도 동일한데 어떤 정보를 보내드리면 확인이 가능할까요?'},
];

function Badge({ticket}:{ticket:Ticket}) {
  const review = ticket.status === 'completed' && ticket.needs_review;
  return <span className={`badge ${review ? 'review' : ticket.status}`}>{review ? '검토 필요' : statusLabels[ticket.status]}</span>;
}

export default function Inbox() {
  const [tickets,setTickets] = useState<Ticket[]>([]);
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [filter,setFilter] = useState<Filter>('all');
  const [loading,setLoading] = useState(true);
  const [loaded,setLoaded] = useState(false);
  const [error,setError] = useState('');
  const [dialog,setDialog] = useState(false);
  const [preset,setPreset] = useState<number|null>(null);
  const [retrying,setRetrying] = useState(false);
  const [announcement,setAnnouncement] = useState('');
  const generation = useRef(0);
  const request = useRef<AbortController|null>(null);
  const mutation = useRef<AbortController|null>(null);
  const protectedTickets = useRef(new Map<string,Ticket>());
  const mounted = useRef(false);

  const refresh = useCallback(async()=>{
    if(request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const version = generation.current;
    try {
      const response = await fetch('/api/tickets',{cache:'no-store',signal:controller.signal});
      const body = await response.json();
      if(!response.ok || !Array.isArray(body.tickets)) throw new Error(body.error || '문의 목록을 불러오지 못했어요.');
      if(!mounted.current || version !== generation.current) return;
      const next:Ticket[] = body.tickets;
      for(const [id,ticket] of protectedTickets.current){
        if(next.some(item=>item.id===id)) protectedTickets.current.delete(id);
        else next.unshift(ticket);
      }
      setTickets(next);
      setLoaded(true);
      setError('');
    } catch(cause) {
      if(!controller.signal.aborted && mounted.current && version === generation.current) setError(cause instanceof Error ? cause.message : '연결을 확인해 주세요.');
    } finally {
      if(request.current===controller){
        request.current=null;
        if(mounted.current) setLoading(false);
      }
    }
  },[]);

  useEffect(()=>{
    mounted.current=true;
    let timer:ReturnType<typeof setTimeout>;
    let stopped=false;
    const poll=async()=>{
      if(document.visibilityState!=='hidden') await refresh();
      if(!stopped) timer=setTimeout(poll,2500);
    };
    void poll();
    const visible=()=>{if(document.visibilityState==='visible') void refresh();};
    document.addEventListener('visibilitychange',visible);
    return ()=>{stopped=true;mounted.current=false;clearTimeout(timer);request.current?.abort();request.current=null;mutation.current?.abort();document.removeEventListener('visibilitychange',visible);};
  },[refresh]);

  const acceptTicket = useCallback((ticket:Ticket)=>{
    generation.current++;
    protectedTickets.current.set(ticket.id,ticket);
    setTickets(current=>[ticket,...current.filter(item=>item.id!==ticket.id)]);
    setSelectedId(ticket.id);
    setFilter('all');
    setLoaded(true);
  },[]);

  const openDialog=(example:number|null=null)=>{if(!loaded)return;setPreset(example);setDialog(true);};
  const closeDialog=useCallback(()=>setDialog(false),[]);
  const submit=async(input:NewTicket)=>{
    if(!loaded) throw new Error('작업 공간 연결이 완료된 뒤 문의를 접수할 수 있어요.');
    generation.current++;
    const controller=new AbortController();
    mutation.current=controller;
    const response=await fetch('/api/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal});
    const body=await response.json();
    if(!mounted.current) return;
    if(body.ticket) acceptTicket(body.ticket);
    if(!response.ok) throw new Error(body.error || '문의를 접수하지 못했어요. 다시 시도해 주세요.');
    if(!body.ticket) throw new Error('접수 결과를 확인하지 못했어요. 목록을 확인해 주세요.');
    setAnnouncement('문의가 접수됐어요. 처리 과정은 목록에서 확인할 수 있어요.');
    setDialog(false);
  };

  const retry=async(ticket:Ticket)=>{
    if(retrying) return;
    setRetrying(true);
    generation.current++;
    const controller=new AbortController();
    mutation.current=controller;
    try {
      const response=await fetch(`/api/tickets/${encodeURIComponent(ticket.id)}/retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({demo_mode:'none'}),signal:controller.signal});
      const body=await response.json();
      if(!mounted.current) return;
      if(body.ticket) acceptTicket(body.ticket);
      if(!response.ok || !body.ticket) throw new Error(body.error || '재시도를 시작하지 못했어요.');
      setError('');
      setAnnouncement('다시 처리를 시작했어요.');
    }catch(cause){if(mounted.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '연결을 확인해 주세요.');}
    finally{if(mounted.current)setRetrying(false);}
  };

  const counts={all:tickets.length,processing:tickets.filter(active).length,review:tickets.filter(t=>t.status==='completed'&&t.needs_review).length,failed:tickets.filter(t=>t.status==='failed').length};
  const completed=tickets.filter(t=>t.status==='completed').length;
  const filtered=tickets.filter(t=>filter==='all'||(filter==='processing'&&active(t))||(filter==='review'&&t.status==='completed'&&t.needs_review)||(filter==='failed'&&t.status==='failed'));
  const selected=filtered.find(t=>t.id===selectedId)??filtered[0];
  return <div className="app-shell">
    <aside className="rail" aria-label="서비스 안내"><Link className="brand-symbol" href="/" aria-label="릴레이 홈"><ArrowUpRight strokeWidth={2.6}/></Link><div className="rail-item"><InboxIcon/><span>인박스</span></div><span className="rail-bottom">A LITTLE LESS BUSY.</span></aside>
    <main className="workspace">
      <header className="topbar"><div><Link className="wordmark" href="/" style={{textDecoration:'none'}}>RELAY<i/></Link><p className="topbar-sub">고객의 이야기, 다음 단계로.</p></div><div className="topbar-right"><span className="private-label"><LockKeyhole/>이 브라우저의 작업 공간</span><button className="button primary" disabled={!loaded} aria-describedby={!loaded?'workspace-bootstrap':undefined} onClick={()=>openDialog()}><Plus/>새 문의</button></div></header>
      {!loaded&&<p id="workspace-bootstrap" className="sr-only" role="status">{loading?'작업 공간에 연결하고 있어요. 연결이 끝나면 새 문의를 접수할 수 있어요.':'작업 공간 연결을 완료해야 문의를 접수할 수 있어요. 다시 불러오기를 눌러 주세요.'}</p>}
      <section className="intro"><div><div className="eyebrow">YOUR SUPPORT DESK</div><h1>문의는 차분하게, 답변은 가깝게.</h1><p>고객의 이야기를 정리하고, 답변을 위한 첫 문장을 준비해요.</p></div><span className="intro-note"><Layers3/>접수부터 초안까지, 백그라운드에서</span></section>
      <section className="stats" aria-label="문의 현황">
        <Stat label="전체 문의" value={loaded?counts.all:null} icon={<InboxIcon/>}/><Stat label="처리 중" value={loaded?counts.processing:null} icon={<Layers3/>} tone="processing"/><Stat label="검토 필요" value={loaded?counts.review:null} icon={<CircleAlert/>} tone="review"/><Stat label="처리 완료" value={loaded?completed:null} icon={<CheckCheck/>} tone="complete"/>
      </section>
      {error&&<div className="notice" role="alert"><span>{error} {loaded&&'보관된 목록을 보여드리고 있어요.'}</span><button onClick={()=>void refresh()}>다시 불러오기</button></div>}
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      <section className="board" aria-label="문의 인박스" aria-busy={loading}>
        <div className="board-toolbar"><nav className="filters" aria-label="문의 상태별 보기">{([['all','전체'],['processing','처리 중'],['review','검토 필요'],['failed','실패']] as const).map(([value,label])=><button key={value} className="filter" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label} <span>{counts[value]}</span></button>)}</nav><span className="sync-note"><RefreshCw/>화면을 보는 동안 자동 갱신</span></div>
        {loading?<div className="loading-state" role="status"><LoaderCircle className="spin" size={18}/>문의함을 불러오고 있어요</div>:!loaded?<div className="empty-state"><CircleAlert size={32}/><h2>문의함에 연결하지 못했어요</h2><p>위의 다시 불러오기 버튼으로 연결을 확인해 주세요.</p></div>:tickets.length===0?<Empty ready={loaded} onNew={()=>openDialog()} onExample={()=>openDialog(0)}/>:<div className="inbox-grid">
          <div className="ticket-list" aria-label="문의 목록"><div className="list-heading"><span>INCOMING</span><span>{filtered.length}건</span></div>{filtered.length===0?<p className="list-empty">이 상태의 문의가 아직 없어요.</p>:filtered.map(ticket=><button key={ticket.id} className="ticket-row" aria-pressed={selected?.id===ticket.id} onClick={()=>setSelectedId(ticket.id)}><div className="ticket-row-head"><span className="customer"><span className="avatar">{ticket.customer_name.slice(0,1)}</span>{ticket.customer_name}</span><time dateTime={ticket.created_at}>{dateLabel(ticket.created_at)}</time></div><h3>{ticket.subject}</h3><p className="ticket-preview">{ticket.message}</p><div className="ticket-row-bottom"><Badge ticket={ticket}/><span className="category-small">{ticket.category?categoryLabels[ticket.category]:channelLabels[ticket.channel]}</span></div></button>)}</div>
          {selected?<TicketDetail key={selected.id} ticket={selected} retrying={retrying} onRetry={()=>void retry(selected)}/>:<div className="empty-state"><CheckCheck size={31} color="#968575"/><h2>여기는 아직 조용하네요.</h2><p>다른 상태를 선택하면 문의를 이어서 볼 수 있어요.</p></div>}
        </div>}
      </section>
      <footer className="workspace-footer"><span>RELAY · AI가 정리하고, 사람이 확인합니다.</span><div><span>답변은 자동으로 발송되지 않아요</span><a href="/docs/plan.html" target="_blank" rel="noreferrer">기획서 ↗</a><a href="/docs/report.html" target="_blank" rel="noreferrer">스택 리포트 ↗</a></div></footer>
    </main>
    {dialog&&<NewTicketDialog initialPreset={preset} onClose={closeDialog} onSubmit={submit}/>}
  </div>;
}

function Stat({label,value,icon,tone=''}:{label:string;value:number|null;icon:React.ReactNode;tone?:string}){
  return <div className={`stat ${tone}`}><div><p className="stat-label">{label}</p><p className="stat-value">{value??'—'}<span className="stat-unit">건</span></p></div><span className="stat-icon">{icon}</span></div>;
}

function Empty({ready,onNew,onExample}:{ready:boolean;onNew:()=>void;onExample:()=>void}){
  return <div className="empty-state"><div className="empty-art" aria-hidden="true"><div className="empty-paper"/><div className="empty-stamp"><ArrowUpRight/></div></div><h2>첫 문의를 받아볼까요?</h2><p>문의 한 건을 남겨보세요.<br/>분류와 답변 초안을 준비하는 과정을 함께 볼 수 있어요.</p><div className="empty-actions"><button className="button primary" disabled={!ready} onClick={onNew}><Plus/>새 문의</button><button className="button" disabled={!ready} onClick={onExample}>예시 문의로 시작<ArrowRight/></button></div></div>;
}

function TicketDetail({ticket,retrying,onRetry}:{ticket:Ticket;retrying:boolean;onRetry:()=>void}){
  const [now,setNow]=useState(()=>Date.now());
  const [copied,setCopied]=useState(false);
  const [copyError,setCopyError]=useState(false);
  const draftRef=useRef<HTMLDivElement>(null);
  const isActive=active(ticket);
  useEffect(()=>{if(!isActive)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[isActive]);
  const elapsed=Math.max(0,Math.floor((now-new Date(ticket.created_at).getTime())/1000));
  const copy=async()=>{
    try{await navigator.clipboard.writeText(ticket.draft??'');setCopied(true);setCopyError(false);}
    catch{setCopyError(true);const selection=window.getSelection();if(draftRef.current&&selection){const range=document.createRange();range.selectNodeContents(draftRef.current);selection.removeAllRanges();selection.addRange(range);draftRef.current.focus();}}
  };
  const stageMessage:Record<TicketStatus,[string,string]>={queued:['문의가 접수됐어요','백그라운드 작업이 시작되면 처리 상태가 여기에 표시돼요.'],classifying:['문의의 맥락을 읽고 있어요','문의 유형과 우선순위를 살펴보고 있어요.'],drafting:['답변의 첫 문장을 준비해요','분류한 내용을 바탕으로 답변 초안을 작성하고 있어요.'],retrying:['잠시 후 다시 시도해요','작업 중 오류가 발생했어요. 자동 재시도 기록을 아래에서 확인할 수 있어요.'],completed:['',''],failed:['','']};
  return <article className="detail" aria-label="선택한 문의 상세">
    <div className="detail-top"><span className="detail-kicker">TICKET / {ticket.id.slice(0,8).toUpperCase()}</span><Badge ticket={ticket}/></div><h2>{ticket.subject}</h2>
    <div className="detail-meta"><span><UserRound/>{ticket.customer_name}</span><span><Mail/>{channelLabels[ticket.channel]}</span><span><Clock3/><time dateTime={ticket.created_at}>{dateLabel(ticket.created_at)}</time></span></div>
    <h3 className="section-label"><MessageSquare/>고객이 남긴 이야기</h3><div className="message-body">{ticket.message}</div>
    {ticket.demo_mode!=='none'&&<p className="demo-tag">데모 시나리오 · {ticket.demo_mode==='transient'?'첫 분류 시도 실패 후 자동 재시도':'모든 분류 시도 실패'}</p>}
    {isActive&&<div className="processing-box" role="status"><div className="processing-art" aria-hidden="true"><i/><i/><i/></div><div><h3>{stageMessage[ticket.status][0]}</h3><p>{stageMessage[ticket.status][1]}</p><p className="processing-elapsed">접수 후 {elapsed>=60?`${Math.floor(elapsed/60)}분 `:''}{elapsed%60}초 경과 · {statusLabels[ticket.status]}</p></div></div>}
    {ticket.status==='failed'&&<div className="failed-box" role="status"><CircleAlert/><div><h3>처리를 마치지 못했어요</h3><p>{ticket.error||'일시적인 오류가 발생했어요. 다시 처리할 수 있어요.'}</p><button className="button small" onClick={onRetry} disabled={retrying}><RefreshCw className={retrying?'spin':''}/>{retrying?'다시 접수하는 중…':'다시 처리하기'}</button>{ticket.demo_mode!=='none'&&<p className="demo-tag">다시 처리하면 데모 실패 조건이 해제돼요.</p>}</div></div>}
    {ticket.category&&<section className="classification"><h3 className="section-label"><Layers3/>분류한 내용</h3><div className="result-pills"><span className="result-pill">{categoryLabels[ticket.category]}</span>{ticket.priority&&<span className="result-pill">우선순위 <strong>{{low:'낮음',normal:'보통',high:'높음'}[ticket.priority]}</strong></span>}{ticket.confidence!==null&&<span className="result-pill" tabIndex={0} title="AI가 스스로 판단한 신뢰도이며, 실제 정확도를 의미하지 않습니다.">AI 신뢰도 {Math.round(ticket.confidence*100)}%</span>}</div>{ticket.reason&&<p className="reason">{ticket.reason}</p>}{ticket.needs_review&&<div className="review-note"><CircleAlert/><div><strong>담당자의 확인이 필요해요</strong><p>{ticket.review_reason||'분류 결과와 원문을 함께 확인해 주세요.'}</p></div></div>}</section>}
    {ticket.draft&&<section className="draft-block"><div className="draft-head"><h3 className="section-label"><Sparkles/>답변 초안</h3><button className="button quiet small" onClick={()=>void copy()}>{copied?<Check/>:<Copy/>}{copied?'복사 완료':'초안 복사'}</button></div><div className="draft-content" ref={draftRef} tabIndex={-1}>{ticket.draft}</div>{copyError&&<p className="copy-status" role="status">자동 복사가 어려워 초안을 선택했어요. Ctrl+C 또는 ⌘C로 복사해 주세요.</p>}<p className="draft-foot"><ShieldCheck/>발송 전 사실관계와 안내 내용을 확인해 주세요. 자동 발송되지 않습니다.</p></section>}
    <section className="timeline-section"><h3 className="section-label"><Clock3/>처리 기록</h3>{ticket.events.length?<ol className="timeline">{ticket.events.map(event=><li key={event.id}><span className="event-dot"/><span className="event-message">{event.message}{event.attempt>0&&<span className="event-attempt">시도 {event.attempt}</span>}</span><time dateTime={event.at} title={dateLabel(event.at)}>{dateLabel(event.at,true)}</time></li>)}</ol>:<p className="reason">첫 처리 기록을 기다리고 있어요.</p>}</section>
  </article>;
}

function NewTicketDialog({initialPreset,onClose,onSubmit}:{initialPreset:number|null;onClose:()=>void;onSubmit:(ticket:NewTicket)=>Promise<void>}){
  const [form,setForm]=useState<NewTicket>({subject:initialPreset!==null?presets[initialPreset].subject:'',message:initialPreset!==null?presets[initialPreset].message:'',customer_name:'고객',channel:'web',demo_mode:'none'});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const dialogRef=useRef<HTMLDivElement>(null);
  const titleRef=useRef<HTMLInputElement>(null);
  const busyRef=useRef(false);
  useEffect(()=>{
    const previous=document.activeElement;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    titleRef.current?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();if(!busyRef.current)onClose();}
      if(event.key==='Tab'){
        const focusable=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')??[]).filter(el=>!el.closest('details:not([open])')||el.tagName==='SUMMARY');
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',key);
    return()=>{document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',key);if(previous instanceof HTMLElement)previous.focus();};
  },[onClose]);
  const update=<K extends keyof NewTicket>(key:K,value:NewTicket[K])=>setForm(current=>({...current,[key]:value}));
  const send=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError('');
    try{await onSubmit({...form,subject:form.subject.trim(),message:form.message.trim(),customer_name:form.customer_name.trim()||'고객'});}
    catch(cause){setError(cause instanceof Error?cause.message:'연결에 문제가 생겼어요. 다시 시도해 주세요.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-ticket-title" ref={dialogRef}><div className="dialog-head"><div><div className="eyebrow">A NEW CONVERSATION</div><h2 id="new-ticket-title">어떤 문의가 도착했나요?</h2><p>접수하면 문의 분류와 답변 초안을 준비해요.</p></div><button className="icon-button" aria-label="새 문의 닫기" disabled={busy} onClick={onClose}><X/></button></div>
    <div className="preset-row" aria-label="예시 문의 채우기">{presets.map((item,index)=><button key={item.name} disabled={busy} onClick={()=>{setForm(current=>({...current,subject:presets[index].subject,message:presets[index].message}));titleRef.current?.focus();}}>예시 · {item.name}</button>)}</div>
    <form onSubmit={event=>void send(event)} aria-busy={busy}><div className="field-row"><div className="field"><label htmlFor="customer-name">고객 이름</label><input id="customer-name" value={form.customer_name} onChange={e=>update('customer_name',e.target.value)} maxLength={80} disabled={busy}/></div><div className="field"><label htmlFor="ticket-channel">접수 채널</label><select id="ticket-channel" value={form.channel} onChange={e=>update('channel',e.target.value as TicketChannel)} disabled={busy}><option value="web">웹 문의</option><option value="email">이메일</option><option value="chat">채팅</option></select></div></div>
    <div className="field"><label htmlFor="ticket-subject">제목</label><input ref={titleRef} id="ticket-subject" value={form.subject} onChange={e=>update('subject',e.target.value)} minLength={5} maxLength={120} placeholder="문의의 핵심을 한 줄로 적어주세요" required disabled={busy}/></div><div className="field"><label htmlFor="ticket-message">문의 내용</label><textarea id="ticket-message" value={form.message} onChange={e=>update('message',e.target.value)} minLength={10} maxLength={5000} placeholder="고객이 남긴 이야기를 그대로 적어주세요." required disabled={busy}/><div className="field-hint"><span>10자 이상 · 민감한 개인정보는 제외해 주세요</span><span>{form.message.length.toLocaleString()} / 5,000</span></div></div>
    <details className="demo-options"><summary>데모 시나리오 설정</summary><p>자동 재시도와 실패 상태를 실제 작업으로 확인할 수 있어요.</p>{([['none','정상 처리'],['transient','첫 분류 실패 → 자동 재시도'],['permanent','계속 실패 → 최종 실패 표시']] as const).map(([value,label])=><label key={value} className="demo-choice"><input type="radio" name="demo-mode" value={value} checked={form.demo_mode===value} onChange={()=>update('demo_mode',value as DemoMode)} disabled={busy}/>{label}</label>)}</details>
    {error&&<p className="dialog-error" role="alert">{error}</p>}<div className="dialog-footer"><p>분류를 기다리지 않아도 괜찮아요.<br/>접수 후 문의함에서 이어서 확인하세요.</p><button type="submit" className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Send/>}{busy?'접수하는 중…':'문의 접수하기'}</button></div></form>
  </div></div>;
}
