// Composable: collapsible section toggle state persisted in localStorage.

import { ref } from 'vue';

export type SectionKey =
  | 'settings'
  | 'agents'
  | 'tasks'
  | 'files'
  | 'skills'
  | 'tools'
  | 'mcp'
  | 'plan'
  | 'usage'
  | 'quota';

const SECTION_DEFAULTS: Record<SectionKey, boolean> = {
  settings: false,
  agents: true,
  tasks: false,
  files: false,
  skills: true,
  tools: false,
  mcp: true,
  plan: true,
  usage: true,
  quota: true,
};

function readSectionState(key: SectionKey): boolean {
  if (typeof localStorage === 'undefined') return SECTION_DEFAULTS[key];

  try {
    const raw = localStorage.getItem(`dafman.details.section.${key}`);

    if (raw === null) return SECTION_DEFAULTS[key];

    return raw === '1';
  } catch {
    return SECTION_DEFAULTS[key];
  }
}

export function useDetailsSections() {
  const sectionOpen = ref<Record<SectionKey, boolean>>({
    settings: readSectionState('settings'),
    agents: readSectionState('agents'),
    tasks: readSectionState('tasks'),
    files: readSectionState('files'),
    skills: readSectionState('skills'),
    tools: readSectionState('tools'),
    mcp: readSectionState('mcp'),
    plan: readSectionState('plan'),
    usage: readSectionState('usage'),
    quota: readSectionState('quota'),
  });

  function toggleSection(key: SectionKey): void {
    const next = !sectionOpen.value[key];

    sectionOpen.value = { ...sectionOpen.value, [key]: next };

    try {
      localStorage.setItem(`dafman.details.section.${key}`, next ? '1' : '0');
    } catch {
      /* private mode / quota — ignore */
    }
  }

  // Per-item "show more" for long descriptions (tools, skills, agents).
  const expandedItems = ref<Set<string>>(new Set());

  function isItemExpanded(kind: 'tool' | 'skill' | 'agent', name: string): boolean {
    return expandedItems.value.has(`${kind}:${name}`);
  }

  function toggleItemExpansion(kind: 'tool' | 'skill' | 'agent', name: string): void {
    const key = `${kind}:${name}`;
    const next = new Set(expandedItems.value);

    if (next.has(key)) next.delete(key);
    else next.add(key);

    expandedItems.value = next;
  }

  return {
    sectionOpen,
    toggleSection,
    expandedItems,
    isItemExpanded,
    toggleItemExpansion,
  };
}
