import { describe, test, expect } from 'bun:test';
import { applyProjectToSession, captureProjectFromSession } from '../app/config/projectOps';
import type { SessionOps } from '../app/config/projectOps';
import type { AgentInfo, Project, SessionMode } from '../rpc';

// ---------- Stub helpers ----------

type CallLog = Array<{ method: string; args: unknown[] }>;

function makeStubSessions(
  overrides: Partial<{
    selectAgentResult: AgentInfo;
    selectAgentError: Error;
    setMcpEnabledError: Error;
    setSkillEnabledError: Error;
    setModeError: Error;
    currentAgent: AgentInfo | null;
    mcpServers: Array<{ name: string; status: string }>;
    skills: Array<{
      name: string;
      description: string;
      source: string;
      enabled: boolean;
      userInvocable: boolean;
    }>;
    mode: SessionMode;
  }> = {},
  log: CallLog = [],
): SessionOps {
  return {
    async selectAgent(sessionId, name) {
      log.push({ method: 'selectAgent', args: [sessionId, name] });
      if (overrides.selectAgentError) throw overrides.selectAgentError;
      return overrides.selectAgentResult ?? { name, displayName: name, description: '' };
    },
    async deselectAgent(sessionId) {
      log.push({ method: 'deselectAgent', args: [sessionId] });
      return true;
    },
    async setSessionMcpEnabled(sessionId, serverName, enabled) {
      log.push({ method: 'setSessionMcpEnabled', args: [sessionId, serverName, enabled] });
      if (overrides.setMcpEnabledError) throw overrides.setMcpEnabledError;
      return true;
    },
    async setSkillEnabled(sessionId, name, enabled) {
      log.push({ method: 'setSkillEnabled', args: [sessionId, name, enabled] });
      if (overrides.setSkillEnabledError) throw overrides.setSkillEnabledError;
      return true;
    },
    async setMode(sessionId, mode) {
      log.push({ method: 'setMode', args: [sessionId, mode] });
      if (overrides.setModeError) throw overrides.setModeError;
      return mode;
    },
    async setApproveAll(sessionId, enabled) {
      log.push({ method: 'setApproveAll', args: [sessionId, enabled] });
      return enabled;
    },
    async setModel(sessionId, modelId, reasoningEffort) {
      log.push({ method: 'setModel', args: [sessionId, modelId, reasoningEffort] });
      return modelId;
    },
    async getCurrentAgent(_sessionId) {
      return overrides.currentAgent ?? null;
    },
    async listSessionMcpServers(_sessionId) {
      return overrides.mcpServers ?? [];
    },
    async listSkills(_sessionId) {
      return (overrides.skills ?? []).map((s) => ({ ...s, path: undefined }));
    },
    async getMode(_sessionId) {
      return overrides.mode ?? 'interactive';
    },
  };
}

