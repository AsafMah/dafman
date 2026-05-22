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

const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();

// Singleton rail: bind to whichever chat panel is active. The
// component is mounted ONCE; the watch on `sessionId` below tears
// down + re-loads per-session data when the user switches tabs.
const sessionId = computed<string>(() => layoutStore.activeSessionId ?? "");

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

// Lazy-load skills + usage + tools + plan + quota on mount + when session changes.
onMounted(() => {
  void loadSkills();
  void loadUsage();
  void loadTools();
  void loadPlan();
  void loadQuota();
});
watch(
  () => sessionId.value,
  () => {
    sessionSkills.value = [];
    skillsLoaded.value = false;
    skillsError.value = null;
    usage.value = null;
    usageError.value = null;
    builtinTools.value = [];
    mcpServers.value = [];
    toolsLoaded.value = false;
    toolsError.value = null;
    planExists.value = false;
    planContent.value = "";
    planEditing.value = false;
    planError.value = null;
    planLoaded.value = false;
    quota.value = [];
    quotaError.value = null;
    warnedThresholds.clear();
    void loadSkills();
    void loadUsage();
    void loadTools();
    void loadPlan();
    void loadQuota();
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

// ---------- Tools (18b) ----------
//
// Built-in tools + MCP servers. Toggles edit the global
// `settings.tools.defaultExcluded` list (the SDK does not support
// runtime mutation, so changes only take effect for newly-created
// sessions — we surface a "Restart session to apply" toast).
type ToolItem = { name: string; description: string; namespacedName?: string };
type McpItem = { name: string; status: string; error?: string };
const builtinTools = ref<ToolItem[]>([]);
const mcpServers = ref<McpItem[]>([]);
const toolsLoaded = ref(false);
const toolsError = ref<string | null>(null);
const settingsStore = useSettingsStore();
async function loadTools() {
  if (!sessionId.value) return;
  toolsError.value = null;
  try {
    const [tools, servers] = await Promise.all([
      invokeCommand("listBuiltinTools", {}),
      invokeCommand("listSessionMcpServers", { sessionId: sessionId.value }),
    ]);
    builtinTools.value = tools.map((t) => ({
      name: t.name,
      description: t.description,
      ...(t.namespacedName ? { namespacedName: t.namespacedName } : {}),
    }));
    mcpServers.value = servers.map((s) => ({
      name: s.name,
      status: s.status,
      ...(s.error ? { error: s.error } : {}),
    }));
    toolsLoaded.value = true;
  } catch (err) {
    toolsError.value = err instanceof Error ? err.message : String(err);
    toolsLoaded.value = true;
  }
}
function isExcluded(name: string): boolean {
  return settings.value.tools?.defaultExcluded?.includes(name) ?? false;
}
async function setToolExcluded(name: string, excluded: boolean) {
  const current = settings.value.tools?.defaultExcluded ?? [];
  const next = excluded
    ? Array.from(new Set([...current, name]))
    : current.filter((n) => n !== name);
  await settingsStore.update({
    ...settings.value,
    tools: { defaultExcluded: next },
  });
  toasts.info(
    "Tool change recorded",
    "Restart the session to apply (SDK does not support runtime tool mutation).",
  );
}

// ---------- Plan (18b) ----------
const planExists = ref(false);
const planContent = ref<string>("");
const planEditing = ref(false);
const planDraft = ref<string>("");
const planError = ref<string | null>(null);
const planLoaded = ref(false);
async function loadPlan() {
  if (!sessionId.value) return;
  planError.value = null;
  try {
    const result = await invokeCommand("readSessionPlan", {
      sessionId: sessionId.value,
    });
    planExists.value = result.exists;
    planContent.value = result.content ?? "";
    planLoaded.value = true;
  } catch (err) {
    planError.value = err instanceof Error ? err.message : String(err);
    planLoaded.value = true;
  }
}
function startEditPlan() {
  planDraft.value = planContent.value;
  planEditing.value = true;
}
async function savePlan() {
  try {
    await invokeCommand("writeSessionPlan", {
      sessionId: sessionId.value,
      content: planDraft.value,
    });
    planContent.value = planDraft.value;
    planExists.value = true;
    planEditing.value = false;
    toasts.success("Plan saved");
  } catch (err) {
    toasts.error("Plan save failed", err instanceof Error ? err.message : String(err));
  }
}
function cancelEditPlan() {
  planEditing.value = false;
}

// ---------- Quota (18b) ----------
type QuotaSnapshot = {
  type: string;
  isUnlimitedEntitlement: boolean;
  entitlementRequests: number;
  usedRequests: number;
  remainingPercentage: number;
  overage: number;
  resetDate?: string;
};
const quota = ref<QuotaSnapshot[]>([]);
const quotaError = ref<string | null>(null);
const warnedThresholds = new Set<string>();
async function loadQuota() {
  quotaError.value = null;
  try {
    const raw = await invokeCommand("getAccountQuota", {});
    const snapshots: QuotaSnapshot[] = Object.entries(raw).map(([type, snap]) => ({
      type,
      ...snap,
    }));
    quota.value = snapshots;
    // Threshold warning toasts at 75% + 90% used (= 25% / 10% remaining).
    // Dedup per (type:threshold) so a poll-refresh doesn't re-fire.
    for (const snap of snapshots) {
      if (snap.isUnlimitedEntitlement) continue;
      const usedPct = 100 - snap.remainingPercentage;
      for (const threshold of [90, 75]) {
        const key = `${snap.type}:${threshold}`;
        if (usedPct >= threshold && !warnedThresholds.has(key)) {
          warnedThresholds.add(key);
          const severity = threshold === 90 ? "warn" : "info";
          toasts[severity](
            `Quota at ${usedPct.toFixed(0)}%`,
            `${snap.type}: ${snap.usedRequests}/${snap.entitlementRequests} used`,
          );
          break;
        }
      }
    }
  } catch (err) {
    quotaError.value = err instanceof Error ? err.message : String(err);
  }
}

// ---------- Collapsible sections (persisted via localStorage) ----------
//
// Each section's open/closed state lives in localStorage under a stable
// key. Defaults: tools collapsed (long); skills + mcp + plan + usage +
// quota expanded. Toggling persists immediately.
type SectionKey =
  | "skills"
  | "tools"
  | "mcp"
  | "plan"
  | "usage"
  | "quota";

const SECTION_DEFAULTS: Record<SectionKey, boolean> = {
  skills: true,
  tools: false,
  mcp: true,
  plan: true,
  usage: true,
  quota: true,
};

function readSectionState(key: SectionKey): boolean {
  if (typeof localStorage === "undefined") return SECTION_DEFAULTS[key];
  try {
    const raw = localStorage.getItem(`dafman.details.section.${key}`);
    if (raw === null) return SECTION_DEFAULTS[key];
    return raw === "1";
  } catch {
    return SECTION_DEFAULTS[key];
  }
}

const sectionOpen = ref<Record<SectionKey, boolean>>({
  skills: readSectionState("skills"),
  tools: readSectionState("tools"),
  mcp: readSectionState("mcp"),
  plan: readSectionState("plan"),
  usage: readSectionState("usage"),
  quota: readSectionState("quota"),
});

function toggleSection(key: SectionKey): void {
  const next = !sectionOpen.value[key];
  sectionOpen.value = { ...sectionOpen.value, [key]: next };
  try {
    localStorage.setItem(`dafman.details.section.${key}`, next ? "1" : "0");
  } catch {
    /* private mode / quota — ignore, in-memory state still works */
  }
}

// ---------- Per-item "show more" for long descriptions ----------
//
// Both tools and skills carry verbose descriptions. We truncate to
// one line by default and let the user expand individual rows.
// Expansion state is keyed by `${kind}:${name}` and lives in-memory
// (per-panel-mount), not persisted — descriptions don't change often
// enough to be worth a localStorage hop.

const expandedItems = ref<Set<string>>(new Set());

function isItemExpanded(kind: "tool" | "skill", name: string): boolean {
  return expandedItems.value.has(`${kind}:${name}`);
}

function toggleItemExpansion(kind: "tool" | "skill", name: string): void {
  const key = `${kind}:${name}`;
  const next = new Set(expandedItems.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedItems.value = next;
}

/// Returns the description with at most one short line. Anything past
/// a newline or 120 chars gets elided with "…". The full text is
/// revealed when the row is expanded.
function shortDescription(description: string): string {
  if (!description) return "";
  const firstLine = description.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.length <= 120) return firstLine;
  return `${firstLine.slice(0, 119)}…`;
}

function needsExpansion(description: string): boolean {
  if (!description) return false;
  if (description.includes("\n")) return true;
  return description.length > 120;
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
    <section class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.skills"
        @click="toggleSection('skills')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.skills ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Skills</span>
        <span v-if="skillsLoaded && !skillsError" class="section-count">
          {{ sessionSkills.length }}
        </span>
      </button>
      <div v-if="sectionOpen.skills" class="section-body">
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
              <template v-if="skill.description">
                <div
                  v-if="isItemExpanded('skill', skill.name)"
                  class="skill-desc skill-desc-full"
                >
                  {{ skill.description }}
                </div>
                <div v-else class="skill-desc">
                  {{ shortDescription(skill.description) }}
                </div>
                <button
                  v-if="needsExpansion(skill.description)"
                  type="button"
                  class="link-button"
                  @click="toggleItemExpansion('skill', skill.name)"
                >
                  {{ isItemExpanded('skill', skill.name) ? "Show less" : "Show more" }}
                </button>
              </template>
            </div>
            <ToggleSwitch
              :model-value="skill.enabled"
              @update:model-value="() => toggleSkill(skill)"
            />
          </li>
        </ul>
      </div>
    </section>

    <!-- Tools (18b) ----------------------------------------------- -->
    <section class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.tools"
        @click="toggleSection('tools')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.tools ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Tools</span>
        <span v-if="toolsLoaded && !toolsError" class="section-count">
          {{ builtinTools.length }}
        </span>
      </button>
      <div v-if="sectionOpen.tools" class="section-body">
        <div v-if="!toolsLoaded" class="empty-hint">Loading…</div>
        <div v-else-if="toolsError" class="empty-hint error">{{ toolsError }}</div>
        <template v-else>
          <div class="row-hint">
            Excluded tools take effect on next session create. Restart this
            session to apply changes here.
          </div>
          <ul class="tool-list">
            <li
              v-for="t in builtinTools"
              :key="`builtin-${t.name}`"
              class="tool-row"
            >
              <div class="tool-text">
                <div class="tool-name">{{ t.name }}</div>
                <template v-if="t.description">
                  <div
                    v-if="isItemExpanded('tool', t.name)"
                    class="tool-desc tool-desc-full"
                  >
                    {{ t.description }}
                  </div>
                  <div v-else class="tool-desc">
                    {{ shortDescription(t.description) }}
                  </div>
                  <button
                    v-if="needsExpansion(t.description)"
                    type="button"
                    class="link-button"
                    @click="toggleItemExpansion('tool', t.name)"
                  >
                    {{ isItemExpanded('tool', t.name) ? "Show less" : "Show more" }}
                  </button>
                </template>
              </div>
              <ToggleSwitch
                :model-value="!isExcluded(t.name)"
                :aria-label="`Enable tool ${t.name}`"
                @update:model-value="(v) => setToolExcluded(t.name, !v)"
              />
            </li>
          </ul>
        </template>
      </div>
    </section>

    <!-- MCP servers (18b) ----------------------------------------- -->
    <section v-if="toolsLoaded && mcpServers.length > 0" class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.mcp"
        @click="toggleSection('mcp')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.mcp ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">MCP servers</span>
        <span class="section-count">{{ mcpServers.length }}</span>
      </button>
      <div v-if="sectionOpen.mcp" class="section-body">
        <ul class="tool-list">
          <li
            v-for="s in mcpServers"
            :key="`mcp-${s.name}`"
            class="tool-row"
          >
            <div class="tool-text">
              <div class="tool-name">
                {{ s.name }}
                <small class="tool-tag">{{ s.status }}</small>
              </div>
              <div v-if="s.error" class="tool-desc error">{{ s.error }}</div>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- Plan (18b) ------------------------------------------------ -->
    <section class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.plan"
        @click="toggleSection('plan')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.plan ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Plan</span>
      </button>
      <div v-if="sectionOpen.plan" class="section-body">
        <div v-if="!planLoaded" class="empty-hint">Loading…</div>
        <div v-else-if="planError" class="empty-hint error">{{ planError }}</div>
        <template v-else>
          <template v-if="planEditing">
            <textarea
              v-model="planDraft"
              rows="8"
              class="plan-editor"
              aria-label="Plan content (markdown)"
            ></textarea>
            <div class="plan-actions">
              <Button label="Save" size="small" @click="savePlan" />
              <Button
                label="Cancel"
                size="small"
                severity="secondary"
                text
                @click="cancelEditPlan"
              />
            </div>
          </template>
          <template v-else>
            <div v-if="planExists && planContent" class="plan-preview">
              {{ planContent }}
            </div>
            <div v-else class="empty-hint">No plan yet.</div>
            <Button
              :label="planExists ? 'Edit plan' : 'Create plan'"
              icon="pi pi-pencil"
              size="small"
              severity="secondary"
              @click="startEditPlan"
            />
          </template>
        </template>
      </div>
    </section>

    <!-- Usage ----------------------------------------------------- -->
    <section v-if="usage || usageError" class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.usage"
        @click="toggleSection('usage')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.usage ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Usage</span>
      </button>
      <div v-if="sectionOpen.usage" class="section-body">
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
      </div>
    </section>

    <!-- Quota (18b) ---------------------------------------------- -->
    <section v-if="quota.length > 0 || quotaError" class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.quota"
        @click="toggleSection('quota')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.quota ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Account quota</span>
      </button>
      <div v-if="sectionOpen.quota" class="section-body">
        <div v-if="quotaError" class="empty-hint error">{{ quotaError }}</div>
        <ul v-else class="quota-list">
          <li v-for="q in quota" :key="q.type" class="quota-row">
            <div class="quota-name">
              {{ q.type }}
              <small v-if="q.isUnlimitedEntitlement" class="quota-tag">
                unlimited
              </small>
            </div>
            <template v-if="!q.isUnlimitedEntitlement">
              <div class="quota-bar" :class="{
                warn: 100 - q.remainingPercentage >= 75,
                danger: 100 - q.remainingPercentage >= 90,
              }">
                <div
                  class="quota-fill"
                  :style="{ width: `${100 - q.remainingPercentage}%` }"
                />
              </div>
              <div class="quota-meta">
                {{ q.usedRequests }} / {{ q.entitlementRequests }}
                <span v-if="q.resetDate" class="quota-reset">
                  · resets {{ new Date(q.resetDate).toLocaleDateString() }}
                </span>
              </div>
            </template>
          </li>
        </ul>
      </div>
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
  <div v-else-if="!sessionId" class="session-details session-details-empty">
    <p class="empty-hint">No active session.</p>
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
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  background: color-mix(in srgb, var(--p-content-hover-background) 35%, transparent);
  min-width: 0;
}

.skill-row :deep(.p-toggleswitch) {
  flex-shrink: 0;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-desc-full {
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
}

.link-button {
  background: none;
  border: none;
  padding: 0;
  margin-top: 0.1rem;
  font-size: 0.7rem;
  color: var(--p-primary-color);
  cursor: pointer;
  text-align: left;
  align-self: flex-start;
}

.link-button:hover {
  text-decoration: underline;
}

/* ---------- Collapsible sections ---------- */
.section {
  gap: 0.3rem;
}

.section-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  padding: 0.25rem 0;
  cursor: pointer;
  color: var(--p-text-color);
  font: inherit;
  text-align: left;
  width: 100%;
}

.section-toggle:hover {
  color: var(--p-primary-color);
}

.section-chevron {
  font-size: 0.65rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.section-count {
  font-size: 0.65rem;
  color: var(--p-text-muted-color);
  background: var(--p-content-hover-background);
  padding: 0.05rem 0.35rem;
  border-radius: var(--p-border-radius-sm);
  margin-left: auto;
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* ---------- Tools (18b) ---------- */
.tool-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tool-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  min-width: 0;
}

.tool-row :deep(.p-toggleswitch) {
  flex-shrink: 0;
}

.tool-text {
  flex: 1 1 auto;
  min-width: 0;
}

.tool-name {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 500;
}

.tool-desc {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  margin-top: 0.15rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-desc-full {
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
}

.tool-desc.error {
  color: var(--p-message-error-color);
}

.tool-tag {
  font-size: 0.65rem;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
  background: var(--p-content-hover-background);
  padding: 0.1rem 0.3rem;
  border-radius: var(--p-border-radius-sm);
}

.mcp-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-top: 0.4rem;
}

.mcp-heading {
  margin-bottom: 0.2rem;
}

/* ---------- Plan (18b) ---------- */
.plan-editor {
  width: 100%;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  padding: 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  background: var(--p-content-background);
  color: var(--p-text-color);
  resize: vertical;
  box-sizing: border-box;
}

.plan-preview {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.72rem;
  white-space: pre-wrap;
  padding: 0.4rem 0.5rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  max-height: 200px;
  overflow-y: auto;
}

.plan-actions {
  display: flex;
  gap: 0.4rem;
}

/* ---------- Quota (18b) ---------- */
.quota-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.quota-row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.quota-name {
  font-size: 0.78rem;
  font-weight: 500;
}

.quota-tag {
  font-size: 0.65rem;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

.quota-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--p-content-hover-background);
  overflow: hidden;
}

.quota-fill {
  height: 100%;
  background: var(--p-primary-color);
}

.quota-bar.warn .quota-fill {
  background: var(--p-message-warn-color, #d97706);
}

.quota-bar.danger .quota-fill {
  background: var(--p-message-error-color, #dc2626);
}

.quota-meta {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.quota-reset {
  margin-left: 0.2rem;
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
