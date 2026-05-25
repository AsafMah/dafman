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

import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import ToggleSwitch from 'primevue/toggleswitch';
import type { AgentInfo, ReasoningVisibility, SessionMode, TaskInfo } from '../../ipc/types';
import { useSessionsStore } from '../../stores/chat/sessionsStore';
import { useLayoutStore } from '../../stores/shell/layoutStore';
import { useSettingsStore } from '../../stores/app/settingsStore';
import { useToastStore } from '../../stores/app/toastStore';
import { invokeCommand } from '../../ipc/invoke';
import MessageContent from '../chat/MessageContent.vue';
import { toErrorMessage } from '../../lib/errorMessage';
import { revealPath } from '../../lib/pathActions';
import { MODE_OPTIONS } from '../../lib/sessionModeOptions';

const MAX_PLAUSIBLE_CONTEXT_TOKENS = 500_000;

function normalizeContextLimit(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;

  if (value > MAX_PLAUSIBLE_CONTEXT_TOKENS) return null;

  return value;
}

const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();

// Singleton rail: bind to whichever chat panel is active. The
// component is mounted ONCE; the watch on `sessionId` below tears
// down + re-loads per-session data when the user switches tabs.
const sessionId = computed<string>(() => layoutStore.activeSessionId ?? '');

const record = computed(() => sessionsStore.getSession(sessionId.value));

// ---------- Name ----------
const nameDraft = ref<string>(record.value?.title ?? '');