function makeProject(defaults: Project['defaults']): Project {
  return {
    path: '/test/workspace',
    defaults,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// ---------- applyProjectToSession ----------

describe('applyProjectToSession', () => {
  test('applies agentName when set', async () => {
    const log: CallLog = [];
    const sessions = makeStubSessions({}, log);
    const result = await applyProjectToSession(
      sessions,
      makeProject({ agentName: 'backend' }),
      's1',
    );

    expect(result.applied).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(log.some((c) => c.method === 'selectAgent' && c.args[1] === 'backend')).toBe(true);
  });

  test('does NOT call selectAgent when agentName is undefined', async () => {
    const log: CallLog = [];
    const sessions = makeStubSessions({}, log);

    await applyProjectToSession(sessions, makeProject({}), 's1');
    expect(log.some((c) => c.method === 'selectAgent')).toBe(false);
  });

  test('enables each listed MCP server', async () => {
    const log: CallLog = [];
    const sessions = makeStubSessions({}, log);

    await applyProjectToSession(sessions, makeProject({ mcpEnabled: ['gh', 'jira'] }), 's1');
    const mcpCalls = log.filter((c) => c.method === 'setSessionMcpEnabled');

    expect(mcpCalls).toHaveLength(2);
    expect(mcpCalls[0]?.args).toEqual(['s1', 'gh', true]);
    expect(mcpCalls[1]?.args).toEqual(['s1', 'jira', true]);
  });

  test('disables each listed skill', async () => {
    const log: CallLog = [];
    const sessions = makeStubSessions({}, log);

    await applyProjectToSession(sessions, makeProject({ skillsDisabled: ['summarize'] }), 's1');
    const skillCalls = log.filter((c) => c.method === 'setSkillEnabled');

    expect(skillCalls).toHaveLength(1);
    expect(skillCalls[0]?.args).toEqual(['s1', 'summarize', false]);
  });

  test('sets mode when runMode present', async () => {
    const log: CallLog = [];
    const sessions = makeStubSessions({}, log);

    await applyProjectToSession(sessions, makeProject({ runMode: 'autopilot' }), 's1');
    expect(log.some((c) => c.method === 'setMode' && c.args[1] === 'autopilot')).toBe(true);
  });

  test('sets model when modelId present and non-empty', async () => {
    const log: CallLog = [];
    const sessions = makeStubSessions({}, log);

    await applyProjectToSession(
      sessions,
      makeProject({ modelId: 'gpt-4o', reasoningEffort: 'high' }),
      's1',
    );
    const modelCall = log.find((c) => c.method === 'setModel');

    expect(modelCall?.args).toEqual(['s1', 'gpt-4o', 'high']);
  });

  test('sets approveAll when present', async () => {
    const log: CallLog = [];
    const sessions = makeStubSessions({}, log);

    await applyProjectToSession(sessions, makeProject({ approveAll: true }), 's1');
    expect(log.some((c) => c.method === 'setApproveAll' && c.args[1] === true)).toBe(true);
  });

  test('missing MCP server → warning, not throw', async () => {
    const sessions = makeStubSessions({
      setMcpEnabledError: new Error('MCP server not found: unknown-server'),
    });
    const result = await applyProjectToSession(
      sessions,
      makeProject({ mcpEnabled: ['unknown-server'] }),
      's1',
    );

    expect(result.applied).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('unknown-server');
  });

  test('missing skill → warning, not throw', async () => {
    const sessions = makeStubSessions({
      setSkillEnabledError: new Error('Skill not found'),
    });
    const result = await applyProjectToSession(
      sessions,
      makeProject({ skillsDisabled: ['no-such-skill'] }),
      's1',
    );

    expect(result.applied).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  test('multiple independent failures → multiple warnings, applied still true', async () => {
    const sessions = makeStubSessions({
      selectAgentError: new Error('agent not found'),
      setMcpEnabledError: new Error('mcp missing'),
      setSkillEnabledError: new Error('skill missing'),
    });
    const result = await applyProjectToSession(
      sessions,
      makeProject({
        agentName: 'bad-agent',
        mcpEnabled: ['bad-mcp'],
        skillsDisabled: ['bad-skill'],
      }),
      's1',
    );

    expect(result.applied).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  test('sequencing: agent before MCP before skills before mode', async () => {
    const order: string[] = [];
    const sessions: SessionOps = {
      ...makeStubSessions(),
      async selectAgent() {
        order.push('agent');
        return { name: 'a', displayName: 'A', description: '' };
      },
      async setSessionMcpEnabled() {
        order.push('mcp');
        return true;
      },
      async setSkillEnabled() {
        order.push('skill');
        return true;
      },
      async setMode(_, m) {
        order.push('mode');
        return m;
      },
    };

    await applyProjectToSession(
      sessions,
      makeProject({ agentName: 'a', mcpEnabled: ['x'], skillsDisabled: ['y'], runMode: 'plan' }),
      's1',
    );
    expect(order).toEqual(['agent', 'mcp', 'skill', 'mode']);
  });
});

// ---------- captureProjectFromSession ----------

describe('captureProjectFromSession', () => {
  test('captures agent name and scope from current agent', async () => {
    const sessions = makeStubSessions({
      currentAgent: {
        name: 'backend',
        displayName: 'Backend',
        description: '',
        path: '/home/.copilot/agents/backend.agent.md',
      },
    });
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.defaults.agentName).toBe('backend');
    expect(project.defaults.agentScope).toBe('user');
  });

  test('captures project-scope agent when path contains .github/agents', async () => {
    const sessions = makeStubSessions({
      currentAgent: {
        name: 'ci',
        displayName: 'CI',
        description: '',
        path: '/repo/.github/agents/ci.agent.md',
      },
    });
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.defaults.agentScope).toBe('project');
  });

  test('omits agentName when no current agent', async () => {
    const sessions = makeStubSessions({ currentAgent: null });
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.defaults.agentName).toBeUndefined();
  });

  test('captures enabled MCP servers (non-disabled)', async () => {
    const sessions = makeStubSessions({
      mcpServers: [
        { name: 'gh', status: 'running' },
        { name: 'disabled-server', status: 'disabled' },
        { name: 'jira', status: 'connected' },
      ],
    });
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.defaults.mcpEnabled).toEqual(['gh', 'jira']);
  });

  test('captures disabled skills', async () => {
    const sessions = makeStubSessions({
      skills: [
        {
          name: 'summarize',
          description: '',
          source: 'builtin',
          enabled: true,
          userInvocable: true,
        },
        { name: 'greet', description: '', source: 'project', enabled: false, userInvocable: false },
      ],
    });
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.defaults.skillsDisabled).toEqual(['greet']);
  });

  test('omits runMode when mode is interactive (default)', async () => {
    const sessions = makeStubSessions({ mode: 'interactive' });
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.defaults.runMode).toBeUndefined();
  });

  test('captures runMode when non-interactive', async () => {
    const sessions = makeStubSessions({ mode: 'autopilot' });
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.defaults.runMode).toBe('autopilot');
  });

  test('sets project name when provided', async () => {
    const sessions = makeStubSessions({});
    const project = await captureProjectFromSession(sessions, 's1', '/test/path', 'My Project');

    expect(project.name).toBe('My Project');
  });

  test('omits name when not provided', async () => {
    const sessions = makeStubSessions({});
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.name).toBeUndefined();
  });

  test('stores canonical path', async () => {
    const sessions = makeStubSessions({});
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(project.path).toBe('/test/path');
  });

  test('sets createdAt and updatedAt as ISO strings', async () => {
    const sessions = makeStubSessions({});
    const project = await captureProjectFromSession(sessions, 's1', '/test/path');

    expect(new Date(project.createdAt).toISOString()).toBe(project.createdAt);
    expect(new Date(project.updatedAt).toISOString()).toBe(project.updatedAt);
  });
});
