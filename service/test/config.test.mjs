import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {validateConfig} from '../src/config.mjs';

test('live configuration fails closed on public credentials and ambiguous scopes',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../fixture/config.json',import.meta.url)));
  assert.equal(validateConfig(fixture,'synthetic'),fixture);
  const valid={mode:'live',synthetic:false,recipients:['alpha','beta'],principals:[{id:'alpha-pa',token:randomBytes(32).toString('base64url'),permissions:['send','claim'],scopes:{send:['beta'],claim:['alpha']}}]};
  assert.equal(validateConfig(valid,'live'),valid);
  const changes=[c=>c.mode='synthetic',c=>c.synthetic=true,c=>c.recipients.push('alpha'),c=>c.principals.push(structuredClone(c.principals[0])),c=>c.principals[0].token=fixture.principals[0].token,c=>delete c.principals[0].scopes,c=>{c.principals[0].scopes={};c.principals[0].recipients=['alpha','beta'];},c=>delete c.principals[0].id,c=>c.principals[0].scopes.claim=['missing'],c=>c.principals[0].permissions.push('root')];
  for(const change of changes){const c=structuredClone(valid);change(c);assert.throws(()=>validateConfig(c,'live'),/INVALID_SERVICE_CONFIG/);}
  assert.throws(()=>validateConfig(fixture,'live'),/INVALID_SERVICE_CONFIG/);
});
