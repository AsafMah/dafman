import { describe, expect, test } from 'bun:test';
import { buildBuiltInTools } from '../app/library/tools';

/// Built-in tools registered on every session config. Currently just
/// `request_form_input` for triggering MCP-style elicitation from any
/// chat. Heavy end-to-end coverage lives in `sessions.test.ts` (the
/// pending queue) and the renderer's JsonSchemaForm tests; here we
/// just lock in the schema + handler wiring.

interface FakeSession {
  ui: {
    elicitation: (params: {
      message: string;
      requestedSchema: unknown;
    }) => Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: unknown }>;
  };
}

function fakeRegistry(session: FakeSession | null) {
  return {
    sessionFor: (_id: string) => session as unknown,
  } as unknown as Parameters<typeof buildBuiltInTools>[0];
}

describe('buildBuiltInTools', () => {
  test('exposes a request_form_input tool with the expected shape', () => {
    const tools = buildBuiltInTools(fakeRegistry(null));
    expect(tools.length).toBe(1);
    expect(tools[0]!.name).toBe('request_form_input');
    const params = tools[0]!.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
    const props = params.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(['message', 'schema']);
    expect(params.required).toEqual(['message', 'schema']);
  });

  test('calls session.ui.elicitation and returns the content on accept', async () => {
    const calls: Array<{ message: string; requestedSchema: unknown }> = [];
    const session: FakeSession = {
      ui: {
        elicitation: async (params) => {
          calls.push(params);
          return { action: 'accept', content: { host: 'localhost', port: 5432 } };
        },
      },
    };
    const [tool] = buildBuiltInTools(fakeRegistry(session));
    const result = await tool!.handler(
      { message: 'Set up DB', schema: { type: 'object' } },
      { sessionId: 's1', toolCallId: 't1', toolName: 'request_form_input', arguments: {} },
    );
    expect(calls).toEqual([{ message: 'Set up DB', requestedSchema: { type: 'object' } }]);
    expect(result).toEqual({ ok: true, content: { host: 'localhost', port: 5432 } });
  });

  test('returns ok:false with the action on decline/cancel', async () => {
    const session: FakeSession = {
      ui: {
        elicitation: async () => ({ action: 'decline' }),
      },
    };
    const [tool] = buildBuiltInTools(fakeRegistry(session));
    const result = await tool!.handler(
      { message: '?', schema: {} },
      { sessionId: 's1', toolCallId: 't1', toolName: 'request_form_input', arguments: {} },
    );
    expect(result).toEqual({ ok: false, action: 'decline' });
  });

  test("returns an error result when the session isn't registered", async () => {
    const [tool] = buildBuiltInTools(fakeRegistry(null));
    const result = (await tool!.handler(
      { message: '?', schema: {} },
      { sessionId: 'gone', toolCallId: 't1', toolName: 'request_form_input', arguments: {} },
    )) as { error: string };
    expect(result.error).toContain('gone');
  });
});
