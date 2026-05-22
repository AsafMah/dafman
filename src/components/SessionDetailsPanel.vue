<script setup lang="ts">
/// Right-edge dockview panel hosting all per-session settings + actions.
///
/// Replaces the gear-popover that previously hung off
/// `SessionHeaderControls.vue`. Content is the same (rename, mode,
/// reasoning view, workspace, approve-all toggle, skills, usage,
/// export, compact, reset approvals) plus a new **Fork session**
/// action at the top.
///
/// One panel per session, id `session-details-${sessionId}`. The
/// panel is registered globally in `src/main.ts` as
/// `sessionDetails` (alongside `chat`, `sessionsManager`, etc.).
/// The panel reads `params.sessionId` from the dockview panel API.
///
/// Per the user's spec (2026-05-22): opens by default on session
/// create + on resume; dockview persists the open/closed state via
/// `toJSON()`/`fromJSON()` in `layoutStore.snapshot/restore`, so no
/// settings v9 bump is required.

import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import ToggleSwitch from "primevue/toggleswitch";
import type {
  ReasoningVisibility,
  SessionMode,
} from "../ipc/types";
import { useSessionsStore } from "../stores/sessionsStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import { invokeCommand } from "../ipc/invoke";

/// Dockview passes params either as `{ params }` (initial mount) or
/// wrapped after `panel.update()` calls. Normalize both shapes —
/// same defensive read pattern as `ChatPanel.vue`.
const dockviewProps = defineProps<{
  params?: {
    sessionId?: string;
    params?: { sessionId?: string };
  };
}>();

const sessionId = computed<string>(() => {
  const direct = dockviewProps.params?.sessionId;
  const nested = dockviewProps.params?.params?.sessionId;
  return direct ?? nested ?? "";
});

const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();

const record = computed(() =>
  sessionsStore.sessions.find((s) => s.id === sessionId.value),
);

// ---------- Name ----------
const nameDraft = ref<string>(record.value?.title ?? "");
watch(
  () => sessionId.value,
  () => {
    nameDraft.value = record.value?.title ?? "";
  },
);
watch(
  () => record.value?.title,
  (next) => {
    // Reflect SDK-side title changes (auto-summary, /rename) into
    // the draft so the input stays in sync when not actively
    // edited. Skip if the input has user-pending edits.
    const trimmed = nameDraft.value.trim();
    if (!trimmed || trimmed === (next ?? "")) {
      nameDraft.value = next ?? "";
    }
  },
);
function onRenameSubmit() {
  const trimmed = nameDraft.value.trim();
  if (!trimmed) return;
  nameDraft.value = trimmed;
  void sessionsStore.setSessionName(sessionId.value, trimmed);
}

// ---------- Mode ----------
const modeOptions: { label: string; value: SessionMode; icon: string }[] = [
  { label: "Interactive", value: "interactive", icon: "pi pi-comments" },
  { label: "Plan", value: "plan", icon: "pi pi-list-check" },
  { label: "Autopilot", value: "autopilot", icon: "pi pi-bolt" },
];
const modeChoice = computed<SessionMode | null>({
  get: () => record.value?.mode ?? null,
  set: (value) => {
    if (!value || value === record.value?.mode) return;
    void sessionsStore.setSessionMode(sessionId.value, value);
  },
});

// ---------- Reasoning visibility override ----------
const settings = storeToRefs(useSettingsStore()).settings;
const reasoningOptions: { label: string; value: ReasoningVisibility }[] = [
  { label: "Hidden", value: "hidden" },
  { label: "Compact", value: "compact" },
  { label: "Expanded", value: "expanded" },
];
const reasoningChoice = computed<ReasoningVisibility>({
  get: () => {
    const v = record.value?.reasoningVisibilityOverride;
    if (!v || v === "default") return settings.value.appearance.reasoningVisibility;
    return v;
  },
  set: (value) => {
    sessionsStore.setSessionReasoningOverride(sessionId.value, value);
  },
});

// ---------- Workspace ----------
function onWorkspaceClick() {
  const path = record.value?.workingDirectory;
  if (!path) return;
  void invokeCommand("revealPath", { path });
}

// ---------- Approve-all ----------
const approveAll = computed(() => record.value?.approveAll ?? false);
function onToggleApproveAll(next: boolean) {
  void sessionsStore.setSessionApproveAll(sessionId.value, next);
}

