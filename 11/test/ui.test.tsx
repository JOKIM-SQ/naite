// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Inbox from '../app/inbox';
import type { Ticket } from '../lib/contracts';

const ticket: Ticket = { id:'ticket-1', subject:'결제 중복 확인 요청', message:'결제가 두 번 진행되어 확인이 필요합니다.', customer_name:'김지우', channel:'web', status:'completed', category:'billing', priority:'normal', confidence:0.6, needs_review:true, review_reason:'결제 내역을 확인해야 합니다.', reason:'결제 관련 문의입니다.', draft:'결제 내역을 확인해 안내드리겠습니다.', error:null, attempts:1, demo_mode:'none', created_at:'2026-10-22T10:00:00Z', updated_at:'2026-10-22T10:00:05Z', completed_at:'2026-10-22T10:00:05Z', events:[{id:'event-1',at:'2026-10-22T10:00:05Z',stage:'completed',message:'답변 초안을 준비했습니다.',attempt:1}] };
afterEach(() => {cleanup();vi.unstubAllGlobals();});
function respond(body:unknown, status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
describe('실제 문의 인박스',()=>{
  it('작업공간 최초 조회 성공 전에는 문의 접수를 열지 않는다',async()=>{
    let resolveBootstrap:(response:Response)=>void=()=>{};
    let failed=false;
    vi.stubGlobal('fetch',vi.fn(async()=>{
      if(failed) return respond({tickets:[]});
      return new Promise<Response>(resolve=>{resolveBootstrap=resolve;});
    }));
    render(<Inbox/>);
    const newButton=screen.getByRole('button',{name:'새 문의'}) as HTMLButtonElement;
    expect(newButton.disabled).toBe(true);
    fireEvent.click(newButton);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async()=>resolveBootstrap(respond({error:'작업공간 연결 실패'},503)));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(newButton.disabled).toBe(true);
    fireEvent.click(newButton);
    expect(screen.queryByRole('dialog')).toBeNull();
    failed=true;
    fireEvent.click(screen.getByRole('button',{name:'다시 불러오기'}));
    await screen.findByText('첫 문의를 받아볼까요?');
    expect(newButton.disabled).toBe(false);
    fireEvent.click(newButton);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('서버가 빈 목록을 주면 가짜 결과 없이 등록 동선을 보여준다',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>respond({tickets:[]})));
    render(<Inbox/>);
    expect(await screen.findByText('첫 문의를 받아볼까요?')).toBeTruthy();
    expect(screen.queryByText(ticket.subject)).toBeNull();
  });
  it('검토 필요 결과와 실제 초안·타임라인을 표시한다',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>respond({tickets:[ticket]})));
    render(<Inbox/>);
    expect(await screen.findByText(ticket.draft!)).toBeTruthy();
    expect(screen.getByText(ticket.review_reason!)).toBeTruthy();
    expect(screen.getByText('답변 초안을 준비했습니다.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/실패 0/}));
    expect(screen.queryByText(ticket.draft!)).toBeNull();
  });
  it('접수 오류에서 입력을 보존하고 재제출 성공 시 실제 티켓을 선택한다',async()=>{
    let shouldFail=true;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{
      if(options?.method==='POST'){
        const body=JSON.parse(String(options.body));
        if(shouldFail)return respond({error:'접수 연결을 확인해 주세요.'},503);
        return respond({ticket:{...ticket,subject:body.subject,message:body.message,status:'queued',draft:null,category:null,needs_review:false,events:[]}},202);
      }
      return respond({tickets:[]});
    }));
    render(<Inbox/>);
    await screen.findByText('첫 문의를 받아볼까요?');
    fireEvent.click(screen.getAllByRole('button',{name:'새 문의'})[0]);
    fireEvent.change(screen.getByLabelText('제목'),{target:{value:'주문을 취소하고 싶어요'}});
    fireEvent.change(screen.getByLabelText('문의 내용'),{target:{value:'어제 주문한 상품을 취소할 수 있는지 궁금합니다.'}});
    fireEvent.click(screen.getByRole('button',{name:'문의 접수하기'}));
    expect(await screen.findByText('접수 연결을 확인해 주세요.')).toBeTruthy();
    expect((screen.getByLabelText('제목') as HTMLInputElement).value).toBe('주문을 취소하고 싶어요');
    shouldFail=false;
    fireEvent.click(screen.getByRole('button',{name:'문의 접수하기'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByText('주문을 취소하고 싶어요').length).toBeGreaterThan(0);
    expect(screen.getByText('문의가 접수됐어요')).toBeTruthy();
  });
  it('초기 연결 실패를 빈 목록으로 위장하지 않고 다시 불러올 수 있다',async()=>{
    let failed=true;
    vi.stubGlobal('fetch',vi.fn(async()=>failed?respond({error:'목록 연결 실패'},503):respond({tickets:[ticket]})));
    render(<Inbox/>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('첫 문의를 받아볼까요?')).toBeNull();
    failed=false;
    fireEvent.click(screen.getByRole('button',{name:'다시 불러오기'}));
    expect(await screen.findByText(ticket.draft!)).toBeTruthy();
  });
  it('실패 문의 재시도는 데모 실패 조건을 해제하고 접수 상태로 바뀐다',async()=>{
    const failedTicket={...ticket,status:'failed',draft:null,error:'분류 작업에 실패했습니다.',demo_mode:'permanent'};
    vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
      if(options?.method==='POST'){
        if(url!=='/api/tickets/ticket-1/retry'||JSON.parse(String(options.body)).demo_mode!=='none')return respond({error:'잘못된 재시도 요청'},400);
        return respond({ticket:{...ticket,status:'queued',draft:null,needs_review:false,events:[]}},202);
      }
      return respond({tickets:[failedTicket]});
    }));
    render(<Inbox/>);
    fireEvent.click(await screen.findByRole('button',{name:'다시 처리하기'}));
    expect(await screen.findByText('문의가 접수됐어요')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'다시 처리하기'})).toBeNull();
  });
  it('늦게 도착한 이전 GET이 방금 접수한 문의를 지우지 않는다',async()=>{
    let resolveOld:(response:Response)=>void=()=>{};
    let gets=0;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{
      if(options?.method==='POST') return respond({ticket:{...ticket,status:'queued',draft:null,needs_review:false,events:[]}},202);
      gets++;
      if(gets===1) return respond({tickets:[]});
      return new Promise<Response>(resolve=>{resolveOld=resolve;});
    }));
    render(<Inbox/>);
    await screen.findByText('첫 문의를 받아볼까요?');
    fireEvent(document,new Event('visibilitychange'));
    fireEvent.click(screen.getByRole('button',{name:/예시 문의로 시작/}));
    fireEvent.click(screen.getByRole('button',{name:'문의 접수하기'}));
    await screen.findByText('문의가 접수됐어요');
    await act(async()=>resolveOld(respond({tickets:[]})));
    expect(screen.getByText('문의가 접수됐어요')).toBeTruthy();
    expect(screen.queryByText('첫 문의를 받아볼까요?')).toBeNull();
  });
  it('폴링 장애 중 기존 문의와 초안을 보존한다',async()=>{
    let fail=false;
    vi.stubGlobal('fetch',vi.fn(async()=>fail?respond({error:'새로고침 연결 실패'},503):respond({tickets:[ticket]})));
    render(<Inbox/>);
    await screen.findByText(ticket.draft!);
    fail=true;
    fireEvent(document,new Event('visibilitychange'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(ticket.draft!)).toBeTruthy();
  });
  it('모달은 키보드 포커스를 유지하고 Escape로 닫으면 열었던 버튼에 돌려준다',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>respond({tickets:[]})));
    render(<Inbox/>);
    await screen.findByText('첫 문의를 받아볼까요?');
    const opener=screen.getAllByRole('button',{name:'새 문의'})[0];
    opener.focus();fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText('제목'));
    screen.getByRole('button',{name:'문의 접수하기'}).focus();
    fireEvent.keyDown(document,{key:'Tab'});
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'새 문의 닫기'}));
    fireEvent.keyDown(document,{key:'Escape'});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });
});
