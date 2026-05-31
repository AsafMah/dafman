import { describe, expect, test } from 'bun:test';
import { defaultAmbient, processEvents, type IdCounter } from '@/lib/chatEvents';
import type { SessionEventPayload } from '@/ipc/types';

function payload(eventType: string, data: Record<string, unknown>): SessionEventPayload {
  return { sessionId: 'sess-1', eventType, data };
}

function run(payloads: SessionEventPayload[]) {
  const counter: IdCounter = { next: 1 };
  return processEvents([], defaultAmbient(), payloads, counter);
}

describe('calloutHandlers — system.notification wrapper stripping', () => {
  test('strips <system_notification> wrapper, keeps inner text', () => {
    const inner = 'Background agent abc123 (explore) completed.';
    const result = run([
      payload('system.notification', {
        content: `<system_notification>\n${inner}\n</system_notification>`,
        kind: 'agent_completed',
      }),
    ]);

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item?.kind).toBe('system');
    if (item?.kind === 'system') {
      expect(item.text).toBe(inner);
      expect(item.text).not.toContain('<system_notification>');
      expect(item.text).not.toContain('</system_notification>');
    }
  });

  test('handles a dangling/streaming open tag without leaking it', () => {
    const result = run([
      payload('system.notification', {
        content: '<system_notification>\nSub-agent reported back.',
        kind: 'agent_completed',
      }),
    ]);

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    if (item?.kind === 'system') {
      expect(item.text).toBe('Sub-agent reported back.');
      expect(item.text).not.toContain('<system_notification>');
    }
  });

  test('passes through plain content unchanged', () => {
    const result = run([
      payload('system.notification', { content: 'Plain notice.', kind: 'agent_idle' }),
    ]);

    const item = result.items[0];
    if (item?.kind === 'system') {
      expect(item.text).toBe('Plain notice.');
    }
  });

  test('drops a notification that is only the empty wrapper', () => {
    const result = run([
      payload('system.notification', {
        content: '<system_notification></system_notification>',
        kind: 'agent_idle',
      }),
    ]);

    expect(result.items).toHaveLength(0);
  });
});
