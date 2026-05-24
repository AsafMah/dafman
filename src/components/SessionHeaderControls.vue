<script setup lang="ts">
// Per-session controls (model + effort selects, options gear → popover
// with run mode, reasoning view override, session name, compact /
// reset). Designed to be hosted anywhere — inside the dockview
// `rightHeaderActionsComponent` (the production target), or in a
// standalone container.
//
// All state lives on the `SessionRecord` (sessionsStore); this
// component just reads + dispatches actions. Self-contained: takes
// only `sessionId` as a prop.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import Chip from "primevue/chip";
import Select from "primevue/select";
import TreeSelect from "primevue/treeselect";
import type { TreeNode } from "primevue/treenode";
import type {
  ModelSummary,
  ReasoningVisibility,
} from "../ipc/types";
import { useModelsStore } from "../stores/modelsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useLayoutStore, basename } from "../stores/layoutStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useToastStore } from "../stores/toastStore";
import { invokeCommand } from "../ipc/invoke";
import {
  buildModelTree,
} from "../lib/modelTree";
import { toErrorMessage } from "../lib/errorMessage";

const props = withDefaults(
  defineProps<{ sessionId: string; area?: "all" | "composer-left" | "composer-right" }>(),
  { area: "all" },
);

const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const terminalStore = useTerminalStore();
const modelsStore = useModelsStore();
const { models } = storeToRefs(modelsStore);
const settings = storeToRefs(useSettingsStore()).settings;
const modelTreeRef = ref<InstanceType<typeof TreeSelect> | null>(null);

onMounted(() => {
  modelsStore.load().catch(() => {
    /* toast already shown by the store */
  });
  window.addEventListener("dafman:open-model-selector", onOpenModelSelector);
});

onBeforeUnmount(() => {
  window.removeEventListener("dafman:open-model-selector", onOpenModelSelector);
});

const record = computed(() =>
  sessionsStore.getSession(props.sessionId),
);

function onOpenModelSelector(event: Event): void {
  const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
  if (detail?.sessionId !== props.sessionId) return;
  if (props.area !== "all" && props.area !== "composer-right") return;
  modelTreeRef.value?.show();
}

const effectiveModelId = computed(() =>
  record.value?.model ?? settings.value.appearance.defaultModelId ?? null,
);

const selectedModel = computed<ModelSummary | undefined>(() => {
  const id = effectiveModelId.value;
  return id ? models.value.find((m) => m.id === id) : undefined;
});

/// Hierarchical model picker — see `lib/modelTree.ts` for the
/// taxonomy (Auto pinned on top, provider → optional type → version).
const modelTree = computed<TreeNode[]>(() =>
  buildModelTree(models.value) as unknown as TreeNode[],
);

/// All group (non-leaf) keys in the tree. Used to expand the whole
/// tree by default so the user sees every option without manually
/// disclosing each provider/type. Recomputed when the catalogue
/// changes so newly-added groups also start expanded.
const allGroupKeys = computed<Record<string, boolean>>(() => {
  const out: Record<string, boolean> = {};
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        if (n.key) out[String(n.key)] = true;
        walk(n.children);
      }
    }
  };
  walk(modelTree.value);
  return out;
});

/// Two-way bound expanded-keys for the TreeSelect popup. Initialized
/// from `allGroupKeys` so everything starts open; users can collapse
/// individual groups (chevron OR clicking the row, see the #option
/// template) and we respect that for the rest of the session.
const expandedKeys = ref<Record<string, boolean>>({});

watch(
  allGroupKeys,
  (next, prev) => {
    // First population: take everything.
    if (!prev || Object.keys(expandedKeys.value).length === 0) {
      expandedKeys.value = { ...next };
      return;
    }
    // Subsequent updates: add NEW groups (those not in prev) as
    // expanded, but leave existing user collapses alone.
    for (const key of Object.keys(next)) {
      if (!(key in prev)) expandedKeys.value[key] = true;
    }
  },
  { immediate: true },
);

/// Click handler bound to non-leaf rows in the TreeSelect option
/// template — toggles that group's expansion. We bypass the chevron
/// because the user wanted "clicking a provider or a type anywhere
/// should expand it" (not just the small caret).
function toggleGroupExpansion(key: string) {
  if (expandedKeys.value[key]) {
    const next = { ...expandedKeys.value };
    delete next[key];
    expandedKeys.value = next;
  } else {
    expandedKeys.value = { ...expandedKeys.value, [key]: true };
  }
}

