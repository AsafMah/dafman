import { beforeEach, describe, expect, test } from 'bun:test';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useDockviewTheme } from '@/composables/useDockviewTheme';

describe('useDockviewTheme', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Regression for #18: with no `theme` prop, dockview-core falls back to its
  // dark `themeAbyss`, pinning the whole dock chrome dark even in light mode.
  // The composable must hand the dockviews an EXPLICIT light/dark theme that
  // tracks the resolved appearance.
  test('explicit light theme → themeLight (className dockview-theme-light)', () => {
    const settings = useSettingsStore();
    settings.settings.appearance.theme = 'light';

    const { isDark, dockviewTheme } = useDockviewTheme();

    expect(isDark.value).toBe(false);
    expect(dockviewTheme.value.name).toBe('light');
    expect(dockviewTheme.value.className).toBe('dockview-theme-light');
  });

  test('explicit dark theme → themeDark (className dockview-theme-dark)', () => {
    const settings = useSettingsStore();
    settings.settings.appearance.theme = 'dark';

    const { isDark, dockviewTheme } = useDockviewTheme();

    expect(isDark.value).toBe(true);
    expect(dockviewTheme.value.name).toBe('dark');
    expect(dockviewTheme.value.className).toBe('dockview-theme-dark');
  });

  test('reacts when the user flips the theme setting', async () => {
    const settings = useSettingsStore();
    settings.settings.appearance.theme = 'light';

    const { dockviewTheme } = useDockviewTheme();
    expect(dockviewTheme.value.name).toBe('light');

    settings.settings.appearance.theme = 'dark';
    await nextTick();
    expect(dockviewTheme.value.name).toBe('dark');
  });
});
