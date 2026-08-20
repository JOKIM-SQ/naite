import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpigenEmail } from './signup.js';

test('회원가입은 @spigen.com 이메일만 허용한다', () => {
  assert.equal(isSpigenEmail('member@spigen.com'), true);
  assert.equal(isSpigenEmail('MEMBER@SPIGEN.COM'), true);
  assert.equal(isSpigenEmail('member@spigen.com.evil.example'), false);
  assert.equal(isSpigenEmail('member@gmail.com'), false);
  assert.equal(isSpigenEmail('@spigen.com'), false);
});
