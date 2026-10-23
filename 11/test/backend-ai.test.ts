import {afterEach,expect,it,vi} from 'vitest';
import type {StoredTicket} from '../lib/store';
const boundary=vi.hoisted(()=>({generate:vi.fn(async(options:unknown)=>{void options;return {output:{}};})}));
vi.mock('ai',async original=>({...await original<object>(),generateText:boundary.generate}));
import {classifyWithAI} from '../lib/ai';
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('uses explicitly configured direct Anthropic credentials without Gateway billing',async()=>{
 vi.stubEnv('ANTHROPIC_API_KEY','test-only-credential');vi.stubEnv('ANTHROPIC_MODEL','claude-test-model');
 await classifyWithAI({subject:'test',message:'untrusted'} as StoredTicket);
 const options=boundary.generate.mock.calls[0][0] as {model:{provider:string;modelId:string};maxRetries:number};
 expect(options.model.provider).toContain('anthropic');expect(options.model.modelId).toBe('claude-test-model');expect(options.maxRetries).toBe(0);
});
