import { describe, expect, test } from 'bun:test';
import { useComposerAgentMode } from '@/composables/useComposerAgentMode';

describe('useComposerAgentMode', () => {
  test('starts with nextMessageMode = null', () => {
    const { nextMessageMode } = useComposerAgentMode();

    expect(nextMessageMode.value).toBeNull();
  });

  test('setNextMessageMode arms the override', () => {
    const { nextMessageMode, setNextMessageMode } = useComposerAgentMode();

    setNextMessageMode('plan');
    expect(nextMessageMode.value).toBe('plan');
  });

  test('resolveForSubmit returns armed mode and resets to null (one-shot)', () => {
    const { nextMessageMode, setNextMessageMode, resolveForSubmit } = useComposerAgentMode();

    setNextMessageMode('autopilot');
    const resolved = resolveForSubmit();

    expect(resolved).toBe('autopilot');
    expect(nextMessageMode.value).toBeNull();
  });

  test('resolveForSubmit returns undefined when no override is set', () => {
    const { resolveForSubmit } = useComposerAgentMode();

    expect(resolveForSubmit()).toBeUndefined();
  });

  test('setNextMessageMode(null) explicitly clears the override', () => {
    const { nextMessageMode, setNextMessageMode } = useComposerAgentMode();

    setNextMessageMode('interactive');
    expect(nextMessageMode.value).toBe('interactive');

    setNextMessageMode(null);
    expect(nextMessageMode.value).toBeNull();
  });

  test('resolveForSubmit called twice returns undefined on second call', () => {
    const { setNextMessageMode, resolveForSubmit } = useComposerAgentMode();

    setNextMessageMode('plan');
    resolveForSubmit();
    expect(resolveForSubmit()).toBeUndefined();
  });

  test('each composable call returns independent state', () => {
    const a = useComposerAgentMode();
    const b = useComposerAgentMode();

    a.setNextMessageMode('plan');
    expect(a.nextMessageMode.value).toBe('plan');
    expect(b.nextMessageMode.value).toBeNull();
  });
});
