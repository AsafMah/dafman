<script setup lang="ts">
// Sessions Manager — left edge-group panel.
//
// Hosts both the catalogue of CLI-side sessions (grouped by workspace,
// per-group new-session shortcut, resume / delete) AND the create-new-
// session form at the top — the topbar no longer carries it. This is
// the primary control surface for sessions; the activity-bar item just
// toggles its visibility.

import { computed, onMounted, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import AutoComplete, {
  type AutoCompleteCompleteEvent,
} from "primevue/autocomplete";
import Button from "primevue/button";
import { useConfirm } from "primevue/useconfirm";
import ConfirmPopup from "primevue/confirmpopup";
import { useSessionsListStore } from "../stores/sessionsListStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useClientStore } from "../stores/clientStore";
import { useLayoutStore, composePanelTitle } from "../stores/layoutStore";
import { useToastStore } from "../stores/toastStore";
import { invokeCommand } from "../ipc/invoke";
import type { SessionMetadataSummary } from "../ipc/types";

const sessionsList = useSessionsListStore();
const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const clientStore = useClientStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();
const confirm = useConfirm();

const { grouped, isLoading, hasLoaded, error } = storeToRefs(sessionsList);
const { ready: clientReady, isCreating: isCreatingClient } =
  storeToRefs(clientStore);
const { isCreating: isCreatingSession } = storeToRefs(sessionsStore);
const { settings } = storeToRefs(settingsStore);

const openSessionIds = computed(
  () => new Set(sessionsStore.sessions.map((s) => s.id)),
);

/// Within a workspace group, push currently-open sessions to the top
/// so the user can jump back to live conversations without scrolling
/// past closed ones. Inside each subgroup, keep the existing MRU
/// order (modifiedTime DESC). Stable sort across all browsers.
function sortedGroupSessions(group: { sessions: SessionMetadataSummary[] }) {
  const open: SessionMetadataSummary[] = [];
  const closed: SessionMetadataSummary[] = [];
  for (const s of group.sessions) {
    (openSessionIds.value.has(s.sessionId) ? open : closed).push(s);
  }
  return [...open, ...closed];
}

// ---------- New-session form ----------

const workspaceDraft = ref("");
const workspaceSuggestions = ref<string[]>([]);
const isPickingFolder = ref(false);

const recentWorkspaces = computed(
  () => settings.value.workspaces?.recent ?? [],
);

/// Workspaces that have at least one CLI-side session. Pulled from
/// `sessionsListStore.grouped` so even users who never recorded an MRU
/// entry (e.g. fresh install where `recordWorkspaceUse` hasn't fired
/// yet) still get autocomplete suggestions backed by the sessions
/// the SDK already knows about. Empty-string key (the "No workspace"
/// bucket) is filtered out.
const sessionWorkspaces = computed<string[]>(() =>
  grouped.value
    .map((g) => g.path)
    .filter((p): p is string => typeof p === "string" && p.length > 0),
);

/// All known workspaces, ordered MRU first → session-derived (recency
/// from `grouped` is already MRU-ordered). Deduped case-insensitively.
const allKnownWorkspaces = computed<string[]>(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...recentWorkspaces.value, ...sessionWorkspaces.value]) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
});

// Pre-fill with the most-recently-used workspace on first settings
// load. Only when the user hasn't typed anything yet (empty → non-empty
// transition).
watch(
  allKnownWorkspaces,
  (next) => {
    if (workspaceDraft.value === "" && next.length > 0) {
      workspaceDraft.value = next[0];
    }
  },
  { immediate: true },
);

let browseTimer: ReturnType<typeof setTimeout> | null = null;
let browseSeq = 0;

