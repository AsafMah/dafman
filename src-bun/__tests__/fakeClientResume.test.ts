import { afterEach, describe, expect, test } from 'bun:test';
import { _setClientForTest } from '../app/client/client';
import { SessionRegistry } from '../app/chat/sessions';
import { FakeCopilotClient } from '../app/client/fakeClient';
import type { SessionEventPayload } from '../rpc';

afterEach(() => {
  _setClientForTest(null);
});

/// Regression for #29: the E2E test-server's FakeCopilotClient must
/// expose the SAME session history method the production resume path
/// calls. The real SDK renamed `getMessages()` → `getEvents()`; when
/// the fake lagged behind, `sessions.ts` resume hydration threw
/// "session.getEvents is not a function", silently dropped the
/// scrollback, and 18/48 E2E flows timed out waiting for transcript
/// content that never rendered.
describe('FakeCopilotClient resume contract', () => {
  test('resume replays prior turn history via session.getEvents()', async () => {
    const client = new FakeCopilotClient();
    _setClientForTest(client as unknown as Parameters<typeof _setClientForTest>[0]);

    // Registry A: create a session and run one turn so the fake
    // accumulates user.message / assistant.message history.
    const emittedA: SessionEventPayload[] = [];
    const regA = new SessionRegistry((p) => emittedA.push(p));
    const id = await regA.create();
    await regA.send(id, 'hello');

    // Registry B: a fresh registry (no in-memory entry for `id`)
    // resumes the same session, mirroring an app restart. Resume
    // hydration must replay the prior turn through emit.
    const emittedB: SessionEventPayload[] = [];
    const regB = new SessionRegistry((p) => emittedB.push(p));
    await regB.resume(id);

    const replayedTypes = emittedB.map((e) => e.eventType);
    expect(replayedTypes).toContain('user.message');
    expect(replayedTypes).toContain('assistant.message');
  });
});