/// TreeSelect v-models as `{ [key]: { checked: true, partialChecked: false } }`
/// for selectionMode="single". We translate to/from the single id
/// string the store actually persists.
const modelTreeChoice = computed<Record<string, unknown> | null>({
  get: () => {
    const id = effectiveModelId.value;
    if (!id) return null;
    return { [id]: true };
  },
  set: (value) => {
    if (!value || !record.value) return;
    const id = Object.keys(value)[0];
    if (!id) return;
    const fresh = models.value.find((m) => m.id === id);
    if (!fresh) return;
    const effort = fresh.supportsReasoningEffort
      ? record.value.reasoningEffort ?? fresh.defaultReasoningEffort ?? null
      : null;
    void sessionsStore.setSessionModel(props.sessionId, id, effort);
  },
});

const effortOptions = computed(() =>
  (selectedModel.value?.supportedReasoningEfforts ?? []).map((effort) => ({
    label: effort,
    value: effort,
  })),
);

const effortChoice = computed<string | null>({
  get: () =>
    record.value?.reasoningEffort ??
    settings.value.appearance.defaultReasoningEffort ??
    selectedModel.value?.defaultReasoningEffort ??
    null,
  set: (value) => {
    if (!value || !record.value?.model) return;
    void sessionsStore.setSessionModel(props.sessionId, record.value.model, value);
  },
});

const reasoningOptions: { label: string; value: ReasoningVisibility }[] = [
  { label: "Hidden", value: "hidden" },
  { label: "Compact", value: "compact" },
  { label: "Expanded", value: "expanded" },
];

/// When the session record still carries the legacy `"default"`
/// marker (older sessions / first-time setup), resolve it down to
/// the concrete app-wide value so the picker shows a real option
/// rather than a meaningless "Default". Writes always store a
/// concrete value — there's no path back to "default".
const reasoningChoice = computed<ReasoningVisibility>({
  get: () => {
    const v = record.value?.reasoningVisibilityOverride;
    if (!v || v === "default") return settings.value.appearance.reasoningVisibility;
    return v;
  },
  set: (value) => {
    sessionsStore.setSessionReasoningOverride(props.sessionId, value);
  },
});

const approveAll = computed(() => record.value?.approveAll ?? false);
function toggleApproveAll() {
  if (!record.value) return;
  void sessionsStore.setSessionApproveAll(props.sessionId, !approveAll.value);
}

/// Cog button toggles the per-session details rail (right-edge
/// dockview panel). Replaces the gear popover that previously hung
/// off this header.
const detailsOpen = computed(() => layoutStore.isSessionDetailsOpen());
function toggleDetails() {
  layoutStore.toggleSessionDetailsPanel();
}

/// Workspace label shown in the tab strip — basename only, so it
/// stays short. Full absolute path is in the tooltip.
const workspaceLabel = computed(() => basename(record.value?.workingDirectory));

function onWorkspaceClick() {
  const path = record.value?.workingDirectory;
  if (!path) return;
  invokeCommand("revealPath", { path }).catch((err: unknown) => {
    useToastStore().error(
      "Couldn't open workspace",
      toErrorMessage(err),
    );
  });
}

/// 19a: header chip surfaces the session's currently-selected custom
/// agent. Hidden when no agent is selected (default agent in use) to
/// keep the header clutter-free for users not using this feature.
/// Clicking opens the right rail where the user can pick/deselect.
const agentChipLabel = computed(() => record.value?.currentAgent?.displayName ?? null);
function onAgentChipClick() {
  if (!detailsOpen.value) layoutStore.toggleSessionDetailsPanel();
}

function requestTerminalFocus(terminalId: string): void {
  for (const delay of [0, 50, 150]) {
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("dafman:focus-terminal", {
        detail: { terminalId },
      }));
    }, delay);
  }
}

async function openSessionTerminal() {
  try {
    window.dispatchEvent(new CustomEvent("dafman:close-command-terminal", {
      detail: { sessionId: props.sessionId },
    }));
    const terminal = await terminalStore.getOrCreateSessionTerminal(props.sessionId);
    layoutStore.addTerminalPanel(terminal.id, terminal.title);
    await nextTick();
    requestTerminalFocus(terminal.id);
  } catch (err) {
    useToastStore().error(
      "Couldn't open terminal",
      toErrorMessage(err),
    );
  }
}
</script>

