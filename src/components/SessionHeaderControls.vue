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

import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import Chip from "primevue/chip";
import InputText from "primevue/inputtext";
import Popover from "primevue/popover";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import TreeSelect from "primevue/treeselect";
import type { TreeNode } from "primevue/treenode";
import ToggleSwitch from "primevue/toggleswitch";
import type {
  ModelSummary,
  ReasoningVisibility,
  SessionMode,
} from "../ipc/types";
import { useModelsStore } from "../stores/modelsStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import { basename } from "../stores/layoutStore";
import { invokeCommand } from "../ipc/invoke";
import {
  buildModelTree,
} from "../lib/modelTree";

const props = defineProps<{ sessionId: string }>();

const sessionsStore = useSessionsStore();
const toasts = useToastStore();
const modelsStore = useModelsStore();
const { models } = storeToRefs(modelsStore);

onMounted(() => {
  modelsStore.load().catch(() => {
    /* toast already shown by the store */
  });
});

const record = computed(() =>
  sessionsStore.sessions.find((s) => s.id === props.sessionId),
);

const selectedModel = computed<ModelSummary | undefined>(() => {
  const id = record.value?.model;
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
    const id = record.value?.model;
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
  get: () => record.value?.reasoningEffort ?? null,
  set: (value) => {
    if (!value || !record.value?.model) return;
    void sessionsStore.setSessionModel(props.sessionId, record.value.model, value);
  },
});

const modeOptions: { label: string; value: SessionMode; icon: string }[] = [
  // Icons read as: interactive = chat bubble, plan = clipboard
  // checklist, autopilot = play (auto-execute).
  { label: "Interactive", value: "interactive", icon: "pi pi-comments" },
  { label: "Plan", value: "plan", icon: "pi pi-list-check" },
  { label: "Autopilot", value: "autopilot", icon: "pi pi-bolt" },
];

