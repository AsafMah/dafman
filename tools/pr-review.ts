#!/usr/bin/env bun
/**
 * bun run pr:review
 *
 * Formats `git diff main...HEAD` plus the touched file list into a
 * structured prompt for the code-review subagent. Output is written
 * to a temp file AND copied to the clipboard so it can be pasted
 * straight into a Copilot CLI / chat session.
 *
 * Doesn't invoke an agent itself — pasting the prompt into a
 * `copilot` session (or any code-review-capable agent) is the
 * intended workflow. See AGENTS.md "Workflow — GitHub Issues + PRs".
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(`failed: ${cmd} ${args.join(' ')}\n${r.stderr ?? ''}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout ?? '';
}

const base = process.env.PR_REVIEW_BASE ?? 'main';
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

if (branch === base) {
  console.error(`pr:review refuses to run from ${base}. Switch to a feature branch first.`);
  process.exit(2);
}

const mergeBase = run('git', ['merge-base', base, 'HEAD']).trim();
const filesChanged = run('git', ['diff', '--name-status', `${mergeBase}..HEAD`]).trim();
const diffstat = run('git', ['diff', '--stat', `${mergeBase}..HEAD`]).trim();
const fullDiff = run('git', ['diff', `${mergeBase}..HEAD`]);
const commits = run('git', ['log', '--oneline', `${mergeBase}..HEAD`]).trim();

const prompt = `# Code review prompt — branch \`${branch}\` vs \`${base}\`

You are reviewing a PR. Apply the dafman \`code-review\` subagent
criteria: surface bugs / security / logic / correctness issues only.
**Do NOT comment on style, formatting, or trivial matters.**

Anti-laziness rules to check (from AGENTS.md):
- Rule 4a — UI/IPC/Lexical/dockview/prism changes need dogfood (bun run dev), not just bun run check
- Rule 5 — bug fixes must have a test that fails before, passes after
- Rule 16 — hand-rolled infrastructure should have a build-vs-buy justification
- Rule 18 — no \`window.dispatchEvent\` / \`addEventListener('app:...')\` event bus
- Rule 19 — files growing past 800 lines should be split
- Rule 20 — complexity > 15 should split, not bump the cap
- Rule 22 — no new \`src-bun/\` TypeScript errors

## Branch + commits

\`\`\`
${commits}
\`\`\`

## Files changed

\`\`\`
${filesChanged}
\`\`\`

## Diffstat

\`\`\`
${diffstat}
\`\`\`

## Full diff

\`\`\`diff
${fullDiff}
\`\`\`

---

Review focus order:
1. Correctness / logic bugs
2. Wire-contract drift (\`src-bun/rpc.ts\` ↔ \`src/ipc/types.ts\`)
3. Lifecycle bugs (subscriptions / timers / observers without cleanup)
4. Backward-compat breaks for persisted state
5. Test coverage of the changed code
6. Anti-laziness rule violations

Skip:
- Comment placement
- Naming bikeshed
- "you could also write this as ..." stylistic alternatives
`;

const outDir = join(tmpdir(), 'dafman-pr-review');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${branch.replace(/[\\/]/g, '-')}-${Date.now()}.md`);

writeFileSync(outFile, prompt, 'utf8');

console.log(`Prompt written: ${outFile}`);
console.log(`Branch: ${branch} → ${base}`);
console.log(`Diff size: ${prompt.length} chars (${(prompt.length / 1024).toFixed(1)} KB)`);
console.log(`Commits: ${commits.split('\n').length}`);

// Try to copy to clipboard (best-effort, cross-platform).
function copyToClipboard(): boolean {
  if (process.platform === 'win32') {
    // Use Set-Clipboard via stdin to avoid path-quoting issues.
    const ps = spawnSync('powershell', ['-NoProfile', '-Command', '$input | Set-Clipboard'], {
      input: prompt,
      encoding: 'utf8',
    });

    return ps.status === 0;
  }
  if (process.platform === 'darwin') {
    const pb = spawnSync('pbcopy', [], { input: prompt, encoding: 'utf8' });

    return pb.status === 0;
  }
  // Linux: try xclip then wl-copy.
  const x = spawnSync('xclip', ['-selection', 'clipboard'], { input: prompt, encoding: 'utf8' });

  if (x.status === 0) return true;
  const w = spawnSync('wl-copy', [], { input: prompt, encoding: 'utf8' });

  return w.status === 0;
}

if (copyToClipboard()) {
  console.log('Copied to clipboard.');
} else {
  console.log('Clipboard copy failed (not fatal). Open the file above and paste manually.');
}

console.log('\nNext: paste into a copilot / agent session and ask for code review.');
