import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { runLocalSlashCommand, SESSION_COMMANDS } from '@/lib/sessionCommands';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useToastStore } from '@/stores/app/toastStore';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import { on as busOn } from '@/lib/bus';

describe('sessionCommands', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    setRpcBridge(null);
  });

  test('/cd without args displays the tracked working directory', async () => {
    const sessions = useSessionsStore();
    sessions.sessions.push({
      id: 's1',
      accent: '#000',
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      mode: null,
      approveAll: true,
      title: null,
      reasoningVisibilityOverride: 'default',
      workingDirectory: 'C:\\repo\\dafman',
      defaultSendMode: 'steer',
      pendingRequests: [],
      unseenTurns: 0,
      isThinking: false,
      sawTurnBoundary: false,
      currentAgent: null,
      tasksRefreshCounter: 0,
      planRefreshCounter: 0,
      touchedFiles: [],
      commandsRun: 0,
      _toastedOauthRequests: new Set<string>(),
      _artifactToolCallIds: new Set<string>(),
    });

    const handled = await runLocalSlashCommand('s1', '/cd');

    expect(handled).toBe(true);
    expect(sessions.sessions[0]?.events).toEqual([
      {
        sessionId: 's1',
        eventType: 'system.notification',
        data: { content: 'Current working directory: C:\\repo\\dafman' },
      },
    ]);
  });

  test('/cd with args changes the tracked working directory', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    setRpcBridge({
      async request(name, args) {
        calls.push({ name, args });
        return 'C:\\other';
      },
      onSessionEvent() {
        return () => {};
      },
      onPendingRequest() {
        return () => {};
      },
      onLogEvent() {
        return () => {};
      },
      onAuditEvent() {
        return () => {};
      },
    } as RpcBridge);
    const sessions = useSessionsStore();
    sessions.sessions.push({
      id: 's1',
      accent: '#000',
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      mode: null,
      approveAll: true,
      title: null,
      reasoningVisibilityOverride: 'default',
      workingDirectory: 'C:\\repo\\dafman',
      defaultSendMode: 'steer',
      pendingRequests: [],
      unseenTurns: 0,
      isThinking: false,
      sawTurnBoundary: false,
      currentAgent: null,
      tasksRefreshCounter: 0,
      planRefreshCounter: 0,
      touchedFiles: [],
      commandsRun: 0,
      _toastedOauthRequests: new Set<string>(),
      _artifactToolCallIds: new Set<string>(),
    });

    const handled = await runLocalSlashCommand('s1', '/cd C:\\other');

    expect(handled).toBe(true);
    expect(calls).toEqual([
      {
        name: 'setSessionWorkingDirectory',
        args: {
          sessionId: 's1',
          workingDirectory: 'C:\\other',
          baseWorkingDirectory: 'C:\\repo\\dafman',
        },
      },
    ]);
    expect(sessions.sessions[0]?.workingDirectory).toBe('C:\\other');
    expect(sessions.sessions[0]?.events).toEqual([
      {
        sessionId: 's1',
        eventType: 'system.notification',
        data: { content: 'Working directory changed to C:\\other' },
      },
    ]);
  });

  test('/plan sends a CLI-style plan prompt and switches mode', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    setRpcBridge({
      async request(name, args) {
        calls.push({ name, args });
        return name === 'setSessionMode' ? 'plan' : true;
      },
      onSessionEvent() {
        return () => {};
      },
      onPendingRequest() {
        return () => {};
      },
      onLogEvent() {
        return () => {};
      },
      onAuditEvent() {
        return () => {};
      },
    } as RpcBridge);
    const sessions = useSessionsStore();
    sessions.sessions.push({
      id: 's1',
      accent: '#000',
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      mode: null,
      approveAll: false,
      title: null,
      reasoningVisibilityOverride: 'default',
      workingDirectory: 'C:\\repo\\dafman',
      defaultSendMode: 'steer',
      pendingRequests: [],
      unseenTurns: 0,
      isThinking: false,
      sawTurnBoundary: false,
      currentAgent: null,
      tasksRefreshCounter: 0,
      planRefreshCounter: 0,
      touchedFiles: [],
      commandsRun: 0,
      _toastedOauthRequests: new Set<string>(),
      _artifactToolCallIds: new Set<string>(),
    });

    const handled = await runLocalSlashCommand('s1', '/plan build mode parity');

    expect(handled).toBe(true);
    expect(calls).toEqual([
      {
        name: 'setSessionMode',
        args: { sessionId: 's1', mode: 'plan' },
      },
      {
        name: 'sendMessage',
        args: {
          sessionId: 's1',
          text: '[[PLAN]] build mode parity',
          mode: 'immediate',
        },
      },
    ]);
    expect(sessions.sessions[0]?.mode).toBe('plan');
  });

  test('model/autopilot slash commands are local and do not forward to LLM', async () => {
    const slashes = SESSION_COMMANDS.map((cmd) => cmd.slash);
    expect(slashes).toContain('/skill');
    expect(slashes).toContain('/skills');
    expect(slashes).toContain('/agent');
    expect(slashes).toContain('/model');

    const model = SESSION_COMMANDS.find((cmd) => cmd.slash === '/model');
    expect(model?.icon).toBe('pi-microchip-ai');
    const events: Array<{ sessionId: string }> = [];
    const off = busOn('open-model-selector', (payload) => {
      events.push(payload);
    });
    const handled = await runLocalSlashCommand('s1', '/model');
    off();

    expect(handled).toBe(true);
    expect(events).toEqual([{ sessionId: 's1' }]);
  });

  test('/mcp and /skills are local library commands', async () => {
    expect(await runLocalSlashCommand('s1', '/mcp')).toBe(true);
    expect(await runLocalSlashCommand('s1', '/skills')).toBe(true);
  });

  test('/skill <name> invokes a user-invocable skill and keeps bare /skill as Library open', async () => {
    const sessions = useSessionsStore();
    sessions.sessions.push({
      id: 's1',
      accent: '#000',
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      mode: null,
      approveAll: true,
      title: null,
      reasoningVisibilityOverride: 'default',
      workingDirectory: 'C:\\repo\\dafman',
      defaultSendMode: 'steer',
      pendingRequests: [],
      unseenTurns: 0,
      isThinking: false,
      sawTurnBoundary: false,
      currentAgent: null,
      tasksRefreshCounter: 0,
      planRefreshCounter: 0,
      touchedFiles: [],
      commandsRun: 0,
      _toastedOauthRequests: new Set<string>(),
      _artifactToolCallIds: new Set<string>(),
    } as never);

    const calls: Array<{ name: string; args: unknown }> = [];
    setRpcBridge({
      async request(name, args) {
        calls.push({ name, args });
        if (name === 'listSessionSkills') {
          return [
            { name: 'summarize', description: '', source: 'user', enabled: true, userInvocable: true },
            { name: 'deploy', description: '', source: 'user', enabled: true, userInvocable: true },
            { name: 'disabled', description: '', source: 'user', enabled: false, userInvocable: true },
            { name: 'hidden', description: '', source: 'user', enabled: true, userInvocable: false },
            { name: 'third', description: '', source: 'user', enabled: true, userInvocable: true },
            { name: 'fourth', description: '', source: 'user', enabled: true, userInvocable: true },
            { name: 'fifth', description: '', source: 'user', enabled: true, userInvocable: true },
            { name: 'sixth', description: '', source: 'user', enabled: true, userInvocable: true },
          ];
        }
        if (name === 'invokeSkill' && (args as { name?: string }).name === 'deploy') {
          return { kind: 'text', message: 'Deploy help' };
        }
        return { kind: 'sent' };
      },
      onSessionEvent: () => () => {},
      onPendingRequest: () => () => {},
      onLogEvent: () => () => {},
      onAuditEvent: () => () => {},
    } as RpcBridge);

    // Known name → invokeSkill IPC fires with remaining slash args as input.
    expect(await runLocalSlashCommand('s1', '/skill SUMMARIZE this turn')).toBe(true);
    const invokes = calls.filter((c) => c.name === 'invokeSkill');
    expect(invokes.length).toBe(1);
    expect(invokes[0].args).toEqual({ sessionId: 's1', name: 'summarize', input: 'this turn' });
    expect(sessions.sessions[0]?.events.at(-1)).toEqual({
      sessionId: 's1',
      eventType: 'system.notification',
      data: { content: 'Skill invoked: summarize' },
    });

    // Text command result → user-visible output instead of a misleading invoked note.
    calls.length = 0;
    expect(await runLocalSlashCommand('s1', '/skill deploy')).toBe(true);
    expect(calls.some((c) => c.name === 'invokeSkill')).toBe(true);
    expect(useToastStore().pending.at(-1)).toMatchObject({
      severity: 'info',
      summary: 'Skill output',
      detail: 'Deploy help',
    });
    expect(sessions.sessions[0]?.events.at(-1)).toEqual({
      sessionId: 's1',
      eventType: 'system.notification',
      data: { content: 'Deploy help' },
    });

    // Unknown name → no invokeSkill fires and warn toast lists first 5 invocable + enabled skills.
    calls.length = 0;
    expect(await runLocalSlashCommand('s1', '/skill unknown')).toBe(true);
    expect(calls.some((c) => c.name === 'invokeSkill')).toBe(false);
    expect(calls.some((c) => c.name === 'listSessionSkills')).toBe(true);
    expect(useToastStore().pending.at(-1)).toMatchObject({
      severity: 'warn',
      summary: 'No skill named "unknown"',
      detail: 'Available: summarize, deploy, third, fourth, fifth',
    });

    // Bare /skill keeps the existing Library → Skills behavior.
    const events: Array<{ tab: string }> = [];
    const off = busOn('library-activate-tab', (payload) => events.push(payload));
    expect(await runLocalSlashCommand('s1', '/skill')).toBe(true);
    off();
    expect(events.at(-1)).toEqual({ tab: 'skills' });
  });

  test('/agent <name> calls selectAgent and toasts unknown names', async () => {
    // Spec lock 2026-05-27: /agent <name> selects the named agent;
    // unknown names produce a warn toast with available list.
    const sessions = useSessionsStore();
    sessions.sessions.push({
      id: 's1',
      accent: '#000',
      events: [],
      droppedEventCount: 0,
      model: null,
      reasoningEffort: null,
      mode: null,
      approveAll: true,
      title: null,
      reasoningVisibilityOverride: 'default',
      workingDirectory: 'C:\\repo\\dafman',
      defaultSendMode: 'steer',
      pendingRequests: [],
      unseenTurns: 0,
      isThinking: false,
      sawTurnBoundary: false,
      currentAgent: null,
      tasksRefreshCounter: 0,
      planRefreshCounter: 0,
      touchedFiles: [],
      commandsRun: 0,
      _toastedOauthRequests: new Set<string>(),
      _artifactToolCallIds: new Set<string>(),
    } as never);

    const calls: Array<{ name: string; args: unknown }> = [];
    setRpcBridge({
      async request(name, args) {
        calls.push({ name, args });
        if (name === 'listAgents') {
          return [
            { name: 'reviewer', displayName: 'Code Reviewer', description: '', source: 'user' },
            { name: 'planner', displayName: null, description: '', source: 'user' },
          ];
        }
        return 'ok';
      },
      onSessionEvent: () => () => {},
      onPendingRequest: () => () => {},
      onLogEvent: () => () => {},
      onAuditEvent: () => () => {},
    } as RpcBridge);

    // Known name → selectAgent IPC fires.
    expect(await runLocalSlashCommand('s1', '/agent reviewer')).toBe(true);
    const selects = calls.filter((c) => c.name === 'selectAgent');
    expect(selects.length).toBe(1);
    expect((selects[0].args as { name: string }).name).toBe('reviewer');

    // Unknown name → no selectAgent fires (only listAgents).
    calls.length = 0;
    expect(await runLocalSlashCommand('s1', '/agent unknown')).toBe(true);
    expect(calls.some((c) => c.name === 'selectAgent')).toBe(false);
    expect(calls.some((c) => c.name === 'listAgents')).toBe(true);
  });
});
