import assert from 'node:assert/strict';
import test from 'node:test';

import { assertSpigenMember, isSpigenEmail } from './auth-domain.mjs';

test('@spigen.com 이메일만 허용한다', () => {
  assert.equal(isSpigenEmail('jokim@spigen.com'), true);
  assert.equal(isSpigenEmail('JOKIM@SPIGEN.COM'), true);
  assert.equal(isSpigenEmail('jokim@evilspigen.com'), false);
  assert.equal(isSpigenEmail('jokim@spigen.com.evil.test'), false);
  assert.equal(isSpigenEmail(''), false);
});

test('비 Spigen 사용자는 API에서 거부한다', () => {
  assert.doesNotThrow(() => assertSpigenMember({ email: 'jokim@spigen.com' }));
  assert.throws(() => assertSpigenMember({ email: 'outside@example.com' }), /Spigen 이메일/);
});
