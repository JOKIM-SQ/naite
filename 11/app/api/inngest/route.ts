import {serve} from 'inngest/next';
import {inngest} from '@/inngest/client';
import {triageTicket} from '@/inngest/functions';
export const runtime='nodejs';
export const maxDuration=120;
export const {GET,POST,PUT}=serve({client:inngest,functions:[triageTicket]});
