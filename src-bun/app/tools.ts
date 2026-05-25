/// Built-in custom tools registered with every session.
///
/// We add tools through the SDK's `tools` config so the agent can
/// call them like any built-in. The handlers reach back into the
/// SessionRegistry to access the underlying `CopilotSession` —
/// specifically for `session.ui.elicitation()`, which is the only
/// way to trigger an elicitation request in dafman until someone
/// connects an MCP server that elicits.

import type { Tool, ToolInvocation } from './copilotSdk';
import type { SessionRegistry } from './sessions';

/// Loose JSON-Schema-ish shape that mirrors what the MCP elicitation
/// spec accepts. We don't validate — the renderer + SDK handle that.
const REQUEST_FORM_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      description: "What you're asking the user. Plain prose, no markdown.",
    },
    schema: {
      type: 'object',
      description:
        'JSON Schema describing the form. Supports type=object root with ' +
        'properties of type string (+ enum / oneOf / format), number, ' +
        'integer, boolean, array. Use `required` to flag mandatory fields. ' +
        'Nested objects are recursive.',
    },
  },
  required: ['message', 'schema'],
} as const;

interface RequestFormInputArgs {
  message: string;
  schema: Record<string, unknown>;
}

/// Returns the tool descriptor for the SDK config. We pass the
/// registry by reference (rather than the session directly) because
/// the tool list is constructed BEFORE the SDK creates the session —
/// we don't have the `CopilotSession` reference yet at config time.
/// At tool-invocation time, the registry already has it.
export function buildBuiltInTools(registry: SessionRegistry): Tool[] {
  return [
    {
      name: 'request_form_input',
      description:
        'Collect structured input from the user via a form. Use this ' +
        'when you need multiple related pieces of information at once ' +
        '(e.g. configuration values, deployment options, a multi-field ' +
        'questionnaire). Single-question prompts should keep using ' +
        '`ask_user` instead. The form is rendered inline in the chat; ' +
        'the user can submit, decline, or cancel. Returns the ' +
        'collected values as an object on accept, or signals ' +
        'decline/cancel.',
      parameters: REQUEST_FORM_INPUT_SCHEMA,
      handler: async (args: unknown, invocation: ToolInvocation): Promise<unknown> => {
        const { message, schema } = args as RequestFormInputArgs;
        const session = registry.sessionFor(invocation.sessionId);

        if (!session) {
          return {
            error: `Session ${invocation.sessionId} not registered.`,
          };
        }

        const result = await session.ui.elicitation({
          message,
          requestedSchema: schema as Parameters<
            typeof session.ui.elicitation
          >[0]['requestedSchema'],
        });

        if (result.action === 'accept') {
          return { ok: true, content: result.content ?? {} };
        }

        return { ok: false, action: result.action };
      },
    },
  ];
}