// ---------- Skills ----------
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
  if (!sessionId.value) return;
  skillsError.value = null;
  try {
    sessionSkills.value = await invokeCommand("listSessionSkills", {
      sessionId: sessionId.value,
    });
    skillsLoaded.value = true;
  } catch (err) {
    skillsError.value = err instanceof Error ? err.message : String(err);
    skillsLoaded.value = true;
  }
}
async function toggleSkill(skill: SessionSkill) {
  const next = !skill.enabled;
  skill.enabled = next;
  try {
    await invokeCommand("setSessionSkillEnabled", {
      sessionId: sessionId.value,
      name: skill.name,
      enabled: next,
    });
  } catch {
    skill.enabled = !next;
  }
}

// ---------- Usage metrics ----------
const usage = ref<{
  totalUserRequests: number;
  totalPremiumRequestCost: number;
  totalApiDurationMs: number;
  lastCallInputTokens: number;
  lastCallOutputTokens: number;
} | null>(null);
const usageError = ref<string | null>(null);
async function loadUsage() {
  if (!sessionId.value) return;
  usageError.value = null;
  try {
    const raw = await invokeCommand("getSessionUsageMetrics", {
      sessionId: sessionId.value,
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

// Lazy-load skills + usage on mount + when session changes.
onMounted(() => {
  void loadSkills();
  void loadUsage();
});
watch(
  () => sessionId.value,
  () => {
    sessionSkills.value = [];
    skillsLoaded.value = false;
    skillsError.value = null;
    usage.value = null;
    usageError.value = null;
    void loadSkills();
    void loadUsage();
  },
);

// ---------- Actions ----------
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
function onCompactNow() {
  void sessionsStore.compactSessionHistory(sessionId.value);
}
function onResetApprovals() {
  void sessionsStore.resetSessionApprovals(sessionId.value);
}
async function onForkSession() {
  try {
    const newId = await sessionsStore.forkSession(sessionId.value);
    // forkSession internally calls restoreSession, which creates the
    // SessionRecord. We still need to open the dockview panel.
    layoutStore.addPanel(newId);
    toasts.success("Session forked", `New session: ${newId.slice(0, 8)}`);
  } catch (err) {
    toasts.error("Fork failed", err instanceof Error ? err.message : String(err));
  }
}
</script>

<template>
  <div v-if="record" class="session-details">
    <header class="section-header section-header-top">
      <span class="section-title">Session</span>
      <Button
        icon="pi pi-clone"
        size="small"
        severity="secondary"
        text
        label="Fork"
        title="Fork this session into a new independent thread"
        @click="onForkSession"
      />
    </header>

    <!-- Name ------------------------------------------------------ -->
    <section class="row row-stack">
      <label class="row-label" :for="`details-name-${sessionId}`">
        Session name
      </label>
      <form class="rename-form" @submit.prevent="onRenameSubmit">
        <InputText
          :id="`details-name-${sessionId}`"
          v-model="nameDraft"
          size="small"
          placeholder="Untitled"
          class="rename-input"
        />
        <Button
          type="submit"
          label="Save"
          size="small"
          :disabled="!nameDraft.trim()"
        />
      </form>
    </section>

    <!-- Mode ------------------------------------------------------ -->
    <section class="row">
      <span class="row-label">Run mode</span>
      <SelectButton
        v-model="modeChoice"
        :options="modeOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        aria-label="Agent run mode"
      >
        <template #option="slotProps">
          <i :class="slotProps.option.icon" :title="slotProps.option.label" />
          <span class="sr-only">{{ slotProps.option.label }}</span>
        </template>
      </SelectButton>
    </section>

    <!-- Reasoning view ------------------------------------------- -->
    <label class="row" :for="`details-reasoning-${sessionId}`">
      <span class="row-label">Reasoning view</span>
      <Select
        :input-id="`details-reasoning-${sessionId}`"
        v-model="reasoningChoice"
        :options="reasoningOptions"
        option-label="label"
        option-value="value"
        size="small"
        aria-label="Reasoning visibility for this session"
      />
    </label>

    <!-- Workspace ------------------------------------------------- -->
    <section class="row row-stack">
      <span class="row-label">Workspace</span>
      <button
        v-if="record.workingDirectory"
        type="button"
        class="workspace-path workspace-path-button"
        :title="`Open ${record.workingDirectory}`"
        :aria-label="`Open workspace folder ${record.workingDirectory}`"
        @click="onWorkspaceClick"
      >
        <i class="pi pi-folder" aria-hidden="true" />
        <span class="workspace-path-text">{{ record.workingDirectory }}</span>
        <i class="pi pi-external-link workspace-path-hint" aria-hidden="true" />
      </button>
      <div v-else class="workspace-path" title="Default (cli process cwd)">
        <i class="pi pi-folder" aria-hidden="true" />
        <span class="workspace-path-text">Default</span>
      </div>
    </section>

    <!-- Approve all ---------------------------------------------- -->
    <section class="row row-toggle">
      <div class="row-toggle-label">
        <span class="row-toggle-title">Auto-approve all tools</span>
        <span class="row-hint">
          Skip permission prompts for the rest of this session.
        </span>
      </div>
      <ToggleSwitch
        :model-value="approveAll"
        @update:model-value="onToggleApproveAll"
      />
    </section>

    <!-- Skills ---------------------------------------------------- -->
    <section class="row row-stack">
      <span class="row-label">Skills</span>
      <div v-if="!skillsLoaded" class="empty-hint">Loading…</div>
      <div v-else-if="skillsError" class="empty-hint error">{{ skillsError }}</div>
      <div v-else-if="sessionSkills.length === 0" class="empty-hint">
        No skills configured for this session.
      </div>
      <ul v-else class="skill-list">
        <li v-for="skill in sessionSkills" :key="skill.name" class="skill-row">
          <div class="skill-text">
            <div class="skill-name">
              <span>{{ skill.name }}</span>
              <small v-if="skill.userInvocable" class="skill-tag">/</small>
            </div>
            <div v-if="skill.description" class="skill-desc">
              {{ skill.description }}
            </div>
          </div>
          <ToggleSwitch
            :model-value="skill.enabled"
            @update:model-value="() => toggleSkill(skill)"
          />
        </li>
      </ul>
    </section>

    <!-- Usage ----------------------------------------------------- -->
    <section v-if="usage || usageError" class="row row-stack">
      <span class="row-label">Usage</span>
      <div v-if="usageError" class="empty-hint error">{{ usageError }}</div>
      <dl v-else-if="usage" class="usage">
        <div class="usage-row">
          <dt>Requests</dt>
          <dd>{{ usage.totalUserRequests }}</dd>
        </div>
        <div class="usage-row">
          <dt>Premium cost</dt>
          <dd>{{ usage.totalPremiumRequestCost.toFixed(2) }}</dd>
        </div>
        <div class="usage-row">
          <dt>API time</dt>
          <dd>{{ formatDurationMs(usage.totalApiDurationMs) }}</dd>
        </div>
        <div class="usage-row">
          <dt>Last in / out tokens</dt>
          <dd>
            {{ usage.lastCallInputTokens.toLocaleString() }} /
            {{ usage.lastCallOutputTokens.toLocaleString() }}
          </dd>
        </div>
      </dl>
    </section>

    <!-- Actions --------------------------------------------------- -->
    <section class="row row-actions">
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
    </section>
  </div>
  <div v-else class="session-details session-details-empty">
    <p class="empty-hint">Session not found.</p>
  </div>
</template>

<style scoped>
.session-details {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.75rem 0.85rem 1rem;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
  color: var(--p-text-color);
}

.session-details-empty {
  align-items: center;
  justify-content: center;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
}

.row-toggle {
  justify-content: space-between;
  gap: 0.6rem;
}

.row-toggle-label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1 1 auto;
  min-width: 0;
}

.row-toggle-title {
  font-size: 0.85rem;
  font-weight: 500;
}

.row-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.row-actions :deep(.p-button) {
  width: 100%;
}

.row-label {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--p-text-muted-color);
}

.row-hint {
  font-size: 0.72rem;
  color: var(--p-text-muted-color);
}

.rename-form {
  display: flex;
  gap: 0.4rem;
  align-items: stretch;
}

.rename-input {
  flex: 1 1 auto;
  min-width: 0;
}

.workspace-path {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.55rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.72rem;
  color: var(--p-text-color);
  min-width: 0;
  border: 1px solid var(--p-surface-border);
}

.workspace-path-button {
  background: transparent;
  cursor: pointer;
}

.workspace-path-button:hover {
  background: var(--p-content-hover-background);
}

.workspace-path-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}

.workspace-path-hint {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.skill-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.skill-row {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  background: color-mix(in srgb, var(--p-content-hover-background) 35%, transparent);
}

.skill-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.skill-name {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 500;
}

.skill-tag {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.skill-desc {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.usage {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
}

.usage-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.78rem;
}

.usage-row dt {
  color: var(--p-text-muted-color);
}

.usage-row dd {
  margin: 0;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
}

.empty-hint {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  padding: 0.5rem;
  text-align: center;
}

.empty-hint.error {
  color: var(--p-red-500, #f43f5e);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}
</style>