watch(
  () => sessionId.value,
  () => {
    nameDraft.value = record.value?.title ?? '';
  },
);
watch(
  () => record.value?.title,
  (next) => {
    // Reflect SDK-side title changes (auto-summary, /rename) into
    // the draft so the input stays in sync when not actively
    // edited. Skip if the input has user-pending edits.
    const trimmed = nameDraft.value.trim();

    if (!trimmed || trimmed === (next ?? '')) {
      nameDraft.value = next ?? '';
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
const modeChoice = computed<SessionMode | null>({
  get: () => record.value?.mode ?? null,
  set: (value) => {
    if (!value || value === record.value?.mode) return;

    void sessionsStore.setSessionMode(sessionId.value, value);
  },
});
const modeClass = computed(() => `mode-${modeChoice.value ?? 'interactive'}`);

// ---------- Reasoning visibility override ----------
const settings = storeToRefs(useSettingsStore()).settings;
const reasoningOptions: { label: string; value: ReasoningVisibility }[] = [
  { label: 'Hidden', value: 'hidden' },
  { label: 'Compact', value: 'compact' },
  { label: 'Expanded', value: 'expanded' },
];
const reasoningChoice = computed<ReasoningVisibility>({
  get: () => {
    const v = record.value?.reasoningVisibilityOverride;

    if (!v || v === 'default') return settings.value.appearance.reasoningVisibility;

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

  void revealPath(path, "Couldn't open workspace");
}

function revealFile(path: string) {
  void revealPath(path, "Couldn't open file");
}

// ---------- Approve-all ----------
const approveAll = computed(() => record.value?.approveAll ?? false);

function onToggleApproveAll(next: boolean) {
  void sessionsStore.setSessionApproveAll(sessionId.value, next);
}

// ---------- Agents (19a) ----------
//
// SDK auto-discovers custom agents (enableConfigDiscovery=true on
// session create + resume). The rail just lists them via the
// @experimental session.rpc.agent.* surface. Source disambiguation
// (Project vs User) is derived from the agent's `path` field — if
// it sits under `<workingDirectory>/.github/agents/` it's a Project
// agent; otherwise it came from the user config dir.
const sessionAgents = ref<AgentInfo[]>([]);
const agentsLoaded = ref(false);
const agentsError = ref<string | null>(null);
/// Selecting/deselecting is async; we set this so the clicked row
/// can show a spinner without optimistically updating the selection
/// (subagent.selected event is the source of truth — see rubber-duck
/// finding 5 from 19a.1).
const agentBusyName = ref<string | null>(null);

async function loadAgents() {
  if (!sessionId.value) return;

  agentsError.value = null;

  try {
    sessionAgents.value = await invokeCommand('listAgents', {
      sessionId: sessionId.value,
    });
    agentsLoaded.value = true;
  } catch (err) {
    agentsError.value = toErrorMessage(err);
    agentsLoaded.value = true;
  }
}

async function reloadAgents() {
  if (!sessionId.value) return;

  agentsError.value = null;

  try {
    sessionAgents.value = await invokeCommand('reloadAgents', {
      sessionId: sessionId.value,
    });
    toasts.success('Agents reloaded', `${sessionAgents.value.length} available`);
  } catch (err) {
    agentsError.value = toErrorMessage(err);
    toasts.error('Failed to reload agents', toErrorMessage(err));
  }
}

async function selectAgent(name: string) {
  if (!sessionId.value || agentBusyName.value) return;

  agentBusyName.value = name;

  try {
    await invokeCommand('selectAgent', {
      sessionId: sessionId.value,
      name,
    });
    // currentAgent updates via the subagent.selected event handler in
    // sessionsStore.applySessionEvent — no manual store mutation here.
  } catch (err) {
    toasts.error('Failed to select agent', toErrorMessage(err));
  } finally {
    agentBusyName.value = null;
  }
}

async function deselectAgent() {
  if (!sessionId.value || agentBusyName.value) return;

  agentBusyName.value = '__deselect__';

  try {
    await invokeCommand('deselectAgent', { sessionId: sessionId.value });
  } catch (err) {
    toasts.error('Failed to deselect agent', toErrorMessage(err));
  } finally {
    agentBusyName.value = null;
  }
}

/// Derive "Project" vs "User" source from the agent's absolute path.
/// Returns `null` when the agent has no path (remote/inline — none in
/// our case but defensive).
function agentSourceLabel(agent: AgentInfo): 'Project' | 'User' | null {
  if (!agent.path) return null;

  const wd = record.value?.workingDirectory;

  if (!wd) return 'User';

  // Case-insensitive on Windows; the path may use forward or back
  // slashes. Normalize both.
  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
  const projectPrefix = `${norm(wd)}/.github/agents/`;

  return norm(agent.path).startsWith(projectPrefix) ? 'Project' : 'User';
}

// ---------- Tasks (19b.1) ----------
//
// Observational view of agent-delegated tasks for the active session.
// The agent itself calls into the SDK's built-in `task` tool to spawn
// background work; we just surface what's there. Cancel + Remove are
// user actions.
//
// Refresh triggers:
//   - rail mount + session switch
//   - record.tasksRefreshCounter ticks (driven by subagent.* +
//     session.background_tasks_changed in sessionsStore.applySessionEvent)
//   - after a successful cancel/remove RPC
//
// Sequence guard: increment a request token on each fetch; only the
// response matching the most-recent token gets to write `sessionTasks`,
// so a stale slow response can't overwrite a fresh fast one.
const sessionTasks = ref<TaskInfo[]>([]);
const tasksLoaded = ref(false);
const tasksError = ref<string | null>(null);
const taskBusyId = ref<string | null>(null);
let tasksRequestToken = 0;

async function loadTasks() {
  if (!sessionId.value) return;

  tasksError.value = null;
  const token = ++tasksRequestToken;

  try {
    const tasks = await invokeCommand('listTasks', {
      sessionId: sessionId.value,
    });

    if (token !== tasksRequestToken) return;

    sessionTasks.value = tasks;
    tasksLoaded.value = true;
  } catch (err) {
    if (token !== tasksRequestToken) return;

    tasksError.value = toErrorMessage(err);
    tasksLoaded.value = true;
  }
}

async function cancelTask(task: TaskInfo) {
  if (!sessionId.value || taskBusyId.value) return;

  taskBusyId.value = task.id;

  try {
    await invokeCommand('cancelTask', {
      sessionId: sessionId.value,
      id: task.id,
    });
    toasts.info('Task cancelled', `Cancelled "${task.description || task.id}".`);
  } catch (err) {
    toasts.error('Failed to cancel task', toErrorMessage(err));
  } finally {
    taskBusyId.value = null;
    void loadTasks();
  }
}

async function removeTask(task: TaskInfo) {
  if (!sessionId.value || taskBusyId.value) return;

  taskBusyId.value = task.id;

  try {
    await invokeCommand('removeTask', {
      sessionId: sessionId.value,
      id: task.id,
    });
  } catch (err) {
    toasts.error('Failed to remove task', toErrorMessage(err));
  } finally {
    taskBusyId.value = null;
    void loadTasks();
  }
}

/// Format `activeTimeMs` (or fall back to `startedAt`→now) as a
/// terse human-readable duration. Tasks rarely live longer than
/// a few minutes; the precision drops off above an hour.
function formatTaskElapsed(task: TaskInfo): string {
  let ms: number | null = null;

  if (typeof task.activeTimeMs === 'number') {
    ms = task.activeTimeMs;
  } else if (task.startedAt) {
    const start = Date.parse(task.startedAt);
    const end = task.completedAt ? Date.parse(task.completedAt) : Date.now();

    if (Number.isFinite(start) && Number.isFinite(end)) ms = end - start;
  }

  if (ms === null) return '';

  if (ms < 1000) return `${ms}ms`;

  const s = Math.round(ms / 1000);

  if (s < 60) return `${s}s`;

  const m = Math.floor(s / 60);
  const rem = s % 60;

  if (m < 60) return `${m}m ${rem}s`;

  const h = Math.floor(m / 60);

  return `${h}h ${m % 60}m`;
}

function taskTitle(task: TaskInfo): string {
  return task.type === 'agent'
    ? task.agentDisplayName || task.agentName || task.agentType
    : task.command || task.description || 'Shell task';
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
    sessionSkills.value = await invokeCommand('listSessionSkills', {
      sessionId: sessionId.value,
    });
    skillsLoaded.value = true;
  } catch (err) {
    skillsError.value = toErrorMessage(err);
    skillsLoaded.value = true;
  }
}

async function toggleSkill(skill: SessionSkill) {
  const next = !skill.enabled;

  skill.enabled = next;

  try {
    await invokeCommand('setSessionSkillEnabled', {
      sessionId: sessionId.value,
      name: skill.name,
      enabled: next,
    });
  } catch {
    skill.enabled = !next;
  }
}

/// Opens the Library activity-bar panel and switches it to the
/// Skills tab. localStorage write is what LibraryPanel.vue reads on
/// mount; the custom event tells it to re-read if it's already
/// mounted (otherwise switching tabs would only take effect on the
/// next reload).
function openSkillsLibrary() {
  try {
    localStorage.setItem('dafman.library.activeTab', 'skills');
  } catch {
    /* private mode — ignore */
  }

  window.dispatchEvent(
    new CustomEvent('dafman:library-activate-tab', { detail: { tab: 'skills' } }),
  );
  layoutStore.openEdgePanel('left', {
    id: 'library',
    component: 'library',
    tabComponent: 'sidebarTab',
    title: 'Library — MCP servers + Tools + Skills + Agents + Instructions',
    initialSize: 360,
    minimumSize: 320,
    exclusive: true,
  });
}

function openJobsPanel() {
  layoutStore.openEdgePanel('left', {
    id: 'jobs-panel',
    component: 'jobsPanel',
    tabComponent: 'sidebarTab',
    title: 'Jobs',
    initialSize: 380,
    minimumSize: 380,
    exclusive: true,
  });
}

// ---------- Usage metrics ----------
const usage = ref<{
  totalUserRequests: number;
  totalPremiumRequestCost: number;
  totalApiDurationMs: number;
  lastCallInputTokens: number;
  lastCallOutputTokens: number;
  currentTokens: number;
  tokenLimit: number;
} | null>(null);
const usageError = ref<string | null>(null);

async function loadUsage() {
  if (!sessionId.value) return;

  usageError.value = null;

  try {
    const raw = await invokeCommand('getSessionUsageMetrics', {
      sessionId: sessionId.value,
    });
    const fromRpc = {
      totalUserRequests: typeof raw.totalUserRequests === 'number' ? raw.totalUserRequests : 0,
      totalPremiumRequestCost:
        typeof raw.totalPremiumRequestCost === 'number' ? raw.totalPremiumRequestCost : 0,
      totalApiDurationMs: typeof raw.totalApiDurationMs === 'number' ? raw.totalApiDurationMs : 0,
      lastCallInputTokens:
        typeof raw.lastCallInputTokens === 'number' ? raw.lastCallInputTokens : 0,
      lastCallOutputTokens:
        typeof raw.lastCallOutputTokens === 'number' ? raw.lastCallOutputTokens : 0,
      currentTokens:
        typeof raw.currentTokens === 'number'
          ? raw.currentTokens
          : typeof raw.inputTokens === 'number'
            ? raw.inputTokens
            : 0,
      tokenLimit:
        typeof raw.tokenLimit === 'number'
          ? (normalizeContextLimit(raw.tokenLimit) ?? 0)
          : typeof raw.maxTokens === 'number'
            ? (normalizeContextLimit(raw.maxTokens) ?? 0)
            : 0,
    };
    const fromEvents = deriveUsageFromEvents(record.value?.events ?? []);

    usage.value =
      fromRpc.totalUserRequests > 0 || fromRpc.lastCallInputTokens > 0 || fromRpc.tokenLimit > 0
        ? fromRpc
        : fromEvents;
  } catch (err) {
    const fromEvents = deriveUsageFromEvents(record.value?.events ?? []);

    if (fromEvents.totalUserRequests > 0 || fromEvents.tokenLimit > 0) {
      usage.value = fromEvents;

      return;
    }

    usageError.value = toErrorMessage(err);
  }
}

function deriveUsageFromEvents(
  events: Array<{ eventType: string; data: Record<string, unknown> }>,
) {
  let totalUserRequests = 0;
  let totalPremiumRequestCost = 0;
  let totalApiDurationMs = 0;
  let lastCallInputTokens = 0;
  let lastCallOutputTokens = 0;
  let currentTokens = 0;
  let tokenLimit = 0;

  for (const event of events) {
    const data = event.data;

    if (event.eventType === 'assistant.usage') {
      totalUserRequests += 1;
      const cost = data.cost;

      if (typeof cost === 'number') totalPremiumRequestCost += cost;

      const duration = data.duration;

      if (typeof duration === 'number') totalApiDurationMs += duration;

      const input = data.inputTokens;

      if (typeof input === 'number') {
        lastCallInputTokens = input;
        currentTokens = input;
      }

      const output = data.outputTokens;

      if (typeof output === 'number') lastCallOutputTokens = output;
    } else if (event.eventType === 'session.usage_info') {
      const current = data.currentTokens;

      if (typeof current === 'number') currentTokens = current;

      const limit = data.tokenLimit;

      if (typeof limit === 'number') tokenLimit = normalizeContextLimit(limit) ?? 0;
    }
  }

  return {
    totalUserRequests,
    totalPremiumRequestCost,
    totalApiDurationMs,
    lastCallInputTokens,
    lastCallOutputTokens,
    currentTokens,
    tokenLimit,
  };
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
//
// U1: split into per-session vs global loaders. `builtinTools` is the
// SDK's static built-in tool list (never changes); `quota` is the
// user's account-wide quota (poll-refresh, not session-scoped). Both
// load ONCE on mount and shouldn't re-fire on every session tab
// switch. The per-session fetches (`skills`, `usage`, `mcp`, `plan`)
// still re-fetch.
onMounted(() => {
  void loadBuiltinTools();
  void loadQuota();
  void loadAgents();
  void loadTasks();
  void loadSkills();
  void loadUsage();
  void loadMcpServers();
  void loadPlan();
});
watch(
  () => sessionId.value,
  () => {
    void nextTick(() => layoutStore.restoreSessionDetailsWidth());
    sessionAgents.value = [];
    agentsLoaded.value = false;
    agentsError.value = null;
    agentBusyName.value = null;
    sessionTasks.value = [];
    tasksLoaded.value = false;
    tasksError.value = null;
    taskBusyId.value = null;
    sessionSkills.value = [];
    skillsLoaded.value = false;
    skillsError.value = null;
    usage.value = null;
    usageError.value = null;
    mcpServers.value = [];
    planExists.value = false;
    planContent.value = '';
    planEditing.value = false;
    planError.value = null;
    planLoaded.value = false;
    // U2: don't reset `warnedThresholds` on session switch — the
    // quota is account-wide, so a 90%-used warning that already
    // fired shouldn't re-fire just because the user clicked a
    // different session tab. The Set persists for the whole
    // component lifetime (i.e. as long as the rail is mounted).
    void loadAgents();
    void loadTasks();
    void loadSkills();
    void loadUsage();
    void loadMcpServers();
    void loadPlan();
  },
);

// 19b.1: refetch the Tasks section whenever the store's per-record
// counter ticks (driven by subagent.* + session.background_tasks_changed
// events). Counter pattern avoids the "two events in a row" miss a
// boolean flag would suffer from.
watch(
  () => record.value?.tasksRefreshCounter ?? 0,
  () => {
    void loadTasks();
  },
);
watch(
  () => record.value?.planRefreshCounter ?? 0,
  () => {
    void loadPlan();
  },
);

// ---------- Actions ----------
async function onExport(format: 'markdown' | 'json'): Promise<void> {
  const rec = record.value;

  if (!rec) return;

  try {
    const { processEvents, defaultAmbient } = await import('../../lib/chatEvents');
    const { formatConversation, exportFilenameStem } = await import('../../lib/exportConversation');
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
    const saved = await invokeCommand('saveExportFile', { fileName, contents });

    toasts.success(
      `Conversation exported (${format === 'markdown' ? 'MD' : 'JSON'})`,
      `${(saved.bytes / 1024).toFixed(1)} KiB`,
    );

    try {
      await invokeCommand('revealPath', { path: saved.path });
    } catch {
      /* best-effort */
    }
  } catch (err) {
    toasts.error('Export failed', toErrorMessage(err));
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
    toasts.success('Session forked', `New session: ${newId.slice(0, 8)}`);
  } catch (err) {
    toasts.error('Fork failed', toErrorMessage(err));
  }
}

// ---------- Tools (18b) ----------
//
// Built-in tools (global, never changes) + MCP servers (per-session
// status). Split into two loaders so a session-tab switch only re-
// fetches the per-session MCP list, not the static built-in list.
// Toggles edit the global `settings.tools.defaultExcluded` list (the
// SDK does not support runtime mutation, so changes only take effect
// for newly-created sessions — we surface a "Restart session to apply"
// toast).
type ToolItem = { name: string; description: string; namespacedName?: string };
type McpItem = { name: string; status: string; error?: string };
const builtinTools = ref<ToolItem[]>([]);
const mcpServers = ref<McpItem[]>([]);
const toolsLoaded = ref(false);
const toolsError = ref<string | null>(null);
const settingsStore = useSettingsStore();

async function loadBuiltinTools() {
  toolsError.value = null;

  try {
    const tools = await invokeCommand('listBuiltinTools', {});

    builtinTools.value = tools.map((t) => ({
      name: t.name,
      description: t.description,
      ...(t.namespacedName ? { namespacedName: t.namespacedName } : {}),
    }));
    toolsLoaded.value = true;
  } catch (err) {
    toolsError.value = toErrorMessage(err);
    toolsLoaded.value = true;
  }
}

async function loadMcpServers() {
  if (!sessionId.value) return;

  try {
    const servers = await invokeCommand('listSessionMcpServers', {
      sessionId: sessionId.value,
    });

    mcpServers.value = servers.map((s) => ({
      name: s.name,
      status: s.status,
      ...(s.error ? { error: s.error } : {}),
    }));
  } catch (err) {
    toolsError.value = toErrorMessage(err);
  }
}

async function setMcpServerEnabled(server: McpItem, enabled: boolean) {
  if (!sessionId.value) return;

  // Optimistic local flip so the toggle responds immediately;
  // reload to pick up the SDK-side status change.
  server.status = enabled ? 'connected' : 'disabled';

  try {
    await invokeCommand('setSessionMcpEnabled', {
      sessionId: sessionId.value,
      serverName: server.name,
      enabled,
    });
    // Re-fetch to surface the real status (might be "connecting"
    // or an error). Only re-fetch the per-session MCP list, not
    // the static built-in tools.
    await loadMcpServers();
  } catch (err) {
    toasts.error('Failed to toggle MCP server', toErrorMessage(err));
    server.status = enabled ? 'disabled' : 'connected';
  }
}

function mcpEnabled(s: McpItem): boolean {
  // SDK's McpServerStatus uses "disabled" specifically for the
  // user-toggled-off state; anything else (connected, pending,
  // disconnected, error) counts as enabled.
  return s.status !== 'disabled';
}

/// 22b: canonical tool key. SDK filters use `namespacedName` when
/// present (e.g. `playwright/navigate`); fall back to `name` for
/// built-in tools. ALL persistence and SDK config uses this key.
function toolKey(t: ToolItem): string {
  return t.namespacedName ?? t.name;
}

/// 22b: tri-state per tool. "default" = neither list mentions it.
/// "forbidden" = in `defaultExcluded`. "only-allow" = in
/// `defaultAllowed`. Mutually exclusive — setting one removes the
/// other so the persisted state stays clean.
type ToolState = 'default' | 'forbidden' | 'only-allow';

function toolState(t: ToolItem): ToolState {
  const key = toolKey(t);

  if (settings.value.tools?.defaultExcluded?.includes(key)) return 'forbidden';

  if (settings.value.tools?.defaultAllowed?.includes(key)) return 'only-allow';

  return 'default';
}

async function setToolState(t: ToolItem, next: ToolState) {
  const key = toolKey(t);
  const excluded = (settings.value.tools?.defaultExcluded ?? []).filter((n) => n !== key);
  const allowed = (settings.value.tools?.defaultAllowed ?? []).filter((n) => n !== key);

  if (next === 'forbidden') excluded.push(key);

  if (next === 'only-allow') allowed.push(key);

  await settingsStore.update({
    ...settings.value,
    tools: { defaultExcluded: excluded, defaultAllowed: allowed },
  });
  toasts.info(
    'Tool change recorded',
    'Restart or recreate the session to apply (SDK does not support runtime tool mutation).',
  );
}

/// 22b: critical built-in tools — disabling these makes the agent
/// effectively unusable. Surface a warning badge, don't block.
const CRITICAL_TOOLS: ReadonlySet<string> = new Set([
  'bash',
  'shell',
  'str_replace_editor',
  'write_file',
  'create_file',
  'edit_file',
]);

function isCriticalTool(t: ToolItem): boolean {
  return CRITICAL_TOOLS.has(t.name);
}

/// 22b: group tools by namespace. Returns `[ ['Built-in', [...]],
/// ['playwright', [...]], ... ]`. Built-in (no `namespacedName`) is
/// always first, then namespaced groups sorted alphabetically.
type ToolGroup = { label: string; items: ToolItem[]; isBuiltin: boolean };
const toolGroups = computed<ToolGroup[]>(() => {
  const byPrefix = new Map<string, ToolItem[]>();
  const builtins: ToolItem[] = [];

  for (const t of builtinTools.value) {
    if (!t.namespacedName) {
      builtins.push(t);
      continue;
    }

    const prefix = t.namespacedName.split('/')[0] || 'namespaced';
    const list = byPrefix.get(prefix) ?? [];

    list.push(t);
    byPrefix.set(prefix, list);
  }

  const groups: ToolGroup[] = [];

  if (builtins.length > 0) groups.push({ label: 'Built-in', items: builtins, isBuiltin: true });

  for (const prefix of Array.from(byPrefix.keys()).sort()) {
    groups.push({
      label: prefix,
      items: byPrefix.get(prefix) ?? [],
      isBuiltin: false,
    });
  }

  return groups;
});

const allowlistActive = computed(() => (settings.value.tools?.defaultAllowed ?? []).length > 0);

/// 22b: tri-state SelectButton options. Order matches the visual
/// left→right of the segmented control.
const toolStateOptions: { label: string; value: ToolState }[] = [
  { label: 'Default', value: 'default' },
  { label: 'Only allow', value: 'only-allow' },
  { label: 'Forbid', value: 'forbidden' },
];

// ---------- Plan (18b) ----------
const planExists = ref(false);
const planContent = ref<string>('');
const planEditing = ref(false);
const planDraft = ref<string>('');
const planError = ref<string | null>(null);
const planLoaded = ref(false);

async function loadPlan() {
  if (!sessionId.value) return;

  planError.value = null;

  try {
    const result = await invokeCommand('readSessionPlan', {
      sessionId: sessionId.value,
    });

    planExists.value = result.exists;
    planContent.value = result.content ?? '';
    planLoaded.value = true;
  } catch (err) {
    planError.value = toErrorMessage(err);
    planLoaded.value = true;
  }
}

function startEditPlan() {
  planDraft.value = planContent.value;
  planEditing.value = true;
}

async function savePlan() {
  try {
    await invokeCommand('writeSessionPlan', {
      sessionId: sessionId.value,
      content: planDraft.value,
    });
    planContent.value = planDraft.value;
    planExists.value = true;
    planEditing.value = false;
    toasts.success('Plan saved');
  } catch (err) {
    toasts.error('Plan save failed', toErrorMessage(err));
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
    const raw = await invokeCommand('getAccountQuota', {});
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
          const severity = threshold === 90 ? 'warn' : 'info';

          toasts[severity](
            `Quota at ${usedPct.toFixed(0)}%`,
            `${snap.type}: ${snap.usedRequests}/${snap.entitlementRequests} used`,
          );
          break;
        }
      }
    }
  } catch (err) {
    quotaError.value = toErrorMessage(err);
  }
}

// ---------- Collapsible sections (persisted via localStorage) ----------
//
// Each section's open/closed state lives in localStorage under a stable
// key. Defaults: tools collapsed (long); skills + mcp + plan + usage +
// quota expanded. Toggling persists immediately.
type SectionKey =
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
</script>

<template>
  <div
    v-if="record"
    class="session-details"
  >
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

    <section class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.settings"
        @click="toggleSection('settings')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.settings ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Session settings</span>
        <span class="section-count">collapsed</span>
      </button>
      <div
        v-if="sectionOpen.settings"
        class="section-body"
      >
        <section class="row row-stack">
          <label
            class="row-label"
            :for="`details-name-${sessionId}`"
          >
            Session name
          </label>
          <form
            class="rename-form"
            @submit.prevent="onRenameSubmit"
          >
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

        <section
          class="row details-mode-row"
          :class="modeClass"
        >
          <span class="row-label">Run mode</span>
          <SelectButton
            v-model="modeChoice"
            :options="MODE_OPTIONS"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            size="small"
            aria-label="Agent run mode"
          >
            <template #option="slotProps">
              <i
                :class="slotProps.option.icon"
                :title="slotProps.option.label"
              />
              <span class="sr-only">{{ slotProps.option.label }}</span>
            </template>
          </SelectButton>
        </section>

        <label
          class="row"
          :for="`details-reasoning-${sessionId}`"
        >
          <span class="row-label">Reasoning view</span>
          <Select
            v-model="reasoningChoice"
            :input-id="`details-reasoning-${sessionId}`"
            :options="reasoningOptions"
            option-label="label"
            option-value="value"
            size="small"
            aria-label="Reasoning visibility for this session"
          />
        </label>

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
            <i
              class="pi pi-folder"
              aria-hidden="true"
            />
            <span class="workspace-path-text">{{ record.workingDirectory }}</span>
            <i
              class="pi pi-external-link workspace-path-hint"
              aria-hidden="true"
            />
          </button>
          <div
            v-else
            class="workspace-path"
            title="Default (cli process cwd)"
          >
            <i
              class="pi pi-folder"
              aria-hidden="true"
            />
            <span class="workspace-path-text">Default</span>
          </div>
        </section>

        <section
          class="row row-toggle"
          :class="{ 'approve-all-on': approveAll }"
        >
          <span
            class="row-toggle-title"
            title="Skip permission prompts for the rest of this session."
          >
            Auto-approve all tools
          </span>
          <ToggleSwitch
            :model-value="approveAll"
            @update:model-value="onToggleApproveAll"
          />
        </section>
      </div>
    </section>

    <!-- Agents (19a) ---------------------------------------------- -->
    <section class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.agents"
        @click="toggleSection('agents')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.agents ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Agents</span>
        <span
          v-if="agentsLoaded && !agentsError"
          class="section-count"
        >
          {{ sessionAgents.length }}
        </span>
      </button>
      <div
        v-if="sectionOpen.agents"
        class="section-body"
      >
        <div
          v-if="!agentsLoaded"
          class="empty-hint"
        >
          Loading…
        </div>
        <div
          v-else-if="agentsError"
          class="empty-hint error"
        >
          {{ agentsError }}
        </div>
        <div
          v-else-if="sessionAgents.length === 0"
          class="empty-hint"
        >
          No custom agents. Add markdown files under
          <code>.github/agents/</code> in your workspace or in
          <code>&lt;userConfigDir&gt;/agents/</code>, then click Reload.
        </div>
        <ul
          v-else
          class="agent-list compact-list"
        >
          <li
            v-for="agent in sessionAgents"
            :key="agent.name"
            class="compact-row agent-row"
            :class="{
              'is-current': record.currentAgent?.name === agent.name,
            }"
          >
            <button
              type="button"
              class="compact-name-button"
              :title="agent.description || agent.displayName"
              :aria-expanded="!!agent.description && isItemExpanded('agent', agent.name)"
              @click="agent.description && toggleItemExpansion('agent', agent.name)"
            >
              <i
                v-if="agent.description"
                class="pi compact-chevron"
                :class="
                  isItemExpanded('agent', agent.name) ? 'pi-chevron-down' : 'pi-chevron-right'
                "
                aria-hidden="true"
              />
              <span class="compact-name">{{ agent.displayName }}</span>
              <small
                v-if="agentSourceLabel(agent)"
                class="compact-tag agent-source"
                :title="agent.path ?? ''"
              >
                {{ agentSourceLabel(agent) }}
              </small>
            </button>
            <Button
              v-if="record.currentAgent?.name === agent.name"
              size="small"
              severity="secondary"
              :loading="agentBusyName === '__deselect__'"
              :disabled="!!agentBusyName"
              label="Deselect"
              :aria-label="`Deselect agent ${agent.displayName}`"
              @click="deselectAgent"
            />
            <Button
              v-else
              size="small"
              :loading="agentBusyName === agent.name"
              :disabled="!!agentBusyName"
              label="Select"
              :aria-label="`Select agent ${agent.displayName}`"
              @click="selectAgent(agent.name)"
            />
            <Button
              v-if="agent.path"
              icon="pi pi-file-edit"
              size="small"
              severity="secondary"
              text
              :title="`Open ${agent.path}`"
              :aria-label="`Open agent file ${agent.displayName}`"
              @click="invokeCommand('revealPath', { path: agent.path! })"
            />
            <div
              v-if="agent.description && isItemExpanded('agent', agent.name)"
              class="compact-desc"
            >
              <MessageContent
                :text="agent.description"
                label="Agent description"
              />
            </div>
          </li>
        </ul>
        <button
          type="button"
          class="link-button manage-globally"
          :disabled="!sessionId"
          @click="reloadAgents"
        >
          Reload from disk →
        </button>
      </div>
    </section>

    <!-- Tasks (19b.1) --------------------------------------------- -->
    <section class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.tasks"
        @click="toggleSection('tasks')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.tasks ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Background tasks</span>
        <span
          v-if="tasksLoaded && !tasksError"
          class="section-count"
        >
          {{ sessionTasks.length }}
        </span>
      </button>
      <div
        v-if="sectionOpen.tasks"
        class="section-body"
      >
        <div
          v-if="!tasksLoaded"
          class="empty-hint"
        >
          Loading…
        </div>
        <div
          v-else-if="tasksError"
          class="empty-hint error"
        >
          {{ tasksError }}
        </div>
        <div
          v-else-if="sessionTasks.length === 0"
          class="empty-hint"
        >
          No background tasks. The agent will spawn one here when it delegates work via the
          <code>task</code> tool.
        </div>
        <ul
          v-else
          class="task-list compact-list"
        >
          <li
            v-for="task in sessionTasks"
            :key="task.id"
            class="compact-row task-row"
            :class="`task-status-${task.status}`"
          >
            <div class="task-line">
              <span
                class="task-status-pill"
                :title="task.status"
              >
                {{ task.status }}
              </span>
              <span
                class="task-name"
                :title="task.description || task.id"
              >
                {{ taskTitle(task) }}
              </span>
              <span
                v-if="formatTaskElapsed(task)"
                class="task-elapsed"
              >
                {{ formatTaskElapsed(task) }}
              </span>
            </div>
            <div
              v-if="task.description"
              class="task-desc"
            >
              {{ task.description }}
            </div>
            <div
              v-if="task.error"
              class="task-error"
            >
              {{ task.error }}
            </div>
            <div class="task-actions">
              <Button
                v-if="task.status === 'running' || task.status === 'idle'"
                size="small"
                severity="secondary"
                :loading="taskBusyId === task.id"
                :disabled="!!taskBusyId"
                label="Cancel"
                :aria-label="`Cancel task ${task.id}`"
                @click="cancelTask(task)"
              />
              <Button
                v-else
                size="small"
                severity="secondary"
                text
                :loading="taskBusyId === task.id"
                :disabled="!!taskBusyId"
                label="Remove"
                :aria-label="`Remove task ${task.id}`"
                @click="removeTask(task)"
              />
            </div>
          </li>
        </ul>
        <button
          type="button"
          class="link-button manage-globally"
          @click="openJobsPanel"
        >
          Open global Jobs →
        </button>
      </div>
    </section>

    <!-- Files ------------------------------------------------------ -->
    <section class="row row-stack section">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen.files"
        @click="toggleSection('files')"
      >
        <i
          class="pi section-chevron"
          :class="sectionOpen.files ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        <span class="row-label">Files touched</span>
        <span class="section-count">{{ record.touchedFiles.length }}</span>
      </button>
      <div
        v-if="sectionOpen.files"
        class="section-body"
      >
        <div
          v-if="record.touchedFiles.length === 0"
          class="empty-hint"
        >
          No file writes or edits seen in this session.
        </div>
        <ul
          v-else
          class="file-list compact-list"
        >
          <li
            v-for="path in record.touchedFiles"
            :key="path"
            class="compact-row file-row"
          >
            <button
              type="button"
              class="file-path"
              :title="`Open ${path}`"
              @click="revealFile(path)"
            >
              <i
                class="pi pi-file"
                aria-hidden="true"
              />
              <span>{{ path }}</span>
            </button>
          </li>
        </ul>
      </div>
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
        <span
          v-if="skillsLoaded && !skillsError"
          class="section-count"
        >
          {{ sessionSkills.length }}
        </span>
      </button>
      <div
        v-if="sectionOpen.skills"
        class="section-body"
      >
        <div
          v-if="!skillsLoaded"
          class="empty-hint"
        >
          Loading…
        </div>
        <div
          v-else-if="skillsError"
          class="empty-hint error"
        >
          {{ skillsError }}
        </div>
        <div
          v-else-if="sessionSkills.length === 0"
          class="empty-hint"
        >
          No skills configured for this session.
        </div>
        <ul
          v-else
          class="skill-list compact-list"
        >
          <li
            v-for="skill in sessionSkills"
            :key="skill.name"
            class="compact-row"
          >
            <button
              type="button"
              class="compact-name-button"
              :title="skill.description || skill.name"
              :aria-expanded="!!skill.description && isItemExpanded('skill', skill.name)"
              @click="skill.description && toggleItemExpansion('skill', skill.name)"
            >
              <i
                v-if="skill.description"
                class="pi compact-chevron"
                :class="
                  isItemExpanded('skill', skill.name) ? 'pi-chevron-down' : 'pi-chevron-right'
                "
                aria-hidden="true"
              />
              <span class="compact-name">{{ skill.name }}</span>
              <small
                v-if="skill.userInvocable"
                class="compact-tag"
                >/</small
              >
            </button>
            <ToggleSwitch
              :model-value="skill.enabled"
              :aria-label="`Enable skill ${skill.name}`"
              @update:model-value="() => toggleSkill(skill)"
            />
            <div
              v-if="skill.description && isItemExpanded('skill', skill.name)"
              class="compact-desc"
            >
              <MessageContent
                :text="skill.description"
                label="Skill description"
              />
            </div>
          </li>
        </ul>
        <button
          type="button"
          class="link-button manage-globally"
          @click="openSkillsLibrary"
        >
          Manage globally →
        </button>
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
        <span
          v-if="toolsLoaded && !toolsError"
          class="section-count"
        >
          {{ builtinTools.length }}
        </span>
      </button>
      <div
        v-if="sectionOpen.tools"
        class="section-body"
      >
        <div
          v-if="!toolsLoaded"
          class="empty-hint"
        >
          Loading…
        </div>
        <div
          v-else-if="toolsError"
          class="empty-hint error"
        >
          {{ toolsError }}
        </div>
        <template v-else>
          <div class="row-hint">
            Per-tool restriction applies to NEW sessions only. Restart or recreate the session to
            apply changes here.
          </div>
          <div
            v-if="allowlistActive"
            class="row-hint allowlist-banner"
            role="status"
          >
            <i
              class="pi pi-info-circle"
              aria-hidden="true"
            />
            Allowlist active — sessions are restricted to the tools marked "Only allow". The exclude
            list is ignored when allowlist is non-empty.
          </div>
          <template
            v-for="group in toolGroups"
            :key="`group-${group.label}`"
          >
            <div class="tool-group-header">
              <span>{{ group.label }}</span>
              <span class="section-count">{{ group.items.length }}</span>
            </div>
            <ul class="tool-list compact-list">
              <li
                v-for="t in group.items"
                :key="`tool-${toolKey(t)}`"
                class="compact-row tool-row"
              >
                <button
                  type="button"
                  class="compact-name-button"
                  :title="t.description || t.name"
                  :aria-expanded="!!t.description && isItemExpanded('tool', toolKey(t))"
                  @click="t.description && toggleItemExpansion('tool', toolKey(t))"
                >
                  <i
                    v-if="t.description"
                    class="pi compact-chevron"
                    :class="
                      isItemExpanded('tool', toolKey(t)) ? 'pi-chevron-down' : 'pi-chevron-right'
                    "
                    aria-hidden="true"
                  />
                  <span class="compact-name">{{ t.name }}</span>
                  <span
                    v-if="isCriticalTool(t) && toolState(t) === 'forbidden'"
                    class="critical-warning"
                    title="Disabling this tool makes the agent unable to perform core actions."
                  >
                    <i
                      class="pi pi-exclamation-triangle"
                      aria-hidden="true"
                    />
                  </span>
                </button>
                <SelectButton
                  :model-value="toolState(t)"
                  :options="toolStateOptions"
                  option-label="label"
                  option-value="value"
                  :allow-empty="false"
                  size="small"
                  class="tool-state-button"
                  :aria-label="`Restriction for ${t.name}`"
                  @update:model-value="(v: ToolState) => setToolState(t, v)"
                />
                <div
                  v-if="t.description && isItemExpanded('tool', toolKey(t))"
                  class="compact-desc"
                >
                  <MessageContent
                    :text="t.description"
                    label="Tool description"
                  />
                </div>
              </li>
            </ul>
          </template>
        </template>
      </div>
    </section>

    <!-- MCP servers (18b) ----------------------------------------- -->
    <section
      v-if="toolsLoaded && mcpServers.length > 0"
      class="row row-stack section"
    >
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
      <div
        v-if="sectionOpen.mcp"
        class="section-body"
      >
        <ul class="tool-list compact-list">
          <li
            v-for="s in mcpServers"
            :key="`mcp-${s.name}`"
            class="compact-row"
          >
            <div
              class="compact-name-button compact-name-static"
              :title="s.error || s.name"
            >
              <span class="compact-name">{{ s.name }}</span>
              <small class="compact-tag">{{ s.status }}</small>
            </div>
            <ToggleSwitch
              :model-value="mcpEnabled(s)"
              :aria-label="`Enable MCP server ${s.name}`"
              @update:model-value="(v: boolean) => setMcpServerEnabled(s, v)"
            />
            <div
              v-if="s.error"
              class="compact-desc compact-desc-error"
            >
              {{ s.error }}
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
      <div
        v-if="sectionOpen.plan"
        class="section-body"
      >
        <div
          v-if="!planLoaded"
          class="empty-hint"
        >
          Loading…
        </div>
        <div
          v-else-if="planError"
          class="empty-hint error"
        >
          {{ planError }}
        </div>
        <template v-else>
          <template v-if="planEditing">
            <textarea
              v-model="planDraft"
              rows="8"
              class="plan-editor"
              aria-label="Plan content (markdown)"
            ></textarea>
            <div class="plan-actions">
              <Button
                label="Save"
                size="small"
                @click="savePlan"
              />
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
            <div
              v-if="planExists && planContent"
              class="plan-preview"
            >
              <MessageContent
                :text="planContent"
                label="Plan markdown"
              />
            </div>
            <div
              v-else
              class="empty-hint"
            >
              No plan yet.
            </div>
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
    <section
      v-if="usage || usageError"
      class="row row-stack section"
    >
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
      <div
        v-if="sectionOpen.usage"
        class="section-body"
      >
        <div
          v-if="usageError"
          class="empty-hint error"
        >
          {{ usageError }}
        </div>
        <dl
          v-else-if="usage"
          class="usage"
        >
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
          <div
            v-if="usage.tokenLimit > 0"
            class="usage-row"
          >
            <dt>Context tokens</dt>
            <dd>
              {{ usage.currentTokens.toLocaleString() }} /
              {{ usage.tokenLimit.toLocaleString() }}
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- Quota (18b) ---------------------------------------------- -->
    <section
      v-if="quota.length > 0 || quotaError"
      class="row row-stack section"
    >
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
      <div
        v-if="sectionOpen.quota"
        class="section-body"
      >
        <div
          v-if="quotaError"
          class="empty-hint error"
        >
          {{ quotaError }}
        </div>
        <ul
          v-else
          class="quota-list"
        >
          <li
            v-for="q in quota"
            :key="q.type"
            class="quota-row"
          >
            <div class="quota-name">
              {{ q.type }}
              <small
                v-if="q.isUnlimitedEntitlement"
                class="quota-tag"
              >
                unlimited
              </small>
            </div>
            <template v-if="!q.isUnlimitedEntitlement">
              <div
                class="quota-bar"
                :class="{
                  warn: 100 - q.remainingPercentage >= 75,
                  danger: 100 - q.remainingPercentage >= 90,
                }"
              >
                <div
                  class="quota-fill"
                  :style="{ width: `${100 - q.remainingPercentage}%` }"
                />
              </div>
              <div class="quota-meta">
                {{ q.usedRequests }} / {{ q.entitlementRequests }}
                <span
                  v-if="q.resetDate"
                  class="quota-reset"
                >
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
        label="Markdown"
        size="small"
        severity="secondary"
        title="Export conversation as Markdown"
        @click="onExport('markdown')"
      />
      <Button
        icon="pi pi-file-export"
        label="JSON"
        size="small"
        severity="secondary"
        title="Export conversation as JSON"
        @click="onExport('json')"
      />
      <Button
        icon="pi pi-compress"
        label="Compact"
        size="small"
        severity="secondary"
        title="Compact session history"
        @click="onCompactNow"
      />
      <Button
        icon="pi pi-refresh"
        label="Reset"
        size="small"
        severity="secondary"
        title="Reset session approvals"
        @click="onResetApprovals"
      />
    </section>
  </div>
  <div
    v-else-if="!sessionId"
    class="session-details session-details-empty"
  >
    <p class="empty-hint">No active session.</p>
  </div>
  <div
    v-else
    class="session-details session-details-empty"
  >
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
  overflow-x: hidden;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  color: var(--p-text-color);
  /* min-width: 0 lets flex children shrink past their intrinsic
     content size. Without it, long unbreakable strings (paths,
     tool names) would force the panel wider than its dockview
     container — exactly the "sidebar is cut off, needs crazy
     width" symptom. */
  min-width: 0;
}

