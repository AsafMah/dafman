import { beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import { useCommandRegistry } from '@/stores/shell/commandRegistry';

describe('commandRegistry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('register adds a command; visibleCommands includes it', () => {
    const r = useCommandRegistry();
    let ran = 0;
    r.register({
      id: 'test.one',
      label: 'Test one',
      run: () => {
        ran += 1;
      },
    });
    const list = r.visibleCommands;
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe('test.one');
    list[0]?.run();
    expect(ran).toBe(1);
  });

  test('register replaces by id (HMR / re-emit safe)', () => {
    const r = useCommandRegistry();
    r.register({ id: 'x', label: 'v1', run: () => {} });
    r.register({ id: 'x', label: 'v2', run: () => {} });
    expect(r.visibleCommands.length).toBe(1);
    expect(r.visibleCommands[0]?.label).toBe('v2');
  });

  test('unregister removes the command', () => {
    const r = useCommandRegistry();
    r.register({ id: 'x', label: 'x', run: () => {} });
    r.unregister('x');
    expect(r.visibleCommands.length).toBe(0);
  });

  test('when() filters commands lazily on each access', () => {
    const r = useCommandRegistry();
    const visible = ref(false);
    r.register({
      id: 'gated',
      label: 'Gated',
      when: () => visible.value,
      run: () => {},
    });
    expect(r.visibleCommands.length).toBe(0);
    visible.value = true;
    expect(r.visibleCommands.length).toBe(1);
    visible.value = false;
    expect(r.visibleCommands.length).toBe(0);
  });

  test("when() that throws is treated as 'hidden' (doesn't blank the palette)", () => {
    const r = useCommandRegistry();
    r.register({
      id: 'ok',
      label: 'OK',
      run: () => {},
    });
    r.register({
      id: 'broken',
      label: 'Broken',
      when: () => {
        throw new Error('nope');
      },
      run: () => {},
    });
    const list = r.visibleCommands;
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe('ok');
  });

  test('register returns a disposer that removes the command', () => {
    const r = useCommandRegistry();
    const dispose = r.register({ id: 'z', label: 'z', run: () => {} });
    expect(r.visibleCommands.length).toBe(1);
    dispose();
    expect(r.visibleCommands.length).toBe(0);
  });
});
