// Composable: collapsible section state persisted to localStorage.
//
// Extracts the section open/closed pattern from SessionDetailsPanel
// so it can be reused in any panel with collapsible sections.

import { ref, type Ref } from "vue";

export function usePersistedSections<K extends string>(
  prefix: string,
  defaults: Record<K, boolean>,
): {
  sectionOpen: Ref<Record<K, boolean>>;
  toggleSection: (key: K) => void;
} {
  function read(key: K): boolean {
    if (typeof localStorage === "undefined") return defaults[key];
    try {
      const raw = localStorage.getItem(`${prefix}.${key}`);
      if (raw === null) return defaults[key];
      return raw === "1";
    } catch {
      return defaults[key];
    }
  }

  const initial: Record<string, boolean> = {};
  for (const key of Object.keys(defaults) as K[]) {
    initial[key] = read(key);
  }
  const sectionOpen = ref(initial) as Ref<Record<K, boolean>>;

  function toggleSection(key: K): void {
    const next = !sectionOpen.value[key];
    sectionOpen.value = { ...sectionOpen.value, [key]: next };
    try {
      localStorage.setItem(`${prefix}.${key}`, next ? "1" : "0");
    } catch {
      /* private mode / quota — ignore, in-memory state still works */
    }
  }

  return { sectionOpen, toggleSection };
}
