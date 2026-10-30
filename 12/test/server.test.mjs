import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server.js';

const html = `<details class="sp"><summary id="s12"><span class="snm">MCP 서버 만들기</span><span class="scd">MCP</span><span class="sgl">실제 조회</span></summary><div class="sbody"><div class="rows"><div><div class="k">미션</div><div class="v">서버 연결</div></div><div><div class="k">골</div><div class="v">실제 데이터 답변</div></div><div><div class="k">제약</div><div class="v">읽기 전용</div></div></div></div></details>`;

async function connect(t, request) {
  const server = createServer(request);
  const client = new Client({name: 'weeknote-contract-test', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

// Catches accidental extra permissions/tools and schema widening at the MCP boundary.
test('MCP advertises exactly one fixed-source read-only tool with bounded week input', async t => {
  const client = await connect(t, async () => new Response(html));
  const {tools} = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['get_assignment']);
  const tool = tools[0];
  assert.deepEqual(tool.annotations, {readOnlyHint: true, destructiveHint: false, openWorldHint: true});
  assert.equal(typeof tool.description, 'string');
  assert.ok(tool.description.trim().length > 0);
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['week']);
  assert.deepEqual(tool.inputSchema.required, ['week']);
  assert.equal(tool.inputSchema.additionalProperties, false);
  const advertisedPattern = new RegExp(tool.inputSchema.properties.week.pattern);
  assert.equal(advertisedPattern.test('S12'), true);
  assert.equal(advertisedPattern.test('s12'), true);
  assert.equal(advertisedPattern.test('s19'), false);
});

test('MCP success returns source fields and invalid arguments never reach network', async t => {
  let calls = 0;
  const client = await connect(t, async url => {
    assert.equal(url, 'https://initialb.vercel.app/guide.html');
    calls++;
    return new Response(html);
  });
  const result = await client.callTool({name: 'get_assignment', arguments: {week: 'S12'}});
  assert.notEqual(result.isError, true);
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.week, 's12');
  assert.equal(parsed.title, 'MCP 서버 만들기');
  assert.equal(parsed.source, 'https://initialb.vercel.app/guide.html');
  assert.equal(typeof parsed.sourceContentNotice, 'string');
  assert.ok(parsed.sourceContentNotice.trim().length > 0);
  for (const args of [{week: 's19'}, {week: 's12\n'}, {week: 's12', url: 'https://example.com'}, {week: '../s12'}, {}, {week: 12}]) {
    const invalid = await client.callTool({name: 'get_assignment', arguments: args});
    assert.equal(invalid.isError, true);
  }
  assert.equal(calls, 1);
});

test('MCP network failure reports isError and never provides success assignment fields', async t => {
  const client = await connect(t, async () => { throw new Error('offline'); });
  const result = await client.callTool({name: 'get_assignment', arguments: {week: 's12'}});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /조회.*실패/);
  assert.doesNotMatch(result.content[0].text, /"title"|"fetchedAt"/);
});
