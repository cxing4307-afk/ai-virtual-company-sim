import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const GATE_ITEMS = [
  { key: '①', label: '单元测试全过' },
  { key: '②', label: '全链路试玩' },
  { key: '③', label: 'CI 变绿' },
];

/**
 * 核验 PR 正文中的「上线三件套」。每项必须在已勾选的 checklist 行，
 * 并在该项之后、下一项之前提供带内容的「证据：」行。
 */
export function checkGateBody(bodyText) {
  const lines = String(bodyText ?? '').split(/\r?\n/);
  const itemPositions = GATE_ITEMS.map(({ key, label }) => ({
    key,
    label,
    index: lines.findIndex((line) => line.includes(key) && line.includes(label)),
  }));

  const results = itemPositions.map(({ key, label, index }, itemIndex) => {
    const itemLine = index === -1 ? '' : lines[index];
    const checked = /^\s*(?:-|\*)\s*\[x\]\s*/i.test(itemLine);
    const nextItemIndex = itemPositions
      .slice(itemIndex + 1)
      .map((item) => item.index)
      .find((nextIndex) => nextIndex !== -1);
    const evidenceLines = index === -1
      ? []
      : lines.slice(index + 1, nextItemIndex === undefined ? lines.length : nextItemIndex);
    const evidenceLine = evidenceLines.find((line) => /^\s*证据\s*[：:]/.test(line));
    const evidenceOk = Boolean(evidenceLine && evidenceLine.replace(/^\s*证据\s*[：:]\s*/, '').trim());

    let reason = '';
    if (index === -1) {
      reason = `缺第${key}项「${label}」：未找到该项，缺勾选和证据。`;
    } else if (!checked && !evidenceOk) {
      reason = `缺第${key}项「${label}」：缺勾选，且缺证据。`;
    } else if (!checked) {
      reason = `缺第${key}项「${label}」：缺勾选。`;
    } else if (!evidenceOk) {
      reason = `缺第${key}项「${label}」：缺证据。`;
    }

    return { key, label, checked, evidenceOk, reason };
  });

  const missing = results.filter((result) => !result.checked || !result.evidenceOk).map(({ key }) => key);
  return { ok: missing.length === 0, results, missing };
}

function usage() {
  return '用法：node release-gate-check.mjs (--pr <号码> | --body-file <路径>)';
}

function parseArgs(args) {
  let pr;
  let bodyFile;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--pr') pr = args[++index];
    else if (value === '--body-file') bodyFile = args[++index];
    else throw new Error(`未知参数：${value}`);
  }
  if (Boolean(pr) === Boolean(bodyFile)) throw new Error(`${usage()}（二选一）`);
  if (pr && !/^\d+$/.test(pr)) throw new Error('--pr 必须是 PR 编号。');
  if (!pr && !bodyFile) throw new Error(usage());
  return { pr, bodyFile };
}

async function getPrBody(pr) {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error('缺少 owner/repo 格式的 GITHUB_REPOSITORY。');
  }
  if (!token) throw new Error('缺少 GITHUB_TOKEN。');
  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${pr}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`获取 PR #${pr} 失败：HTTP ${response.status}。`);
  const payload = await response.json();
  return payload.body ?? '';
}

async function main() {
  const { pr, bodyFile } = parseArgs(process.argv.slice(2));
  const bodyText = bodyFile ? await readFile(bodyFile, 'utf8') : await getPrBody(pr);
  const result = checkGateBody(bodyText);

  if (result.ok) {
    for (const { key, label } of result.results) console.log(`第${key}项 ${label}：通过`);
    return;
  }

  console.error(`门禁拦截：缺第${result.missing.join(' / ')}项。`);
  for (const { reason } of result.results) if (reason) console.error(reason);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`门禁拦截：${error.message}`);
    process.exitCode = 1;
  });
}