<template>
  <div v-if="record" class="session-header-controls" :class="`area-${props.area}`">
    <Button
      v-if="props.area === 'composer-left'"
      icon="pi pi-shield"
      label="Allow all"
      text
      size="small"
      class="approve-all-button"
      :aria-label="approveAll ? 'Disable auto-approve all tools' : 'Enable auto-approve all tools'"
      :aria-pressed="approveAll"
      :title="approveAll ? 'Auto-approve all tools is ON' : 'Auto-approve all tools is OFF'"
      :class="{ 'approve-all-active': approveAll }"
      @click="toggleApproveAll"
    />
    <Chip
      v-if="workspaceLabel && (props.area === 'all' || props.area === 'composer-left')"
      :label="workspaceLabel"
      icon="pi pi-folder"
      class="workspace-chip"
      :title="`Open ${record.workingDirectory ?? ''}`"
      :aria-label="`Open workspace folder ${record.workingDirectory ?? ''}`"
      role="button"
      tabindex="0"
      @click="onWorkspaceClick"
      @keydown.enter.prevent="onWorkspaceClick"
      @keydown.space.prevent="onWorkspaceClick"
    />
    <Button
      v-if="props.area === 'all' || props.area === 'composer-right'"
      icon="pi pi-desktop"
      label="Terminal"
      text
      size="small"
      class="session-terminal-button"
      aria-label="Open session terminal"
      title="Open session terminal"
      @click="openSessionTerminal"
    />
    <Chip
      v-if="agentChipLabel && props.area === 'all'"
      :label="agentChipLabel"
      icon="pi pi-user"
      class="agent-chip"
      :title="`Custom agent: ${agentChipLabel}. Click to manage in the rail.`"
      :aria-label="`Custom agent ${agentChipLabel}. Open session details to manage.`"
      role="button"
      tabindex="0"
      @click="onAgentChipClick"
      @keydown.enter.prevent="onAgentChipClick"
      @keydown.space.prevent="onAgentChipClick"
    />
    <TreeSelect
      v-if="props.area === 'all' || props.area === 'composer-right'"
      ref="modelTreeRef"
      :input-id="`model-${props.sessionId}`"
      v-model="modelTreeChoice"
      v-model:expanded-keys="expandedKeys"
      :options="modelTree"
      selection-mode="single"
      size="small"
      filter
      append-to="body"
      placeholder="Model"
      :disabled="models.length === 0"
      aria-label="Model for this session"
      class="compact-select compact-tree-select"
    >
      <template #option="{ node }">
        <!-- Custom node label. For non-leaf rows (providers / types)
             we want clicking the row to toggle expansion in addition
             to the chevron — the row is bigger and easier to hit. -->
        <span
          v-if="node.children && node.children.length > 0"
          class="tree-group-label"
          @click="toggleGroupExpansion(String(node.key))"
        >
          {{ node.label }}
        </span>
        <span v-else>{{ node.label }}</span>
      </template>
    </TreeSelect>
    <Select
      v-if="selectedModel?.supportsReasoningEffort && (props.area === 'all' || props.area === 'composer-right')"
      :input-id="`effort-${props.sessionId}`"
      v-model="effortChoice"
      :options="effortOptions"
      option-label="label"
      option-value="value"
      size="small"
      filter
      append-to="body"
      placeholder="Effort"
      aria-label="Reasoning effort for this session"
      class="compact-select compact-select-effort"
    />
    <Select
      v-if="props.area === 'all'"
      :input-id="`reasoning-inline-${props.sessionId}`"
      v-model="reasoningChoice"
      :options="reasoningOptions"
      option-label="label"
      option-value="value"
      size="small"
      filter
      append-to="body"
      placeholder="Reasoning"
      aria-label="Reasoning visibility for this session"
      class="compact-select compact-select-reasoning"
    />
    <Button
      v-if="props.area === 'all'"
      icon="pi pi-shield"
      label="Allow all"
      text
      size="small"
      class="approve-all-button"
      :aria-label="approveAll ? 'Disable auto-approve all tools' : 'Enable auto-approve all tools'"
      :aria-pressed="approveAll"
      :title="approveAll ? 'Auto-approve all tools is ON' : 'Auto-approve all tools is OFF'"
      :class="{ 'approve-all-active': approveAll }"
      @click="toggleApproveAll"
    />
    <Button
      v-if="props.area === 'all' || props.area === 'composer-right'"
      icon="pi pi-cog"
      text
      rounded
      size="small"
      :aria-label="detailsOpen ? 'Close session details' : 'Open session details'"
      :aria-pressed="detailsOpen"
      :title="detailsOpen ? 'Close session details (right rail)' : 'Open session details (right rail)'"
      :class="{ 'cog-active': detailsOpen }"
      @click="toggleDetails"
    />
  </div>
</template>

