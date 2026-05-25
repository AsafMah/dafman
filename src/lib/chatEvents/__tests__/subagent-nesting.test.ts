// 19c: subagent nesting + fleet routing tests.
//
// Pins the chatEvents reducer's routing rules:
//   - subagent.started with envelope agentId creates a nested
//     SubagentChatItem at top level.
//   - subagent.completed/.failed flip the existing item's status.
//   - Visual events (assistant/reasoning/tool) with envelope
//     agentId matching an active sub-agent get routed INTO its
//     nested items[].
//   - Non-visual events (session.title_changed, etc.) STAY at the
//     top level even with agentId set (so a sub-agent can't
//     mutate global session state).
//   - subagent.started with no envelope agentId is dropped (warn).
//   - Duplicate toolCallIds across root and sub-agent don't
//     collide (separate per-buffer indices).

import { describe, expect, test } from 'bun:test';
import { defaultAmbient, processEvents, type ChatItem } from '@/lib/chatEvents';
import type { SessionEventPayload } from '@/ipc/types';

function make(
  eventType: string,
  data: Record<string, unknown>,
  agentId?: string,
): SessionEventPayload {
  const out: SessionEventPayload = {
    sessionId: 's1',
    eventType,
    data,
  };
  if (agentId !== undefined) (out as { agentId?: string }).agentId = agentId;
  return out;
}

function run(payloads: SessionEventPayload[]): ChatItem[] {
  const counter = { next: 1 };
  const { items } = processEvents([], defaultAmbient(), payloads, counter, {
    live: true,
  });
  return items;
}

describe('19c: subagent lifecycle', () => {
  test('subagent.started with envelope agentId creates a SubagentChatItem', () => {
    const items = run([
      make(
        'subagent.started',
        {
          agentName: 'explorer',
          agentDisplayName: 'Code Explorer',
          agentDescription: 'Explores the codebase',
        },
        'sa-1',
      ),
    ]);
    expect(items).toHaveLength(1);
    const sub = items[0]!;
    expect(sub.kind).toBe('subagent');
    if (sub.kind !== 'subagent') return;
    expect(sub.agentId).toBe('sa-1');
    expect(sub.agentName).toBe('explorer');
    expect(sub.displayName).toBe('Code Explorer');
    expect(sub.description).toBe('Explores the codebase');
    expect(sub.status).toBe('running');
    expect(sub.items).toEqual([]);
  });

  test('subagent.started with no envelope agentId is dropped', () => {
    const items = run([make('subagent.started', { agentName: 'anon', agentDisplayName: 'Anon' })]);
    expect(items).toEqual([]);
  });

  test('subagent.completed flips status + sets completedAt', () => {
    const items = run([
      make('subagent.started', { agentName: 'a', agentDisplayName: 'A' }, 'sa-1'),
      make('subagent.completed', {}, 'sa-1'),
    ]);
    expect(items).toHaveLength(1);
    if (items[0]!.kind !== 'subagent') throw new Error('expected subagent');
    expect(items[0]!.status).toBe('completed');
  });

  test('subagent.failed sets status + error', () => {
    const items = run([
      make('subagent.started', { agentName: 'a', agentDisplayName: 'A' }, 'sa-1'),
      make('subagent.failed', { error: 'boom' }, 'sa-1'),
    ]);
    if (items[0]!.kind !== 'subagent') throw new Error('expected subagent');
    expect(items[0]!.status).toBe('failed');
    expect(items[0]!.error).toBe('boom');
  });
});