/* Force every direct flex / grid child to honour the parent's
   width — otherwise an oversized SelectButton row or Action grid
   pushes the whole rail out. */
.session-details > * {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

/* PrimeVue SelectButton in the mode row sometimes lays out its
   buttons at intrinsic width — clamp it so each icon button shares
   the available row evenly. */
.session-details :deep(.p-selectbutton) {
  display: flex;
  width: 100%;
}

.session-details :deep(.p-selectbutton .p-button) {
  flex: 1 1 0;
  min-width: 0;
  padding: 0.35rem 0.4rem;
}

.details-mode-row.mode-interactive {
  --details-mode-color: var(--p-blue-500);
}
.details-mode-row.mode-plan {
  --details-mode-color: var(--p-amber-500);
}
.details-mode-row.mode-autopilot {
  --details-mode-color: var(--p-purple-500);
}
.details-mode-row :deep(.p-selectbutton .p-button.p-togglebutton-checked) {
  background: color-mix(in srgb, var(--details-mode-color) 18%, transparent);
  color: var(--details-mode-color);
}

.approve-all-on .row-toggle-title {
  color: var(--p-green-500);
}

.session-details :deep(.p-select) {
  width: 100%;
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
  min-width: 0;
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

/* Action grid: two columns of icon+short-label buttons. Auto-fit so
   when the rail is wider it stays 2-up; when narrow (sub-200px) it
   falls back to a single column without overflowing. */
.row-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(105px, 1fr));
  gap: 0.4rem;
}