<style scoped>
.session-header-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0 0.4rem;
  height: 100%;
  /* Layout shrinks gracefully on narrow widths: model/effort selects
   * collapse first (flex-shrink); workspace chip drops out below a
   * certain width via a container query; the options gear is the
   * last thing standing because it's the only entry point to mode,
   * rename, compact, etc.
   *
   * NOTE: do NOT set `container-type: inline-size` on this element —
   * it's a shrink-to-fit flex child, so its width is determined by
   * its visible content. Putting the container context here creates a
   * feedback loop: hide a child → container narrows → next breakpoint
   * fires → hide more, until only the gear survives. The container
   * context lives on the host instead (`.chat-tile-header` in
   * ChatWindow.vue), which has a stable width derived from the
   * dockview tile. Queries below resolve against that ancestor. */
  min-width: 0;
  flex: 1 1 auto;
  justify-content: flex-end;
  flex-wrap: nowrap;
}

.session-header-controls.area-composer-left,
.session-header-controls.area-composer-right {
  flex: 0 1 auto;
  padding: 0;
}

.session-header-controls.area-composer-left .workspace-chip {
  margin-right: 0;
  max-width: 7rem;
}

/* Progressive collapse as the tile narrows. Order of removal (least-
 * essential first). Mode used to live here too — it's now in the
 * composer row at the bottom of the chat, leaving more room for the
 * remaining controls so the workspace chip survives much longer.
 *
 *   wide        →  workspace + model + effort + reasoning + gear
 *   < 26rem     →  drop "reasoning"
 *   < 18rem     →  drop workspace chip
 *   < 14rem     →  drop "effort"
 *   < 10rem     →  drop "model"         (gear only) */
@container (max-width: 26rem) {
  .compact-select-reasoning {
    display: none;
  }
  .session-terminal-button :deep(.p-button-label) {
    display: none;
  }
}
@container (max-width: 18rem) {
  .workspace-chip :deep(.p-chip-label) {
    display: none;
  }
  .workspace-chip {
    width: 1.75rem;
    padding-inline: 0;
    justify-content: center;
  }
  .agent-chip {
    display: none;
  }
}
@container (max-width: 14rem) {
  .compact-select-effort {
    display: none;
  }
}
@container (max-width: 10rem) {
  .compact-select {
    display: none;
  }
}

/* Workspace chip sits on the LEFT edge of the header strip (the rest
 * of the controls right-align). PrimeVue's Chip is a div with icon +
 * label baked in — style it to read as a clickable affordance. */
.workspace-chip {
  margin-right: auto;
  max-width: 14rem;
  min-width: 0;
  height: 1.75rem;
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  background: transparent;
  border: 1px solid transparent;
}

.workspace-chip:hover {
  /* Theme-aware: mix the text colour into transparent so the chip
   * gets a faint backdrop on hover that auto-flips between light and
   * dark. */
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}

.workspace-chip:focus-visible {
  outline: 2px solid var(--p-focus-ring-color, var(--p-primary-color));
  outline-offset: 2px;
}

.workspace-chip :deep(.p-chip-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 11rem;
}

/* Agent chip mirrors the workspace-chip styling. Sits right after the
 * workspace chip; only renders when record.currentAgent is set. */
.agent-chip {
  max-width: 12rem;
  min-width: 0;
  height: 1.75rem;
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--p-text-secondary-color);
  background: transparent;
  border: 1px dashed color-mix(in srgb, var(--p-text-color) 25%, transparent);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.agent-chip:hover {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
  border-color: var(--p-text-color);
}

.agent-chip:focus-visible {
  outline: 2px solid var(--p-focus-ring-color, var(--p-primary-color));
  outline-offset: 2px;
}

.agent-chip :deep(.p-chip-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 9rem;
}

/* PrimeVue Select sized to fit comfortably alongside dockview tabs.
 * The value itself shows the model/effort name — labels would just
 * eat horizontal space in the tab strip. flex-shrink so the select
 * can compress below its min-width when the tab strip is cramped. */
.compact-select {
  flex: 0 1 auto;
  min-width: 0;
}

/* Cog button — active state when the right-rail details panel is
 * open for this session. Theme-aware tint via PrimeVue tokens. */
:deep(.cog-active) {
  background: color-mix(in srgb, var(--p-primary-color) 20%, transparent);
  color: var(--p-primary-color);
}

:deep(.approve-all-active) {
  background: color-mix(in srgb, var(--p-green-500) 20%, transparent);
  color: var(--p-green-500);
  font-weight: 700;
}

