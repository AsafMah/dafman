import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { usePreferredDark } from '@vueuse/core';
import { themeDark, themeLight, type DockviewTheme } from 'dockview-core';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { resolveIsDark } from '@/lib/theme';

/// Shared theme-mode signal for the app.
///
/// Resolves the user's `ThemeChoice` (`system` / `light` / `dark`) against the
/// OS preference into a single reactive `isDark`, and derives the dockview
/// theme object that BOTH the outer (`App.vue`) and inner (`GroupPanel.vue`)
/// dockviews must pass as their `theme` prop.
///
/// Why this matters (#18): dockview-core v6 themes via a `theme` *prop*, not a
/// CSS class on a wrapper. When no `theme` is supplied it falls back to
/// `themeAbyss` (a dark theme), so the entire dock chrome — group tab bars,
/// session tabs, edge-group panel backgrounds (Terminals / Session / Library /
/// Jobs) — stays dark even in light mode. Feeding it `themeLight` / `themeDark`
/// makes dockview apply the matching `dockview-theme-*` className to its own
/// root, which is what our `--dv-*` → `--p-*` bridge in `style.css` keys off.
export function useDockviewTheme(): {
  isDark: ComputedRef<boolean>;
  dockviewTheme: ComputedRef<DockviewTheme>;
} {
  const settingsStore = useSettingsStore();
  const { settings } = storeToRefs(settingsStore);
  const prefersDark = usePreferredDark();

  const isDark = computed(() => resolveIsDark(settings.value.appearance.theme, prefersDark.value));
  const dockviewTheme = computed<DockviewTheme>(() => (isDark.value ? themeDark : themeLight));

  return { isDark, dockviewTheme };
}
