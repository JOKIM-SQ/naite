import assert from 'node:assert/strict';
import test from 'node:test';

import { isSixAmPacific, runDailyTracking } from './cron-daily-track.mjs';

test('자동 추적을 끄면 크론이 Amazon·Claude 호출 전에 건너뛴다', async () => {
  const result = await runDailyTracking({
    store: {
      settings: async () => ({ daily_tracking_enabled: false }),
      trackedProducts: async () => { throw new Error('호출되면 안 됩니다.'); },
    },
    apiKey: 'test-key', model: 'claude-test',
  });
  assert.deepEqual(result, { skipped: true, reason: 'disabled' });
});

test('두 UTC 크론 중 태평양 시간 오전 6시만 실제 작업을 통과시킨다', () => {
  assert.equal(isSixAmPacific(new Date('2026-09-07T13:00:00.000Z')), true);
  assert.equal(isSixAmPacific(new Date('2026-09-07T14:00:00.000Z')), false);
});