@container (max-width: 34rem) {
  .session-header-controls.area-composer-left :deep(.approve-all-button .p-button-label) {
    display: none;
  }
  .session-header-controls.area-composer-left :deep(.approve-all-button) {
    width: 1.75rem;
    padding-inline: 0;
  }
}

/* Non-leaf tree rows (provider / type). We render the label inside a
 * span with a click handler so the user can expand/collapse by
 * clicking anywhere on the row, not just the small chevron. */
.tree-group-label {
  display: inline-block;
  cursor: pointer;
  user-select: none;
  width: 100%;
}

/* Visually hidden but exposed to assistive tech — used on the mode
 * SelectButton's icon-only options so screen readers announce the
 * mode label. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* TreeSelect (model picker) uses a different root class than Select;
 * mirror the same sizing so the model field reads as part of the
 * same row. */
.compact-tree-select :deep(.p-treeselect) {
  min-width: 7rem;
  max-width: 12rem;
  height: 1.75rem;
  display: inline-flex;
  align-items: center;
}
.compact-tree-select :deep(.p-treeselect-label) {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Run-mode SelectButton (icon-only segmented control). Shows the
 * three modes as a button group with icons so it stays compact and
 * legible without a placeholder. */
.compact-mode-group {
  flex: 0 0 auto;
}
.compact-mode-group :deep(.p-selectbutton .p-button) {
  height: 1.75rem;
  padding: 0 0.5rem;
  font-size: 0.85rem;
}
.compact-mode-group :deep(.p-selectbutton .p-button .pi) {
  font-size: 0.85rem;
}

.compact-select :deep(.p-select) {
  min-width: 5rem;
  max-width: 11rem;
  height: 1.75rem;
}

.compact-select :deep(.p-select-label) {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compact-select-effort {
  flex: 0 1 auto;
  min-width: 0;
}
.compact-select-effort :deep(.p-select) {
  min-width: 4rem;
  max-width: 7rem;
}

.compact-select-mode {
  flex: 0 1 auto;
  min-width: 0;
}
.compact-select-mode :deep(.p-select) {
  min-width: 5.5rem;
  max-width: 8rem;
}

.compact-select-reasoning {
  flex: 0 1 auto;
  min-width: 0;
}
.compact-select-reasoning :deep(.p-select) {
  min-width: 6rem;
  max-width: 9rem;
}

/* The popover is mounted to the body so it lives outside the cramped
 * tab strip — full-size rows OK here. */
.session-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 18rem;
}

.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.option-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}

.option-label {
  font-size: 0.8rem;
  color: var(--p-text-color);
}

.option-row :deep(.p-select) {
  min-width: 9rem;
}

.rename-form {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.rename-form :deep(.p-inputtext) {
  flex: 1 1 auto;
  min-width: 0;
}

.option-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  padding-top: 0.25rem;
  border-top: 1px solid var(--p-content-border-color);
}

.popover-empty-hint {
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
  padding: 0.2rem 0;
}

.popover-error {
  color: var(--p-red-500, #ef4444);
  word-break: break-word;
}

.popover-skill-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 12rem;
  overflow-y: auto;
}

.popover-skill-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--p-content-border-color) 60%, transparent);
}

.popover-skill-row:last-child {
  border-bottom: none;
}

.popover-skill-text {
  flex: 1 1 auto;
  min-width: 0;
}

.popover-skill-name {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--p-text-color);
  font-weight: 500;
}

.popover-skill-tag {
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
  padding: 0 0.3rem;
  border-radius: var(--p-border-radius-sm, 3px);
}

.popover-skill-desc {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  margin-top: 0.1rem;
  line-height: 1.3;
}

.popover-usage {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
}

.popover-usage-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.popover-usage-row dt {
  margin: 0;
  color: var(--p-text-muted-color);
}

.popover-usage-row dd {
  margin: 0;
  color: var(--p-text-color);
  font-variant-numeric: tabular-nums;
}

.option-row-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.option-row-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1 1 auto;
  min-width: 0;
}

.option-row-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.option-row-hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  line-height: 1.4;
}

.workspace-path {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  min-width: 0;
}

.workspace-path-button {
  /* Same row layout as the read-only div, just rendered as a button
   * so click + keyboard focus work. */
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--p-border-radius-md);
  padding: 0.25rem 0.4rem;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  width: 100%;
}
.workspace-path-button:hover {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}
.workspace-path-button:focus-visible {
  outline: 2px solid var(--p-focus-ring-color, var(--p-primary-color));
  outline-offset: 1px;
}
.workspace-path-hint {
  margin-left: auto;
  opacity: 0.6;
  font-size: 0.7rem;
}

.workspace-path-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
</style>
