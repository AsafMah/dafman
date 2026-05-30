// Regression test for #23 — "Library Agents tab does not show project agents".
//
// The file-layer `listAgentFiles` is covered by agentFiles.test.ts. The gap
// this test closes is the SERVICE boundary: `SessionAgentsService.listFiles`
// must resolve `entry.workingDirectory` from the session context and pass it
// through with `includeProject: true`, so a project agent dropped at
// `<cwd>/.github/agents/<name>.agent.md` surfaces in the Library Agents tab's
// Project section. Before the #51/#52 refresh work the tab silently showed
// user-scope only; this guards the resolved path end-to-end at the service.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionAgentsService } from '../app/chat/sessionAgentsService';
import {
  wrapSdkError,
  type SessionEntryView,
  type SessionServiceContext,
} from '../app/chat/sessionServiceContext';
import type { CopilotSession } from '../app/client/copilotSdk';

let workspaceDir: string;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), 'dafman-agentsvc-'));
});

afterEach(() => {
  if (workspaceDir) {
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

/// Builds a context whose single registered session reports the given
/// workingDirectory. `listFiles` never touches the SDK session, so a bare
/// object cast is sufficient for the `session` field.
function makeCtx(workingDirectory?: string): SessionServiceContext {
  const entry: SessionEntryView = {
    session: {} as unknown as CopilotSession,
    ...(workingDirectory ? { workingDirectory } : {}),
  };

  return {
    getEntry: () => entry,
    wrapSdk: wrapSdkError,
  };
}

async function dropProjectAgent(name: string): Promise<void> {
  const dir = join(workspaceDir, '.github', 'agents');

  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${name}.agent.md`),
    `---\nname: ${name}\ndescription: a project agent\n---\n\nbody\n`,
    'utf-8',
  );
}

describe('SessionAgentsService.listFiles (#23 project agents)', () => {
  test('surfaces a project agent from the session working directory', async () => {
    await dropProjectAgent('reviewer');

    const svc = new SessionAgentsService(makeCtx(workspaceDir));
    const files = await svc.listFiles('s1');

    const project = files.filter((f) => f.scope === 'project');

    expect(project.length).toBeGreaterThan(0);

    const reviewer = project.find((f) => f.name === 'reviewer');

    expect(reviewer).toBeDefined();
    expect(reviewer?.canonical).toBe(true);
    // Acceptance: the row path matches the actual file location.
    expect(reviewer?.path).toBe(join(workspaceDir, '.github', 'agents', 'reviewer.agent.md'));
  });

  test('returns no project agents when the session has no working directory', async () => {
    await dropProjectAgent('reviewer');

    const svc = new SessionAgentsService(makeCtx(undefined));
    const files = await svc.listFiles('s1');

    expect(files.filter((f) => f.scope === 'project')).toHaveLength(0);
  });
});
