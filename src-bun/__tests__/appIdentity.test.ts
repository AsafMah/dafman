import { describe, expect, test } from 'bun:test';

import { channelWindowTitle } from '../app/shared/appIdentity';

describe('channelWindowTitle', () => {
  test('suffixes non-stable channels', () => {
    expect(channelWindowTitle('dev')).toBe('Dafman — dev');
    expect(channelWindowTitle('canary')).toBe('Dafman — canary');
  });

  test('keeps the bare name on stable', () => {
    expect(channelWindowTitle('stable')).toBe('Dafman');
  });

  test('keeps the bare name when the channel is empty/unknown', () => {
    expect(channelWindowTitle('')).toBe('Dafman');
  });
});
