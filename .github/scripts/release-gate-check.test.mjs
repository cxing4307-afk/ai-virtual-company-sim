import assert from 'node:assert/strict';
import test from 'node:test';

import { checkGateBody } from './release-gate-check.mjs';

const completeBody = `
- [x] ① 单元测试全过
证据：node --test 通过
- [x] ② 全链路试玩已验证
证据：staging 环境走查完成
- [x] ③ CI 变绿
证据：https://github.com/example/repo/actions/runs/1
`;

test('三项均已勾选且证据齐全时通过门禁', () => {
  const result = checkGateBody(completeBody);

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.results.map(({ key, checked, evidenceOk }) => ({ key, checked, evidenceOk })), [
    { key: '①', checked: true, evidenceOk: true },
    { key: '②', checked: true, evidenceOk: true },
    { key: '③', checked: true, evidenceOk: true },
  ]);
});

test('缺第①项勾选时拦截并指名①', () => {
  const result = checkGateBody(completeBody.replace('- [x] ①', '- [ ] ①'));

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['①']);
  assert.match(result.results[0].reason, /第①项.*勾选/);
});

test('第②项勾选但证据为空时拦截并指名②', () => {
  const result = checkGateBody(completeBody.replace('证据：staging 环境走查完成', '证据：'));

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['②']);
  assert.match(result.results[1].reason, /第②项.*证据/);
});

test('缺第③项时拦截并指名③', () => {
  const result = checkGateBody(completeBody.replace('- [x] ③ CI 变绿', ''));

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['③']);
  assert.match(result.results[2].reason, /第③项/);
});

test('空正文时三项全部缺失', () => {
  const result = checkGateBody('');

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['①', '②', '③']);
});

test('大写 X 的勾选也能通过', () => {
  const result = checkGateBody(completeBody.replaceAll('[x]', '[X]'));

  assert.equal(result.ok, true);
});