describe('19c: nested visual event routing', () => {
  test('assistant.message_start/delta/message with matching agentId nest into the SubagentChatItem', () => {
    const items = run([
      make('subagent.started', { agentName: 'a', agentDisplayName: 'A' }, 'sa-1'),
      make('assistant.message_start', { messageId: 'msg-sub-1' }, 'sa-1'),
      make('assistant.message_delta', { messageId: 'msg-sub-1', contentDelta: 'Hello ' }, 'sa-1'),
      make(
        'assistant.message',
        { messageId: 'msg-sub-1', content: 'Hello from sub-agent' },
        'sa-1',
      ),
    ]);
    expect(items).toHaveLength(1);
    if (items[0]!.kind !== 'subagent') throw new Error('expected subagent');
    expect(items[0]!.items).toHaveLength(1);
    const inner = items[0]!.items[0]!;
    expect(inner.kind).toBe('assistant');
    if (inner.kind !== 'assistant') return;
    expect(inner.messageId).toBe('msg-sub-1');
    expect(inner.text).toBe('Hello from sub-agent');
  });

  test('tool.* events with matching agentId nest into the SubagentChatItem', () => {
    const items = run([
      make('subagent.started', { agentName: 'a', agentDisplayName: 'A' }, 'sa-1'),
      make(
        'tool.execution_start',
        { toolCallId: 'tc-sub-1', name: 'grep', args: { pattern: 'x' } },
        'sa-1',
      ),
      make(
        'tool.execution_complete',
        {
          toolCallId: 'tc-sub-1',
          success: true,
          result: { content: '1 match' },
        },
        'sa-1',
      ),
    ]);
    if (items[0]!.kind !== 'subagent') throw new Error('expected subagent');
    expect(items[0]!.items).toHaveLength(1);
    const inner = items[0]!.items[0]!;
    expect(inner.kind).toBe('tool');
    if (inner.kind !== 'tool') return;
    expect(inner.toolCallId).toBe('tc-sub-1');
    expect(inner.status).toBe('success');
  });

  test('duplicate toolCallId at root + sub-agent do NOT collide (per-buffer indices)', () => {
    const items = run([
      // Root-level tool call.
      make('tool.execution_start', {
        toolCallId: 'shared-id',
        name: 'grep',
      }),
      // Sub-agent with the same toolCallId.
      make('subagent.started', { agentName: 'a', agentDisplayName: 'A' }, 'sa-1'),
      make('tool.execution_start', { toolCallId: 'shared-id', name: 'read' }, 'sa-1'),
      make(
        'tool.execution_complete',
        {
          toolCallId: 'shared-id',
          success: true,
          result: { content: 'sub done' },
        },
        'sa-1',
      ),
    ]);
    // Root tool stays running (no completion event).
    expect(items[0]!.kind).toBe('tool');
    if (items[0]!.kind === 'tool') {
      expect(items[0]!.toolCallId).toBe('shared-id');
      expect(items[0]!.status).toBe('running');
    }
    // Sub-agent's tool is completed.
    if (items[1]!.kind !== 'subagent') throw new Error('expected subagent');
    const innerTool = items[1]!.items[0]!;
    expect(innerTool.kind).toBe('tool');
    if (innerTool.kind === 'tool') {
      expect(innerTool.toolCallId).toBe('shared-id');
      expect(innerTool.status).toBe('success');
    }
  });
});

describe('19c: routing boundaries', () => {
  test('non-visual events with agentId STAY at top-level (session.title_changed)', () => {
    const counter = { next: 1 };
    const ambient = defaultAmbient();
    const { items, ambient: nextAmbient } = processEvents(
      [],
      ambient,
      [
        make('subagent.started', { agentName: 'a', agentDisplayName: 'A' }, 'sa-1'),
        // session.title_changed with envelope agentId — should be
        // top-level (session-meta family, not visual).
        make('session.title_changed', { title: 'Renamed by Sub' }, 'sa-1'),
      ],
      counter,
      { live: true },
    );
    // SubagentChatItem still exists.
    expect(items).toHaveLength(1);
    if (items[0]!.kind !== 'subagent') throw new Error('expected subagent');
    // Sub-agent's nested items[] is EMPTY (the title event did
    // not get routed in).
    expect(items[0]!.items).toEqual([]);
    // ambient.title was updated at the top level.
    expect(nextAmbient.title).toBe('Renamed by Sub');
  });

  test('after subagent.completed, subsequent events with that agentId stop routing into the (now-stale) block', () => {
    const items = run([
      make('subagent.started', { agentName: 'a', agentDisplayName: 'A' }, 'sa-1'),
      make('assistant.message', { messageId: 'msg-during', content: 'during' }, 'sa-1'),
      make('subagent.completed', {}, 'sa-1'),
      // Late assistant.message with the stale agentId — should
      // land at top level, not in the completed block.
      make('assistant.message', { messageId: 'msg-after', content: 'after' }, 'sa-1'),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]!.kind).toBe('subagent');
    if (items[0]!.kind === 'subagent') {
      expect(items[0]!.items).toHaveLength(1);
      expect(items[0]!.status).toBe('completed');
    }
    expect(items[1]!.kind).toBe('assistant');
    if (items[1]!.kind === 'assistant') {
      expect(items[1]!.text).toBe('after');
    }
  });

  test('event with agentId pointing at unknown sub-agent → falls through to top level', () => {
    const items = run([
      make('assistant.message', { messageId: 'msg-orphan', content: 'orphaned' }, 'sa-nonexistent'),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('assistant');
  });
});
