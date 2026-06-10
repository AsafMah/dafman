/// Tests for the two-column toggle design on Library → Skills rows
/// (issue #28 — Library as source of truth, Phase 2: per-session column).
///
/// Validates:
///   1. Both "Default" and "This session" toggle labels render per skill row.
///   2. "This session" toggle is disabled when no session is focused (OQ6).
///   3. Default toggle remains enabled when no session is focused.
///   4. Toggling "This session" calls setSessionSkillEnabled for the focused
///      session only — NOT setGloballyDisabledSkills (global path).
///   5. sessionEnabled rule: session enabled=false → toggle OFF.
///   6. sessionEnabled rule: session enabled=true → toggle ON.
///   7. sessionEnabled rule: skill absent from session list → inherits global.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import LibrarySkillsTab from '@/components/library/LibrarySkillsTab.vue';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandName, CommandMap } from '@/ipc/types';
import { useSessionsStore, type SessionRecord } from '@/stores/chat/sessionsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';

// Extended bridge that also records every request for assertion.
interface TrackingBridge extends RpcBridge {
  setNext<N extends CommandName>(name: N, value: CommandMap[N]['result']): void;
  getCalls(name: string): Array<{ args: unknown }>;
}

function makeBridge(): TrackingBridge {
  const nextResponses = new Map<string, unknown>();
  const calls: Array<{ name: string; args: unknown }> = [];

  return {
    setNext(name, value) {
      nextResponses.set(name as string, value);
    },
    getCalls(name: string) {
      return calls.filter((c) => c.name === name).map((c) => ({ args: c.args }));
    },
    async request(name, args) {
      calls.push({ name: name as string, args });

      if (!nextResponses.has(name as string)) {
        throw new Error(`No response stubbed for ${name as string}`);
      }

      return nextResponses.get(name as string) as never;
    },
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };
}

let bridge: TrackingBridge;

beforeEach(() => {
  setActivePinia(createPinia());
  bridge = makeBridge();
  setRpcBridge(bridge);
});

afterEach(() => {
  setRpcBridge(null);
  cleanup();
});

/// Minimal stub set needed for a render without a focused session.
function stubNoSession() {
  bridge.setNext('discoverSkills', [
    {
      name: 'myskill',
      enabled: true,
      source: 'builtin',
      description: '',
      userInvocable: false,
    },
  ]);
  // No listSessionSkills stub needed — load() skips the call when
  // getLibrarySession() returns null.
}

/// Minimal stub set for a focused session with a specific skill enabled state.
function stubWithSession(sessionId: string, skillEnabled: boolean) {
  bridge.setNext('discoverSkills', [
    {
      name: 'myskill',
      enabled: true,
      source: 'builtin',
      description: '',
      userInvocable: false,
    },
  ]);
  bridge.setNext('listSessionSkills', [
    {
      name: 'myskill',
      enabled: skillEnabled,
      source: 'builtin',
      description: '',
      userInvocable: false,
    },
  ]);

  useSessionsStore().sessions.push({
    id: sessionId,
    workingDirectory: '/workspace',
  } as unknown as SessionRecord);
  useLayoutStore().lastFocusedSessionId = sessionId;
}

