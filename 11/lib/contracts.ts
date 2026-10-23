export type TicketStatus = 'queued' | 'classifying' | 'drafting' | 'retrying' | 'completed' | 'failed';
export type TicketCategory = 'billing' | 'account' | 'technical' | 'delivery' | 'other';
export type TicketPriority = 'low' | 'normal' | 'high';
export type DemoMode = 'none' | 'transient' | 'permanent';
export type TicketChannel = 'email' | 'chat' | 'web';
export interface TicketEvent {
  id: string;
  at: string;
  stage: string;
  message: string;
  attempt: number;
}
export interface Ticket {
  id: string;
  subject: string;
  message: string;
  customer_name: string;
  channel: TicketChannel;
  status: TicketStatus;
  category: TicketCategory | null;
  priority: TicketPriority | null;
  confidence: number | null;
  needs_review: boolean;
  review_reason: string | null;
  reason: string | null;
  draft: string | null;
  error: string | null;
  attempts: number;
  demo_mode: DemoMode;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  events: TicketEvent[];
}
export interface NewTicket {
  subject: string;
  message: string;
  customer_name: string;
  channel: TicketChannel;
  demo_mode: DemoMode;
}
export interface TicketsResponse { tickets: Ticket[] }
