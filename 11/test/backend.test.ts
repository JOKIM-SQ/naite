import { describe, expect, it } from 'vitest';
import { newTicketSchema, classificationSchema, publicTicket, requireSameOrigin } from '../lib/validation';

describe('request and model trust boundaries', () => {
  it('rejects empty, oversized, and unexpected request fields', () => {
    const input = {subject:'결제 문의', message:'중복 결제가 되었습니다.', customer_name:'고객', channel:'web', demo_mode:'none'};
    expect(newTicketSchema.parse(input).subject).toBe('결제 문의');
    expect(newTicketSchema.safeParse({...input, message:' '}).success).toBe(false);
    expect(newTicketSchema.safeParse({...input, subject:'x'.repeat(201)}).success).toBe(false);
    expect(newTicketSchema.safeParse({...input, workspace_id:'other'}).success).toBe(false);
  });
  it('rejects invalid model output and sends uncertain classifications to review', () => {
    const input = {category:'billing', priority:'normal', confidence:0.5, needs_review:false, review_reason:null, reason:'결제 확인 필요'};
    expect(classificationSchema.parse(input).needs_review).toBe(true);
    expect(classificationSchema.safeParse({...input, confidence:1.5}).success).toBe(false);
    expect(classificationSchema.safeParse({...input, category:'invented'}).success).toBe(false);
  });
  it('never serializes workspace or execution credentials', () => {
    expect(publicTicket({id:'one', workspace_id:'private', run_token:'secret'})).toEqual({id:'one'});
  });
  it('timeline public ids remain stable without exposing execution tokens', () => {
    const row={id:'one',workspace_id:'private',run_token:'secret-token',events:[{id:'secret-token:queued:0',stage:'queued'},{id:'old-token:queued:0',stage:'queued'}]};
    const first=publicTicket(row);const second=publicTicket(row);
    expect(JSON.stringify(first)).not.toContain('secret-token');
    expect(JSON.stringify(first)).not.toContain('old-token');
    expect(first.events.map(e=>e.id)).toEqual(second.events.map(e=>e.id));
    expect(new Set(first.events.map(e=>e.id)).size).toBe(2);
  });
  it('rejects cross-origin mutation requests', () => {
    expect(() => requireSameOrigin(new Request('https://relay.test/api/tickets', {headers:{origin:'https://evil.test'}}))).toThrow();
    expect(() => requireSameOrigin(new Request('https://relay.test/api/tickets', {headers:{origin:'https://relay.test'}}))).not.toThrow();
  });
  it('accepts real request Host when Next normalizes loopback URL but rejects forwarded-host spoofing', () => {
    const headers={origin:'http://127.0.0.1:3110',host:'127.0.0.1:3110','x-forwarded-host':'127.0.0.1:3110','sec-fetch-site':'same-origin'};
    expect(()=>requireSameOrigin(new Request('http://localhost:3110/api/tickets',{headers}))).not.toThrow();
    expect(()=>requireSameOrigin(new Request('http://localhost:3110/api/tickets',{headers:{...headers,origin:'http://evil.test','x-forwarded-host':'evil.test'}}))).toThrow();
    expect(()=>requireSameOrigin(new Request('http://localhost:3110/api/tickets',{headers:{...headers,origin:'https://127.0.0.1:3110'}}))).toThrow();
    expect(()=>requireSameOrigin(new Request('http://localhost:3110/api/tickets',{headers:{...headers,'sec-fetch-site':'cross-site'}}))).toThrow();
  });
});