describe('LibrarySkillsTab — two-column toggles (#28)', () => {
  test('renders Default and This session labels on a skill row', async () => {
    stubNoSession();

    const utils = render(LibrarySkillsTab);

    await waitFor(() => expect(utils.getByText('myskill')).toBeDefined());

    expect(utils.getByText('Default')).toBeDefined();
    expect(utils.getByText('This session')).toBeDefined();
  });

  test('This session toggle is disabled when no session is focused', async () => {
    stubNoSession();

    const utils = render(LibrarySkillsTab);

    await waitFor(() => expect(utils.getByText('myskill')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable skill myskill for this session',
    });

    expect(sessionToggle.hasAttribute('disabled')).toBe(true);
  });

  test('Default toggle remains enabled when no session is focused', async () => {
    stubNoSession();

    const utils = render(LibrarySkillsTab);

    await waitFor(() => expect(utils.getByText('myskill')).toBeDefined());

    const defaultToggle = utils.getByRole('switch', {
      name: 'Enable skill myskill',
    });

    expect(defaultToggle.hasAttribute('disabled')).toBe(false);
  });

  test('Toggling This session calls setSessionSkillEnabled for focused session only', async () => {
    // Skill is session-enabled (true); clicking turns it disabled.
    stubWithSession('sess-42', true);

    const utils = render(LibrarySkillsTab);

    // Wait for the initial render with the stub session state (enabled: true).
    await waitFor(() => expect(utils.getByText('myskill')).toBeDefined());

    // Set stubs for the reload that setSessionEnabled triggers after its RPC.
    // Must be set AFTER the initial render so the first load() uses the
    // stubWithSession values (enabled: true), not these post-click ones.
    bridge.setNext('setSessionSkillEnabled', true);
    bridge.setNext('discoverSkills', [
      {
        name: 'myskill',
        enabled: true,
        source: 'builtin',
        description: '',
        userInvocable: false,
      },
    ]);
    bridge.setNext('listSessionSkills', [
      {
        name: 'myskill',
        enabled: false,
        source: 'builtin',
        description: '',
        userInvocable: false,
      },
    ]);

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable skill myskill for this session',
    });

    await fireEvent.click(sessionToggle);

    await waitFor(() => {
      const skillCalls = bridge.getCalls('setSessionSkillEnabled');
      expect(skillCalls.length).toBeGreaterThanOrEqual(1);
    });

    const skillCalls = bridge.getCalls('setSessionSkillEnabled');
    expect(skillCalls[0].args).toEqual({
      sessionId: 'sess-42',
      name: 'myskill',
      enabled: false,
    });

    // Global path must NOT have been called.
    expect(bridge.getCalls('setGloballyDisabledSkills')).toHaveLength(0);
  });

  test('sessionEnabled rule: session enabled=false → This session toggle OFF', async () => {
    stubWithSession('sess-1', false);

    const utils = render(LibrarySkillsTab);

    await waitFor(() => expect(utils.getByText('myskill')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable skill myskill for this session',
    });

    expect(sessionToggle.getAttribute('aria-checked')).toBe('false');
  });

  test('sessionEnabled rule: session enabled=true → This session toggle ON', async () => {
    stubWithSession('sess-1', true);

    const utils = render(LibrarySkillsTab);

    await waitFor(() => expect(utils.getByText('myskill')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable skill myskill for this session',
    });

    expect(sessionToggle.getAttribute('aria-checked')).toBe('true');
  });

  test('sessionEnabled rule: skill absent from session list → inherits global enabled', async () => {
    // Skill is globally disabled (enabled: false in discoverSkills).
    bridge.setNext('discoverSkills', [
      {
        name: 'myskill',
        enabled: false,
        source: 'builtin',
        description: '',
        userInvocable: false,
      },
    ]);
    // listSessionSkills returns a DIFFERENT skill — so myskill has no
    // session-level data and falls back to the global enabled state.
    bridge.setNext('listSessionSkills', [
      {
        name: 'other-skill',
        enabled: true,
        source: 'builtin',
        description: '',
        userInvocable: false,
      },
    ]);

    useSessionsStore().sessions.push({
      id: 'sess-1',
      workingDirectory: '/workspace',
    } as unknown as SessionRecord);
    useLayoutStore().lastFocusedSessionId = 'sess-1';

    const utils = render(LibrarySkillsTab);

    await waitFor(() => expect(utils.getByText('myskill')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable skill myskill for this session',
    });

    // isEnabled returns false because discoverSkills says enabled: false
    expect(sessionToggle.getAttribute('aria-checked')).toBe('false');
  });
});