async function onSearchWorkspaces(event: AutoCompleteCompleteEvent) {
  const query = (event.query ?? "").trim();
  const lowerQuery = query.toLowerCase();
  const known = allKnownWorkspaces.value;

  // Empty input → all known workspaces (MRU + session-derived).
  if (!query) {
    workspaceSuggestions.value = [...known];
    if (browseTimer !== null) clearTimeout(browseTimer);
    return;
  }

  // Synchronous substring match against known workspaces — handles
  // the "type 'dafm' to find C:\repo\dafman" case without needing a
  // filesystem trip.
  const knownMatches = known.filter((p) => p.toLowerCase().includes(lowerQuery));

  // Filesystem browse only when the input looks pathy (has a separator).
  const looksLikePath = /[/\\]/.test(query);
  if (!looksLikePath) {
    workspaceSuggestions.value = knownMatches;
    return;
  }

  // Render the synchronous matches immediately; FS results merge in.
  workspaceSuggestions.value = knownMatches;

  if (browseTimer !== null) clearTimeout(browseTimer);
  const seq = ++browseSeq;
  browseTimer = setTimeout(async () => {
    browseTimer = null;
    let fs: string[] = [];
    try {
      fs = await invokeCommand("browseDirectory", { prefix: query });
    } catch {
      /* expected while typing — keep known-matches-only */
    }
    if (seq !== browseSeq) return;
    const seenLower = new Set(knownMatches.map((p) => p.toLowerCase()));
    const merged = [...knownMatches];
    for (const candidate of fs) {
      const k = candidate.toLowerCase();
      if (seenLower.has(k)) continue;
      seenLower.add(k);
      merged.push(candidate);
    }
    workspaceSuggestions.value = merged;
  }, 120);
}

async function onPickFolder() {
  if (isPickingFolder.value) return;
  isPickingFolder.value = true;
  try {
    const picked = await invokeCommand("pickFolder", {
      ...(workspaceDraft.value.trim()
        ? { startingFolder: workspaceDraft.value.trim() }
        : {}),
    });
    if (picked) workspaceDraft.value = picked;
  } catch {
    /* toast already shown */
  } finally {
    isPickingFolder.value = false;
  }
}

async function onCreateSession() {
  const wd = workspaceDraft.value.trim();
  try {
    const record = await sessionsStore.createSession(
      wd ? { workingDirectory: wd } : {},
    );
    if (record) {
      if (wd) void settingsStore.recordWorkspaceUse(wd);
      layoutStore.addPanel(record.id, {
        title: composePanelTitle(
          record.id,
          record.title,
          record.workingDirectory,
        ),
      });
    }
  } catch {
    /* toast already shown */
  }
}

async function onNewInWorkspace(workspacePath: string) {
  const wd = workspacePath.trim();
  try {
    const record = await sessionsStore.createSession(
      wd ? { workingDirectory: wd } : {},
    );
    if (record) {
      if (wd) void settingsStore.recordWorkspaceUse(wd);
      layoutStore.addPanel(record.id, {
        title: composePanelTitle(
          record.id,
          record.title,
          record.workingDirectory,
        ),
      });
    }
  } catch {
    /* toast already shown */
  }
}

// ---------- Groups (collapse / latest preview / resume / delete) ----------

const collapsedGroups = reactive<Record<string, boolean>>({});

function toggleGroup(key: string) {
  collapsedGroups[key] = !collapsedGroups[key];
}

onMounted(() => {
  void sessionsList.refresh();
});

watch(
  () => sessionsStore.sessions.length,
  () => {
    void sessionsList.refresh();
  },
);

function onRefresh() {
  void sessionsList.refresh();
}

async function onResume(session: SessionMetadataSummary) {
  // Already-open sessions: activate the panel and focus the composer
  // rather than no-op. Clicking the row in the sidebar is the most
  // natural "take me there" affordance.
  if (openSessionIds.value.has(session.sessionId)) {
    const dock = layoutStore.api;
    const panel = dock?.getPanel(session.sessionId);
    panel?.api.setActive();
    window.dispatchEvent(
      new CustomEvent("dafman:focus-composer", {
        detail: { sessionId: session.sessionId },
      }),
    );
    return;
  }
  try {
    const record = await sessionsStore.restoreSession(session.sessionId);
    if (record) layoutStore.addPanel(record.id);
  } catch {
    /* toast already shown */
  }
}

function onDelete(event: Event, session: SessionMetadataSummary) {
  const label =
    session.summary ?? `session ${session.sessionId.slice(0, 8)}…`;
  confirm.require({
    target: event.currentTarget as HTMLElement,
    message: `Permanently delete "${label}"? This removes all CLI-side data and can't be undone.`,
    icon: "pi pi-exclamation-triangle",
    acceptLabel: "Delete",
    rejectLabel: "Cancel",
    acceptProps: { severity: "danger", size: "small" },
    rejectProps: { severity: "secondary", text: true, size: "small" },
    accept: async () => {
      if (openSessionIds.value.has(session.sessionId)) {
        layoutStore.removePanel(session.sessionId);
      }
      try {
        await sessionsList.deleteSession(session.sessionId);
      } catch {
        /* toast already shown */
      }
    },
  });
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString();
}

