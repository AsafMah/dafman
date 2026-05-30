<script setup lang="ts">
/// Phase 19b — Library → Skills tab.
///
/// Group skills by source (builtin / project / personal-copilot /
/// plugin / …), per-row toggle that writes the global disabled-list
/// via `setGloballyDisabledSkills`. Reveal-in-folder when `path` is
/// set so users can jump into the skill file.

import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import MessageContent from '@/components/chat/MessageContent.vue';
import { revealPath } from '@/lib/pathActions';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useSkillsLibrary, type Skill } from '@/composables/library/useSkillsLibrary';
import LibraryTabHeader from '@/components/library/LibraryTabHeader.vue';
import type { LibraryTabHeaderAction } from '@/components/library/libraryTabHeader';

const { skills, loaded, error, load, setEnabled } = useSkillsLibrary();
const { activeSessionId } = storeToRefs(useLayoutStore());
const expandedItems = ref<Set<string>>(new Set());
const headerActions: LibraryTabHeaderAction[] = [
  {
    key: 'refresh',
    label: 'Refresh',
    icon: 'pi pi-refresh',
    title: 'Refresh skills list',
    ariaLabel: 'Refresh skills list',
  },
];

const grouped = computed(() => {
  const out = new Map<string, Skill[]>();

  for (const s of skills.value) {
    const list = out.get(s.source) ?? [];

    list.push(s);
    out.set(s.source, list);
  }

  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
});

async function toggleSkill(skill: Skill) {
  await setEnabled(skill, !skill.enabled);
}

function isExpanded(name: string): boolean {
  return expandedItems.value.has(name);
}

function toggleExpansion(name: string) {
  const next = new Set(expandedItems.value);

  if (next.has(name)) next.delete(name);
  else next.add(name);

  expandedItems.value = next;
}

async function revealSkillFile(path: string | undefined) {
  if (!path) return;

  await revealPath(path, "Couldn't reveal skill");
}

onMounted(() => {
  void load();
});
/// Auto-reload when the user switches to a different session — skills
/// are session-scoped (per-cwd `.github/skills/` discovery + session
/// disabled-skill overlay). Watching `activeSessionId` is the canonical
/// trigger (the composable's `load()` reads it internally). Per #51.
watch(activeSessionId, () => {
  void load();
});

function onHeaderAction(action: string) {
  if (action === 'refresh') void load();
}
</script>

<template>
  <div class="skills-tab">
    <LibraryTabHeader
      :actions="headerActions"
      @action="onHeaderAction"
    />
    <div
      v-if="!loaded"
      class="empty-hint"
    >
      Loading…
    </div>
    <div
      v-else-if="error"
      class="empty-hint error"
    >
      {{ error }}
    </div>
    <div
      v-else-if="skills.length === 0"
      class="empty-hint"
    >
      No skills discovered.
    </div>
    <template v-else>
      <section
        v-for="[source, list] in grouped"
        :key="source"
        class="skill-group"
      >
        <h3 class="skill-group-title">{{ source }}</h3>
        <ul class="skill-list">
          <li
            v-for="skill in list"
            :key="skill.name"
            class="skill-row"
          >
            <button
              type="button"
              class="skill-name-button"
              :title="skill.description || skill.name"
              :aria-expanded="!!skill.description && isExpanded(skill.name)"
              @click="skill.description && toggleExpansion(skill.name)"
            >
              <i
                v-if="skill.description"
                class="pi skill-chevron"
                :class="isExpanded(skill.name) ? 'pi-chevron-down' : 'pi-chevron-right'"
                aria-hidden="true"
              />
              <span class="skill-name">{{ skill.name }}</span>
              <small
                v-if="skill.userInvocable"
                class="skill-tag"
                >/</small
              >
            </button>
            <div class="skill-actions">
              <Button
                v-if="skill.path"
                icon="pi pi-folder-open"
                size="small"
                severity="secondary"
                text
                :title="`Reveal ${skill.path}`"
                :aria-label="`Reveal ${skill.name}`"
                @click="revealSkillFile(skill.path)"
              />
              <ToggleSwitch
                :model-value="skill.enabled"
                :aria-label="`Enable skill ${skill.name}`"
                @update:model-value="() => toggleSkill(skill)"
              />
            </div>
            <div
              v-if="skill.description && isExpanded(skill.name)"
              class="skill-desc"
            >
              <MessageContent
                :text="skill.description"
                label="Skill description"
              />
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.skills-tab {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}

.skill-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.skill-group-title {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.skill-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.skill-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.4rem;
  border-radius: var(--p-border-radius-sm);
  min-width: 0;
}

.skill-row:hover {
  background: color-mix(in srgb, var(--p-content-hover-background) 40%, transparent);
}

.skill-name-button {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--p-text-color);
  font: inherit;
  text-align: left;
  min-width: 0;
  overflow: hidden;
}

.skill-chevron {
  font-size: 0.55rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.skill-name {
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.skill-tag {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.skill-actions {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.skill-actions :deep(.p-toggleswitch) {
  flex-shrink: 0;
}

.skill-desc {
  grid-column: 1 / -1;
  color: var(--p-text-muted-color);
  padding: 0.25rem 0.25rem 0.15rem 0.95rem;
  word-break: break-word;
}

.skill-desc :deep(.md-html-segment) {
  font-size: 0.72rem;
  line-height: 1.35;
}

.empty-hint {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  padding: 0.4rem 0;
}

.empty-hint.error {
  color: var(--p-message-error-color);
}
</style>
