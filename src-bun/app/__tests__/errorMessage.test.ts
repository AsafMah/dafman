import { describe, expect, test } from 'bun:test';
import { toErrorMessage } from '../errorMessage';

describe('toErrorMessage', () => {
  test('extracts message from Error instance', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
  });
  test('stringifies non-Error values', () => {
    expect(toErrorMessage('oops')).toBe('oops');
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage(null)).toBe('null');
    expect(toErrorMessage(undefined)).toBe('undefined');
  });
  test('handles Error subclasses', () => {
    expect(toErrorMessage(new TypeError('bad type'))).toBe('bad type');
  });
});