.row-actions :deep(.p-button) {
  width: 100%;
  min-width: 0;
}

.row-actions :deep(.p-button .p-button-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
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
  min-width: 0;
}

.rename-input {
  flex: 1 1 auto;
  min-width: 0;
  /* PrimeVue InputText sets a default width based on its size attr;
     override so the input actually shrinks to fill the flex slot. */
  width: 100%;
}

.rename-input :deep(input) {
  width: 100%;
  min-width: 0;
}

.workspace-path {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.55rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.72rem;
  color: var(--p-text-color);
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--p-surface-border);
  overflow: hidden;
  text-align: left;
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

/* Agent list mirrors the skill list. Currently-selected agent gets a
 * subtle highlight via the `.is-current` class. The "Project" / "User"
 * source label rides as a compact-tag inside compact-name-button. */
.agent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.agent-row.is-current {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
}

.agent-row .agent-source {
  /* Distinguish from the skill-list's `/` user-invocable tag so a quick
   * glance can tell Project vs User without reading the path tooltip. */
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.6rem;
  padding: 0.05rem 0.35rem;
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  border-radius: 0.25rem;
}

/* Tasks list (19b.1). Vertical layout per row — status pill + agent
 * name + elapsed on a header line; description on a second line;
 * Cancel/Remove right-aligned. Status colors derived from the
 * `task-status-${status}` class on the row. */
