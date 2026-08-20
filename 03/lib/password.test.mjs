import test from 'node:test';
import assert from 'node:assert/strict';
import { isStrongPassword } from './password.js';

test('회원가입 비밀번호는 대문자·소문자·숫자·특수문자를 포함한 6자 이상이어야 한다', () => {
  assert.equal(isStrongPassword('Aa1!bc'), true);
  assert.equal(isStrongPassword('Aa1!bcdef'), true);
  assert.equal(isStrongPassword('aa1!bc'), false);
  assert.equal(isStrongPassword('AA1!BC'), false);
  assert.equal(isStrongPassword('Aa!bcd'), false);
  assert.equal(isStrongPassword('Aa1bcd'), false);
  assert.equal(isStrongPassword('Aa1!b'), false);
});