function sessionLabel(session: SessionMetadataSummary): string {
  if (session.summary && session.summary.trim()) return session.summary;
  return `session ${session.sessionId.slice(0, 8)}…`;
}

void toasts; // referenced inside async handlers
</script>

<template>
  <div class="sessions-manager">
    <ConfirmPopup />

    <!-- Create-new-session block. Stays at the top of the panel so
         it's always reachable without scrolling. -->
    <section class="new-session-block">
      <form class="new-session-form" @submit.prevent="onCreateSession">
        <AutoComplete
          v-model="workspaceDraft"
          :suggestions="workspaceSuggestions"
          :complete-on-focus="true"
          placeholder="Workspace (defaults to cwd)"
          aria-label="Workspace folder"
          class="workspace-input"
          :disabled="!clientReady"
          @complete="onSearchWorkspaces"
        />
        <div class="new-session-actions">
          <Button
            type="button"
            icon="pi pi-folder-open"
            severity="secondary"
            size="small"
            aria-label="Pick folder"
            title="Pick folder"
            :loading="isPickingFolder"
            :disabled="!clientReady"
            @click="onPickFolder"
          />
          <Button
            type="submit"
            icon="pi pi-plus"
            label="New session"
            size="small"
            class="new-session-submit"
            :loading="isCreatingSession || (isCreatingClient && !clientReady)"
            :disabled="!clientReady"
          />
        </div>
      </form>
    </section>

    <!-- Sessions list -->
    <div class="manager-toolbar">
      <span class="manager-toolbar-label">Sessions</span>
      <Button
        icon="pi pi-refresh"
        text
        rounded
        size="small"
        :loading="isLoading"
        aria-label="Refresh sessions list"
        title="Refresh"
        @click="onRefresh"
      />
    </div>

    <div class="manager-body">
      <p v-if="error" class="state-message error-message">
        <i class="pi pi-exclamation-circle" aria-hidden="true" />
        {{ error }}
      </p>
      <p
        v-else-if="!hasLoaded && isLoading"
        class="state-message"
        aria-live="polite"
      >
        Loading sessions…
      </p>
      <p v-else-if="hasLoaded && grouped.length === 0" class="state-message">
        No sessions yet.
      </p>

      <section
        v-for="group in grouped"
        :key="group.key"
        class="workspace-group"
        :class="{ 'is-collapsed': collapsedGroups[group.key] }"
      >
        <div class="group-header-row">
          <button
            type="button"
            class="group-header"
            :title="group.path || 'Sessions without a workspace'"
            :aria-expanded="!collapsedGroups[group.key]"
            @click="toggleGroup(group.key)"
          >
            <i
              class="pi group-chevron"
              :class="
                collapsedGroups[group.key] ? 'pi-chevron-right' : 'pi-chevron-down'
              "
              aria-hidden="true"
            />
            <i class="pi pi-folder group-folder" aria-hidden="true" />
            <span class="group-label">{{ group.label }}</span>
            <span class="group-count">{{ group.sessions.length }}</span>
          </button>
          <Button
            icon="pi pi-plus"
            text
            rounded
            size="small"
            class="group-new"
            :aria-label="
              group.path
                ? `New session in ${group.label}`
                : 'New session (no workspace)'
            "
            :title="
              group.path
                ? `New session in ${group.path}`
                : 'New session (no workspace)'
            "
            :disabled="!clientReady"
            @click.stop="onNewInWorkspace(group.path)"
          />
        </div>

        <div
          v-if="collapsedGroups[group.key] && group.sessions.length > 0"
          class="group-preview"
          :title="group.sessions[0]?.sessionId"
        >
          <span class="group-preview-label">
            {{ sessionLabel(group.sessions[0]!) }}
          </span>
          <span class="group-preview-time">
            {{ relativeTime(group.sessions[0]!.modifiedTime) }}
          </span>
        </div>

        <ul v-show="!collapsedGroups[group.key]" class="session-list">
          <li
            v-for="session in sortedGroupSessions(group)"
            :key="session.sessionId"
            class="session-row"
            :class="{ 'is-open': openSessionIds.has(session.sessionId) }"
          >
            <button
              type="button"
              class="session-main"
              :title="session.sessionId"
              :aria-label="
                openSessionIds.has(session.sessionId)
                  ? `Focus ${sessionLabel(session)}`
                  : `Resume ${sessionLabel(session)}`
              "
              @click="onResume(session)"
            >
              <span class="session-label">{{ sessionLabel(session) }}</span>
              <span class="session-meta">
                <span>{{ relativeTime(session.modifiedTime) }}</span>
                <span
                  v-if="openSessionIds.has(session.sessionId)"
                  class="open-badge"
                  title="Currently open in a panel"
                >
                  open
                </span>
              </span>
            </button>
            <Button
              icon="pi pi-trash"
              text
              rounded
              size="small"
              severity="secondary"
              :aria-label="`Delete ${sessionLabel(session)}`"
              title="Delete session"
              @click="(e) => onDelete(e, session)"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sessions-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--p-content-background);
  color: var(--p-text-color);
  /* Container-query context so descendant rules can adapt to the
   * panel's own width — independent of viewport / parent flex. */
  container-type: inline-size;
}

