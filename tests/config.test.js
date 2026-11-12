import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig,publicConfig} from '../src/config/runtime.js';
test('defaults preserve the existing model and reasoning settings',()=>{
  const cfg=loadConfig({});assert.equal(cfg.fichaModel,'gpt-5.4');assert.equal(cfg.fichaEffort,'high');assert.equal(cfg.analysisModel,'gpt-5.4-mini');assert.equal(cfg.analysisEffort,'medium');assert.equal(cfg.ocrMode,'auto');
});
test('environment overrides are validated and secrets are excluded from snapshots',()=>{
  const cfg=loadConfig({OCR_MODE:'always',OCR_DPI:'300',MYSQL_PASSWORD:'test-secret',OPENAI_API_KEY:'test-key',UPLOAD_MAX_FILE_MB:'25'});
  assert.equal(cfg.ocrDpi,300);assert.equal(cfg.uploadMb,25);assert.ok(!JSON.stringify(publicConfig(cfg)).includes('test-secret'));assert.ok(!JSON.stringify(publicConfig(cfg)).includes('test-key'));
  for(const env of [{OCR_MODE:'invalid'},{OCR_DPI:'0'},{OPENAI_MAX_ATTEMPTS:'0'},{MYSQL_PORT:'nan'}])assert.throws(()=>loadConfig(env));
});
