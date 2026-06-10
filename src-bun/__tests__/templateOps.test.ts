// Tests for applyTemplate + captureTemplate.
//
// NOTE: The real SessionRegistry's MCP/skill/agent methods ultimately call
// the live SDK (FakeCopilotClient in E2E). For unit tests we use a minimal
// stub object satisfying the SessionOps interface directly so there is no
// dependency on the SDK fake. See "FAKE CLIENT SUPPORT" in the yield report.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyTemplate, captureTemplate, type SessionOps } from '../app/config/templateOps';
import { TemplateService } from '../app/config/templateService';
import type { AgentInfo, SessionMode, SessionTemplate } from '../rpc';

const TEST_DIR = join(tmpdir(), `dafman-template-ops-test-${Date.now()}`);
const TEST_PATH = join(TEST_DIR, 'session-templates.json');

function makeTemplate(overrides: Partial<SessionTemplate> = {}): SessionTemplate {
  return {
    id: crypto.randomUUID(),
    name: 'Test Template',
    mcpEnabled: [],
    skillsDisabled: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/// Build a minimal stub SessionOps that records calls and can be configured
/// to throw on specific ops. The stub does NOT use FakeCopilotClient —
/// the e2e harness covers that layer separately. This file tests the
/// applyTemplate/captureTemplate logic (error handling, warning collection,
/// template construction) in isolation.
function makeStubOps(overrides: Partial<SessionOps> = {}): SessionOps & {
  calls: string[];
} {
  const calls: string[] = [];

  return {
    calls,
    async selectAgent(_sessionId, name) {
      calls.push(`selectAgent:${name}`);

      return { name, displayName: name, description: '' };
    },
    async deselectAgent(_sessionId) {
      calls.push('deselectAgent');

      return true;
    },
    async setSessionMcpEnabled(_sessionId, serverName, enabled) {
      calls.push(`setMcp:${serverName}:${enabled}`);

      return true;
    },
    async setSkillEnabled(_sessionId, name, enabled) {
      calls.push(`setSkill:${name}:${enabled}`);

      return true;
    },
    async setMode(_sessionId, mode) {
      calls.push(`setMode:${mode}`);

      return mode;
    },
    async getCurrentAgent(_sessionId) {
      return null;
    },
    async listSkills(_sessionId) {
      return [
        {
          name: 'summarize',
          description: '',
          source: 'builtin',
          enabled: true,
          userInvocable: true,
        },
        {
          name: 'disabled-skill',
          description: '',
          source: 'builtin',
          enabled: false,
          userInvocable: true,
        },
      ];
    },
    async listSessionMcpServers(_sessionId) {
      return [
        { name: 'github', status: 'running' },
        { name: 'stopped-server', status: 'stopped' },
      ];
    },
    async getMode(_sessionId): Promise<SessionMode> {
      return 'autopilot';
    },
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// applyTemplate
// ---------------------------------------------------------------------------

describe('applyTemplate', () => {
  test('throws when template id does not exist', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const ops = makeStubOps();

    await expect(applyTemplate('sess-1', 'nonexistent-id', svc, ops)).rejects.toThrow(
      'template not found',
    );
  });

  test('calls selectAgent when template has agentName', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({ id: 'tpl1', name: 'With Agent', agentName: 'my-agent' });

    await svc.save(t);

    const ops = makeStubOps();
    const result = await applyTemplate('sess-1', 'tpl1', svc, ops);

    expect(result.applied).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(ops.calls).toContain('selectAgent:my-agent');
  });

  test('calls deselectAgent when template has no agentName', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({ id: 'tpl2', name: 'No Agent' });

    await svc.save(t);

    const ops = makeStubOps();

    await applyTemplate('sess-1', 'tpl2', svc, ops);
    expect(ops.calls).toContain('deselectAgent');
  });

  test('calls setSessionMcpEnabled for each mcpEnabled entry', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({ id: 'tpl3', mcpEnabled: ['github', 'jira'] });

    await svc.save(t);

    const ops = makeStubOps();

    await applyTemplate('sess-1', 'tpl3', svc, ops);
    expect(ops.calls).toContain('setMcp:github:true');
    expect(ops.calls).toContain('setMcp:jira:true');
  });

  test('calls setSkillEnabled(false) for each skillsDisabled entry', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({ id: 'tpl4', skillsDisabled: ['summarize', 'fleet'] });

    await svc.save(t);

    const ops = makeStubOps();

    await applyTemplate('sess-1', 'tpl4', svc, ops);
    expect(ops.calls).toContain('setSkill:summarize:false');
    expect(ops.calls).toContain('setSkill:fleet:false');
  });

  test('calls setMode when runMode is set', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({ id: 'tpl5', runMode: 'autopilot' });

    await svc.save(t);

    const ops = makeStubOps();

    await applyTemplate('sess-1', 'tpl5', svc, ops);
    expect(ops.calls).toContain('setMode:autopilot');
  });

  test('warning — missing agent (selectAgent throws) → warning, no rethrow, continues', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({
      id: 'tpl6',
      agentName: 'ghost-agent',
      skillsDisabled: ['summarize'],
    });

    await svc.save(t);

    const ops = makeStubOps({
      async selectAgent() {
        throw new Error('agent not found');
      },
    });
    const result = await applyTemplate('sess-1', 'tpl6', svc, ops);

    expect(result.applied).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('ghost-agent');
    // Other ops continue despite the agent error
    expect(ops.calls).toContain('setSkill:summarize:false');
  });

  test('warning — missing MCP server (setSessionMcpEnabled throws) → warning, continues', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({ id: 'tpl7', mcpEnabled: ['missing-mcp', 'real-mcp'] });

    await svc.save(t);

    const ops = makeStubOps({
      async setSessionMcpEnabled(_sid, name) {
        if (name === 'missing-mcp') throw new Error('server not found');

        return true;
      },
    });
    const result = await applyTemplate('sess-1', 'tpl7', svc, ops);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing-mcp');
    // Second MCP server still applied (result has only 1 warning, not 2)
    expect(result.applied).toBe(true);
  });

  test('warning — missing skill (setSkillEnabled throws) → warning, continues', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({
      id: 'tpl8',
      skillsDisabled: ['deleted-skill', 'good-skill'],
      runMode: 'plan',
    });

    await svc.save(t);

    const ops = makeStubOps({
      async setSkillEnabled(_sid, name) {
        if (name === 'deleted-skill') throw new Error('skill not found');

        return true;
      },
    });
    const result = await applyTemplate('sess-1', 'tpl8', svc, ops);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('deleted-skill');
    // Mode still applied
    expect(ops.calls).toContain('setMode:plan');
  });

  test('multiple failures accumulate in warnings array', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const t = makeTemplate({
      id: 'tpl9',
      agentName: 'ghost',
      mcpEnabled: ['bad1', 'bad2'],
      skillsDisabled: ['dead-skill'],
    });

    await svc.save(t);

    const ops = makeStubOps({
      async selectAgent() {
        throw new Error('not found');
      },
      async setSessionMcpEnabled() {
        throw new Error('not found');
      },
      async setSkillEnabled() {
        throw new Error('not found');
      },
    });
    const result = await applyTemplate('sess-1', 'tpl9', svc, ops);

    // 1 agent + 2 mcp + 1 skill = 4 warnings
    expect(result.warnings).toHaveLength(4);
    expect(result.applied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// captureTemplate
// ---------------------------------------------------------------------------

describe('captureTemplate', () => {
  test('builds template with disabled skills + enabled MCPs + runMode', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const ops = makeStubOps();
    const t = await captureTemplate('sess-1', 'My Capture', svc, ops);

    expect(t.name).toBe('My Capture');
    expect(t.skillsDisabled).toEqual(['disabled-skill']);
    expect(t.mcpEnabled).toEqual(['github']); // 'stopped-server' excluded
    expect(t.runMode).toBe('autopilot'); // non-interactive is stored
    expect(t.id.length).toBeGreaterThan(0);
    expect(typeof t.createdAt).toBe('string');
    expect(typeof t.updatedAt).toBe('string');
  });

  test('omits runMode when session is interactive', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const ops = makeStubOps({
      async getMode() {
        return 'interactive';
      },
    });
    const t = await captureTemplate('sess-1', 'Interactive Capture', svc, ops);

    expect(t.runMode).toBeUndefined();
  });

  test('captures agent name + scope when agent is selected', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const agent: AgentInfo = {
      name: 'my-agent',
      displayName: 'My Agent',
      description: 'desc',
      path: '/Users/me/.config/agents/my-agent.agent.md',
    };
    const ops = makeStubOps({
      async getCurrentAgent() {
        return agent;
      },
    });
    const t = await captureTemplate('sess-1', 'With Agent', svc, ops);

    expect(t.agentName).toBe('my-agent');
    expect(t.agentScope).toBe('user'); // path not under .github/agents/
  });

  test('detects project scope from .github/agents/ path', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const agent: AgentInfo = {
      name: 'proj-agent',
      displayName: 'Proj Agent',
      description: 'desc',
      path: '/repo/.github/agents/proj-agent.agent.md',
    };
    const ops = makeStubOps({
      async getCurrentAgent() {
        return agent;
      },
    });
    const t = await captureTemplate('sess-1', 'Project Agent', svc, ops);

    expect(t.agentScope).toBe('project');
  });

  test('no agentName when no agent selected', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const ops = makeStubOps({
      async getCurrentAgent() {
        return null;
      },
    });
    const t = await captureTemplate('sess-1', 'No Agent', svc, ops);

    expect(t.agentName).toBeUndefined();
    expect(t.agentScope).toBeUndefined();
  });

  test('saves template to service (persists)', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const ops = makeStubOps();

    await captureTemplate('sess-1', 'Persist Test', svc, ops);
    expect(svc.list()).toHaveLength(1);
    expect(svc.list()[0].name).toBe('Persist Test');
  });

  test('excludes error and stopped MCP servers from mcpEnabled', async () => {
    const svc = TemplateService.loadOrDefault(TEST_PATH);
    const ops = makeStubOps({
      async listSessionMcpServers() {
        return [
          { name: 'running-mcp', status: 'running' },
          { name: 'error-mcp', status: 'error' },
          { name: 'stopped-mcp', status: 'stopped' },
          { name: 'disabled-mcp', status: 'disabled' },
          { name: 'connecting-mcp', status: 'connecting' },
        ];
      },
    });
    const t = await captureTemplate('sess-1', 'MCP Filter', svc, ops);

    expect(t.mcpEnabled).toEqual(['running-mcp', 'connecting-mcp']);
  });
});