const modeChoice = computed<SessionMode | null>({
  get: () => record.value?.mode ?? null,
  set: (value) => {
    if (!value || value === record.value?.mode) return;
    void sessionsStore.setSessionMode(props.sessionId, value);
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
const settings = storeToRefs(useSettingsStore()).settings;

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

const nameDraft = ref<string>(record.value?.title ?? "");

watch(
  () => props.sessionId,
  () => {
    nameDraft.value = record.value?.title ?? "";
  },
);

const optionsMenu = ref<InstanceType<typeof Popover> | null>(null);

function toggleOptions(event: Event) {
  // Pre-fill the rename input with the current title every time the
  // popover opens, so the user sees what's there before editing. Done
  // here (not in a watcher) so an in-flight edit isn't clobbered by a
  // late `session.title_changed` echo while the popover is open.
  nameDraft.value = record.value?.title ?? "";
  optionsMenu.value?.toggle(event);
  // Refresh skills + usage every popover-open. Cheap RPCs; gives the
  // user always-current data without a separate refresh button.
  void loadSkills();
  void loadUsage();
}

function onRenameSubmit() {
  const trimmed = nameDraft.value.trim();
  if (!trimmed) return;
  nameDraft.value = trimmed;
  void sessionsStore.setSessionName(props.sessionId, trimmed);
}

function onCompactNow() {
  void sessionsStore.compactSessionHistory(props.sessionId);
}

function onResetApprovals() {
  void sessionsStore.resetSessionApprovals(props.sessionId);
}

/// Build a fresh ChatItem[] from the session's raw event log and
/// shell it out as Markdown or JSON. Reusing `processEvents` here
/// keeps the export in lockstep with what the chat tile renders —
/// no second source of truth. Counter starts at 1; the export
/// doesn't share ids with the live chat window so collisions are
/// fine.
async function onExport(format: "markdown" | "json"): Promise<void> {
  const rec = record.value;
  if (!rec) return;
  try {
    const { processEvents, defaultAmbient } = await import("../lib/chatEvents");
    const { formatConversation, exportFilenameStem } = await import("../lib/exportConversation");
    const counter = { next: 1 };
    const result = processEvents([], defaultAmbient(), rec.events, counter, { live: false });
    const title = rec.title?.trim() || `Session ${rec.id.slice(0, 8)}`;
    const contents = formatConversation(
      {
        title,
        workingDirectory: rec.workingDirectory,
        model: rec.model,
        exportedAt: new Date().toISOString(),
        items: result.items,
      },
      format,
    );
    const fileName = exportFilenameStem(title, format);
    const saved = await invokeCommand("saveExportFile", { fileName, contents });
    toasts.success(
      `Conversation exported (${format === "markdown" ? "MD" : "JSON"})`,
      `${(saved.bytes / 1024).toFixed(1)} KiB`,
    );
    try {
      await invokeCommand("revealPath", { path: saved.path });
    } catch {
      /* best-effort */
    }
  } catch (err) {
    toasts.error("Export failed", err instanceof Error ? err.message : String(err));
  }
}

const approveAll = computed(() => record.value?.approveAll ?? false);
function onToggleApproveAll(next: boolean) {
  void sessionsStore.setSessionApproveAll(props.sessionId, next);
}

/// Workspace label shown in the tab strip — basename only, so it
/// stays short. Full absolute path is in the tooltip.
const workspaceLabel = computed(() => basename(record.value?.workingDirectory));

function onWorkspaceClick() {
  const path = record.value?.workingDirectory;
  if (!path) return;
  void invokeCommand("revealPath", { path });
}

// ---------- Skills & usage (popover-only) ----------

/// SDK skill list for this session. Empty until the user opens the
/// popover (we don't fetch eagerly because the popover is the only
/// surface that uses it). The result is cached on the component until
/// the next popover-open so toggling a row isn't followed by a
/// flicker-refetch.
type SessionSkill = {
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  userInvocable: boolean;
};
const sessionSkills = ref<SessionSkill[]>([]);
const skillsLoaded = ref(false);
const skillsError = ref<string | null>(null);

async function loadSkills() {
  skillsError.value = null;
  try {
    sessionSkills.value = await invokeCommand("listSessionSkills", {
      sessionId: props.sessionId,
    });
    skillsLoaded.value = true;
  } catch (err) {
    skillsError.value = err instanceof Error ? err.message : String(err);
    skillsLoaded.value = true;
  }
}

async function toggleSkill(skill: SessionSkill) {
  const next = !skill.enabled;
  // Optimistic flip so the toggle is responsive; revert on RPC failure.
  skill.enabled = next;
  try {
    await invokeCommand("setSessionSkillEnabled", {
      sessionId: props.sessionId,
      name: skill.name,
      enabled: next,
    });
  } catch {
    skill.enabled = !next;
  }
}

/// Usage metrics (token + request counts + per-model). Fetched the
/// same way as skills — lazy on popover-open. The SDK returns a rich
/// shape; we cherry-pick the fields the popover needs.
const usage = ref<{
  totalUserRequests: number;
  totalPremiumRequestCost: number;
  totalApiDurationMs: number;
  lastCallInputTokens: number;
  lastCallOutputTokens: number;
} | null>(null);
const usageError = ref<string | null>(null);

async function loadUsage() {
  usageError.value = null;
  try {
    const raw = await invokeCommand("getSessionUsageMetrics", {
      sessionId: props.sessionId,
    });
    usage.value = {
      totalUserRequests:
        typeof raw.totalUserRequests === "number" ? raw.totalUserRequests : 0,
      totalPremiumRequestCost:
        typeof raw.totalPremiumRequestCost === "number"
          ? raw.totalPremiumRequestCost
          : 0,
      totalApiDurationMs:
        typeof raw.totalApiDurationMs === "number" ? raw.totalApiDurationMs : 0,
      lastCallInputTokens:
        typeof raw.lastCallInputTokens === "number" ? raw.lastCallInputTokens : 0,
      lastCallOutputTokens:
        typeof raw.lastCallOutputTokens === "number"
          ? raw.lastCallOutputTokens
          : 0,
    };
  } catch (err) {
    usageError.value = err instanceof Error ? err.message : String(err);
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const min = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${min}m ${sec}s`;
}
</script>

<template>
  <div v-if="record" class="session-header-controls">
    <Chip
      v-if="workspaceLabel"
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
    <TreeSelect
      :input-id="`model-${props.sessionId}`"
      v-model="modelTreeChoice"
      v-model:expanded-keys="expandedKeys"
      :options="modelTree"
      selection-mode="single"
      size="small"
      filter
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
      v-if="selectedModel?.supportsReasoningEffort"
      :input-id="`effort-${props.sessionId}`"
      v-model="effortChoice"
      :options="effortOptions"
      option-label="label"
      option-value="value"
      size="small"
      filter
      placeholder="Effort"
      aria-label="Reasoning effort for this session"
      class="compact-select compact-select-effort"
    />
    <Select
      :input-id="`reasoning-inline-${props.sessionId}`"
      v-model="reasoningChoice"
      :options="reasoningOptions"
      option-label="label"
      option-value="value"
      size="small"
      filter
      placeholder="Reasoning"
      aria-label="Reasoning visibility for this session"
      class="compact-select compact-select-reasoning"
    />
    <Button
      icon="pi pi-cog"
      text
      rounded
      size="small"
      aria-label="Session options"
      aria-haspopup="true"
      @click="toggleOptions"
    />
    <Popover ref="optionsMenu">
      <div class="session-options">
        <div class="option-row option-row-stack">
          <label class="option-label" :for="`name-${props.sessionId}`">
            Session name
          </label>
          <form class="rename-form" @submit.prevent="onRenameSubmit">
            <InputText
              :id="`name-${props.sessionId}`"
              v-model="nameDraft"
              size="small"
              placeholder="Untitled"
            />
            <Button
              type="submit"
              label="Save"
              size="small"
              :disabled="!nameDraft.trim()"
            />
          </form>
        </div>
        <!-- Run mode + reasoning view live inline in the header strip
             when there's room; the popover keeps them as a guaranteed
             fallback so a narrow pane can still reach them. -->
        <div class="option-row">
          <span class="option-label">Run mode</span>
          <SelectButton
            v-model="modeChoice"
            :options="modeOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            size="small"
            aria-label="Agent run mode (popover)"
          >
            <template #option="slotProps">
              <i
                :class="slotProps.option.icon"
                :title="slotProps.option.label"
              />
              <span class="sr-only">{{ slotProps.option.label }}</span>
            </template>
          </SelectButton>
        </div>
        <label
          class="option-row"
          :for="`reasoning-${props.sessionId}`"
        >
          <span class="option-label">Reasoning view</span>
          <Select
            :input-id="`reasoning-${props.sessionId}`"
            v-model="reasoningChoice"
            :options="reasoningOptions"
            option-label="label"
            option-value="value"
            size="small"
            filter
            aria-label="Reasoning visibility for this session (popover)"
          />
        </label>
        <div class="option-row option-row-stack">
          <span class="option-label">Workspace</span>
          <button
            v-if="record.workingDirectory"
            type="button"
            class="workspace-path workspace-path-button"
            :title="`Open ${record.workingDirectory}`"
            :aria-label="`Open workspace folder ${record.workingDirectory}`"
            @click="onWorkspaceClick"
          >
            <i class="pi pi-folder" aria-hidden="true" />
            <span class="workspace-path-text">
              {{ record.workingDirectory }}
            </span>
            <i class="pi pi-external-link workspace-path-hint" aria-hidden="true" />
          </button>
          <div v-else class="workspace-path" title="Default (cli process cwd)">
            <i class="pi pi-folder" aria-hidden="true" />
            <span class="workspace-path-text">Default</span>
          </div>
        </div>
        <div class="option-row option-row-toggle">
          <div class="option-row-label">
            <span class="option-row-title">Auto-approve all tools</span>
            <span class="option-row-hint">
              Skip permission prompts for the rest of this session.
              "Reset approvals" below clears any per-tool memory the
              SDK kept; this toggle controls dafman's prompt gate.
            </span>
          </div>
          <ToggleSwitch
            :model-value="approveAll"
            @update:model-value="onToggleApproveAll"
          />
        </div>
        <!-- Skills section. Lazy-loaded on popover-open. Empty state
             when the SDK returns no skills for this session (most
             common today — skills are M5 territory). -->
        <div class="option-row option-row-stack">
          <span class="option-label">Skills</span>
          <div v-if="!skillsLoaded" class="popover-empty-hint">Loading…</div>
          <div v-else-if="skillsError" class="popover-empty-hint popover-error">
            {{ skillsError }}
          </div>
          <div v-else-if="sessionSkills.length === 0" class="popover-empty-hint">
            No skills configured for this session.
          </div>
          <ul v-else class="popover-skill-list">
            <li
              v-for="skill in sessionSkills"
              :key="skill.name"
              class="popover-skill-row"
            >
              <div class="popover-skill-text">
                <div class="popover-skill-name">
                  <span>{{ skill.name }}</span>
                  <small v-if="skill.userInvocable" class="popover-skill-tag">/</small>
                </div>
                <div v-if="skill.description" class="popover-skill-desc">
                  {{ skill.description }}
                </div>
              </div>
              <ToggleSwitch
                :model-value="skill.enabled"
                @update:model-value="() => toggleSkill(skill)"
              />
            </li>
          </ul>
        </div>

        <!-- Usage metrics. Cherry-picked from SDK usage.getMetrics. -->
        <div v-if="usage || usageError" class="option-row option-row-stack">
          <span class="option-label">Usage</span>
          <div v-if="usageError" class="popover-empty-hint popover-error">
            {{ usageError }}
          </div>
          <dl v-else-if="usage" class="popover-usage">
            <div class="popover-usage-row">
              <dt>Requests</dt>
              <dd>{{ usage.totalUserRequests }}</dd>
            </div>
            <div class="popover-usage-row">
              <dt>Premium cost</dt>
              <dd>{{ usage.totalPremiumRequestCost.toFixed(2) }}</dd>
            </div>
            <div class="popover-usage-row">
              <dt>API time</dt>
              <dd>{{ formatDurationMs(usage.totalApiDurationMs) }}</dd>
            </div>
            <div class="popover-usage-row">
              <dt>Last in / out tokens</dt>
              <dd>
                {{ usage.lastCallInputTokens.toLocaleString() }} /
                {{ usage.lastCallOutputTokens.toLocaleString() }}
              </dd>
            </div>
          </dl>
        </div>

        <div class="option-actions">
          <Button
            icon="pi pi-download"
            label="Export Markdown"
            size="small"
            severity="secondary"
            @click="onExport('markdown')"
          />
          <Button
            icon="pi pi-file-export"
            label="Export JSON"
            size="small"
            severity="secondary"
            @click="onExport('json')"
          />
          <Button
            icon="pi pi-compress"
            label="Compact history"
            size="small"
            severity="secondary"
            @click="onCompactNow"
          />
          <Button
            icon="pi pi-refresh"
            label="Reset approvals"
            size="small"
            severity="secondary"
            @click="onResetApprovals"
          />
        </div>
      </div>
    </Popover>
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
}
@container (max-width: 18rem) {
  .workspace-chip {
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

/* PrimeVue Select sized to fit comfortably alongside dockview tabs.
 * The value itself shows the model/effort name — labels would just
 * eat horizontal space in the tab strip. flex-shrink so the select
 * can compress below its min-width when the tab strip is cramped. */
.compact-select {
  flex: 0 1 auto;
  min-width: 0;
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
