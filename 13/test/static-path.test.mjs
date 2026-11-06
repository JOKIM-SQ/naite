import test from 'node:test';
import assert from 'node:assert/strict';
import {staticPath} from '../lib/static-path.mjs';
test('static routing contains paths and rejects malformed URI without throwing',()=>{
 assert.equal(staticPath('/','/app/public'),'/app/public/index.html');
 assert.equal(staticPath('/%EA','/app/public'),null);
 assert.equal(staticPath('/%2e%2e/private.txt','/app/public'),null);
});
