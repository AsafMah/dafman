import { describe, expect, test } from 'bun:test';
import { render, cleanup } from '@testing-library/vue';
import UserMessageBody from '../UserMessageBody.vue';
import type { SendMessageAttachment } from '../../ipc/types';

describe('UserMessageBody', () => {
  test('renders plain markdown via MessageContent when no attachments', () => {
    const { container } = render(UserMessageBody, {
      props: { text: 'hello world', label: 'Your message' },
    });
    expect(container.textContent).toContain('hello world');
    expect(container.querySelector('.composer-attachment-pill')).toBeNull();
    cleanup();
  });

  test('interleaves text segments with pills in attachment order', () => {
    const att: SendMessageAttachment[] = [
      { type: 'file', path: '/abs/a.ts', displayName: 'a.ts' },
      { type: 'file', path: '/abs/b.ts', displayName: 'b.ts' },
    ];
    const { container } = render(UserMessageBody, {
      props: {
        text: 'compare a.ts and b.ts please',
        label: 'Your message',
        attachments: att,
      },
    });
    const pills = container.querySelectorAll('.composer-attachment-pill');
    expect(pills.length).toBe(2);
    const labels = Array.from(pills).map(
      (p) => p.querySelector('.composer-attachment-pill-label')?.textContent,
    );
    expect(labels).toEqual(['a.ts', 'b.ts']);
    expect(container.textContent).toContain('compare ');
    expect(container.textContent).toContain(' and ');
    expect(container.textContent).toContain(' please');
    cleanup();
  });

  test('emits pill even when label is missing from text (edit case)', () => {
    const att: SendMessageAttachment[] = [
      { type: 'file', path: '/abs/lost.ts', displayName: 'lost.ts' },
    ];
    const { container } = render(UserMessageBody, {
      props: {
        text: 'hello',
        label: 'Your message',
        attachments: att,
      },
    });
    const pills = container.querySelectorAll('.composer-attachment-pill');
    expect(pills.length).toBe(1);
    cleanup();
  });

  test('renders image-kind pill with image data attribute', () => {
    const att: SendMessageAttachment[] = [
      {
        type: 'blob',
        data: 'Zm9v',
        mimeType: 'image/png',
        displayName: 'shot.png',
      },
    ];
    const { container } = render(UserMessageBody, {
      props: {
        text: 'look at shot.png',
        label: 'Your message',
        attachments: att,
      },
    });
    const pill = container.querySelector('.composer-attachment-pill');
    expect(pill?.getAttribute('data-attachment-kind')).toBe('image');
    cleanup();
  });
});
