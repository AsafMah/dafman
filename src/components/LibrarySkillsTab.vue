<script setup lang="ts">
/// Phase 19b — Library → Skills tab.
///
/// Group skills by source (builtin / project / personal-copilot /
/// plugin / …), per-row toggle that writes the global disabled-list
/// via `setGloballyDisabledSkills`. Reveal-in-folder when `path` is
/// set so users can jump into the skill file.

import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import { invokeCommand } from '../ipc/invoke';
import { useToastStore } from '../stores/toastStore';
import { useSessionsStore } from '../stores/sessionsStore';
import { useLayoutStore } from '../stores/layoutStore';
import MessageContent from './MessageContent.vue';
import { toErrorMessage } from '../lib/errorMessage';

type Skill = {
  name: string;
  description: string;
  source: string;
  userInvocable: boolean;
  enabled: boolean;
  path?: string;
};

const toasts = useToastStore();
const sessionsStore = useSessionsStore();
const skills = ref<Skill[]>([]);
const loaded = ref(false);
const error = ref<string | null>(null);
const expandedItems = ref<Set<string>>(new Set());

const grouped = computed(() => {
  const out = new Map<string, Skill[]>();
  for (const s of skills.value) {
    const list = out.get(s.source) ?? [];
    list.push(s);
    out.set(s.source, list);
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
});

async function load() {
  error.value = null;
  loaded.value = false;
  try {
    // Use session-scoped skills when a session is open — the session's
    // working directory drives .github/skills/ discovery correctly.
    // Fall back to the global discover RPC when no session exists.
    const activeId = useLayoutStore().activeSessionId;
    const active = activeId ? sessionsStore.getSession(activeId) : undefined;
    const sessionId = active?.id ?? sessionsStore.sessions[0]?.id;

    if (sessionId) {
      skills.value = await invokeCommand('listSessionSkills', { sessionId });
    } else {
      const wd = sessionsStore.sessions.find((s) => s.workingDirectory)?.workingDirectory || '';
      skills.value = await invokeCommand('discoverSkills', wd ? { workingDirectory: wd } : {});
    }
    loaded.value = true;
  } catch (err) {
    error.value = toErrorMessage(err);
    loaded.value = true;
  }
}

async function toggleSkill(skill: Skill) {
  const next = !skill.enabled;
  // Optimistic: flip the local view, then push the change.
  skill.enabled = next;
  try {
    // Use session-scoped skill toggle when a session is open, otherwise
    // push the full global disabled set.
    const activeId = useLayoutStore().activeSessionId;
    const sessionId =
      (activeId ? sessionsStore.getSession(activeId)?.id : undefined) ??
      sessionsStore.sessions[0]?.id;

    if (sessionId) {
      await invokeCommand('setSessionSkillEnabled', {
        sessionId,
        name: skill.name,
        enabled: next,
      });
    } else {
      const disabled = skills.value.filter((s) => !s.enabled).map((s) => s.name);
      await invokeCommand('setGloballyDisabledSkills', { disabledSkills: disabled });
    }
  } catch (err) {
    skill.enabled = !next;
    toasts.error('Toggle failed', toErrorMessage(err));
  }
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
  try {
    await invokeCommand('revealPath', { path });
  } catch (err) {
    toasts.error("Couldn't reveal skill", toErrorMessage(err));
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="skills-tab">
    <div class="tab-actions">
      <Button
        icon="pi pi-refresh"
        size="small"
        severity="secondary"
        text
        label="Refresh"
        @click="load"
      />
    </div>
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

.tab-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
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