.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.task-row {
  flex-direction: column;
  align-items: stretch;
  gap: 0.25rem;
}

.task-line {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.task-status-pill {
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.6rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--p-text-color) 10%, transparent);
  color: var(--p-text-color);
  flex-shrink: 0;
}

.task-status-running .task-status-pill,
.task-status-idle .task-status-pill {
  background: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
  color: var(--p-primary-color);
}

.task-status-completed .task-status-pill {
  background: color-mix(in srgb, var(--p-green-500, #22c55e) 18%, transparent);
  color: var(--p-green-500, #22c55e);
}

.task-status-failed .task-status-pill {
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 18%, transparent);
  color: var(--p-red-500, #ef4444);
}

.task-status-cancelled .task-status-pill {
  background: color-mix(in srgb, var(--p-text-muted-color) 18%, transparent);
  color: var(--p-text-muted-color);
}

.task-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.task-elapsed {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.task-desc {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.task-error {
  font-size: 0.7rem;
  color: var(--p-red-500, #ef4444);
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 10%, transparent);
  padding: 0.2rem 0.4rem;
  border-radius: 0.2rem;
  word-break: break-word;
}

.task-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.35rem;
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

.manage-globally {
  margin-top: 0.4rem;
  align-self: flex-start;
  font-size: 0.72rem;
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

/* Compact rows: just `name + toggle` per line, descriptions
   hidden behind a chevron click. Keeps the rail usable at narrow
   widths (240–320px) — full descriptions would force the rail to
   ~500px before they fit comfortably. */
.compact-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.compact-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.35rem;
  border-radius: var(--p-border-radius-sm);
  min-width: 0;
}

.compact-row:hover {
  background: color-mix(in srgb, var(--p-content-hover-background) 40%, transparent);
}

.compact-row :deep(.p-toggleswitch) {
  flex-shrink: 0;
  justify-self: end;
}

/* 22b: tools section additions */
.tool-row {
  /* Override the grid layout used by compact-row — the
     SelectButton can exceed available width on narrow rails,
     collapsing the name column to 0 and tripping Playwright's
     visibility checks. Flex-wrap drops the SelectButton onto a
     second line when needed instead. */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  grid-template-columns: unset;
}

.tool-row .compact-name-button {
  flex: 1 1 auto;
  min-width: 0;
}

.tool-state-button {
  flex: 0 0 auto;
  justify-self: end;
  /* PrimeVue's segmented control buttons are tall by default;
     small-size pulls them in line with rail row height. */
  font-size: 0.75rem;
}

.tool-state-button :deep(.p-togglebutton),
.tool-state-button :deep(.p-button) {
  padding: 0.15rem 0.5rem;
  min-width: 0;
}

.tool-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
  margin: 0.5rem 0 0.2rem;
  padding: 0 0.35rem;
}

.tool-group-header:first-child {
  margin-top: 0;
}

.allowlist-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  padding: 0.4rem 0.55rem;
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  border-left: 2px solid var(--p-primary-color);
  border-radius: var(--p-border-radius-sm);
  font-size: 0.78rem;
  color: var(--p-text-color);
  margin-bottom: 0.35rem;
}

.critical-warning {
  display: inline-flex;
  align-items: center;
  margin-left: 0.3rem;
  color: var(--p-warning-color);
  font-size: 0.75rem;
}

.compact-name-button {
  display: flex;
  align-items: center;
  gap: 0.25rem;
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

.compact-name-button.compact-name-static {
  cursor: default;
}

.compact-chevron {
  font-size: 0.55rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.compact-name {
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.compact-tag {
  font-size: 0.6rem;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.compact-desc {
  grid-column: 1 / -1;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  padding: 0.25rem 0.25rem 0.15rem 0.85rem;
  word-break: break-word;
}

.compact-desc :deep(.md-content),
.plan-preview :deep(.md-content) {
  gap: 0.25rem;
}

.compact-desc :deep(.md-html-segment),
.plan-preview :deep(.md-html-segment) {
  font-size: 0.72rem;
  line-height: 1.35;
}

.compact-desc-error {
  color: var(--p-message-error-color);
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
  padding: 0.4rem 0.5rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  max-height: 200px;
  overflow-y: auto;
}

.file-row {
  grid-template-columns: 1fr;
}

.file-path {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--p-text-color);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.file-path span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.72rem;
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