/* ---- New-session block ---- */

.new-session-block {
  flex: 0 0 auto;
  padding: 0.5rem 0.5rem 0.4rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.new-session-form {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.workspace-input {
  width: 100%;
  min-width: 0;
}

/* The PrimeVue AutoComplete wraps its <input> in a panel + button shell;
 * force its input to take the full container width so a narrow sidebar
 * still shows an editable strip rather than a centered 1-char box. */
.workspace-input :deep(.p-autocomplete) {
  width: 100%;
  min-width: 0;
}
.workspace-input :deep(.p-autocomplete-input) {
  width: 100%;
  min-width: 0;
  font-size: 0.8rem;
}

.new-session-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.new-session-submit {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: center;
}

/* The submit button keeps its 'New session' label by default; below
 * ~190px sidebar width the label drops out and the icon stands alone
 * with a tooltip. */
@container (max-width: 190px) {
  .new-session-submit :deep(.p-button-label) {
    display: none;
  }
}

/* ---- Toolbar / list ---- */

.manager-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.2rem 0.4rem 0.2rem 0.55rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.manager-toolbar-label {
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

.manager-body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0.25rem 0;
}

.state-message {
  padding: 0.75rem 0.75rem;
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  margin: 0;
}

.error-message {
  color: var(--p-red-500, #ef4444);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

/* ---- Workspace groups ---- */

.workspace-group {
  margin-bottom: 0.4rem;
}

.group-header-row {
  display: flex;
  align-items: stretch;
  gap: 0.1rem;
  border-radius: var(--p-border-radius-md);
}

.group-header-row:hover {
  background: color-mix(in srgb, var(--p-text-color) 5%, transparent);
}

/* Per-workspace '+' button — always visible (no hover-reveal) so
 * the affordance is discoverable. */
.group-new {
  flex: 0 0 auto;
  align-self: center;
  margin-right: 0.25rem;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: 1 1 auto;
  min-width: 0;
  padding: 0.35rem 0.6rem;
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

.group-header:hover {
  color: var(--p-text-color);
}

.group-header:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}

.group-chevron {
  font-size: 0.65rem;
  width: 0.75rem;
  text-align: center;
  flex: 0 0 auto;
}

.group-folder {
  font-size: 0.75rem;
  flex: 0 0 auto;
}

.group-label {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: var(--p-text-muted-color);
}

.group-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.2rem 0.6rem 0.4rem 1.95rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.group-preview-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}

.group-preview-time {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

/* ---- Session rows ---- */

.session-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.session-row {
  display: flex;
  align-items: stretch;
  border-radius: var(--p-border-radius-md);
  margin: 0 0.4rem;
}

.session-row:hover {
  background: color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.session-row.is-open {
  background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
}

.session-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.1rem;
  padding: 0.4rem 0.55rem;
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
  text-align: left;
  font: inherit;
  border-radius: var(--p-border-radius-md);
}

.session-main:disabled {
  cursor: default;
}

.session-label {
  font-size: 0.85rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  line-height: 1.25;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.open-badge {
  padding: 0 0.4rem;
  border-radius: var(--p-border-radius-sm);
  background: color-mix(in srgb, var(--p-primary-color) 20%, transparent);
  color: var(--p-primary-color);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.65rem;
}
</style>
