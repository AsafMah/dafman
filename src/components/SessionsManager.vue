<script setup lang="ts">
// Sessions Manager — left edge-group panel.
//
// Lists every CLI-side session (from `listSessions` RPC), grouped by
// workspace path. Each row supports:
//   - resume into a new chat panel (drops a `chat` panel into the body)
//   - delete the session permanently (calls bun `deleteSession` →
//     `client.deleteSession`)
//
// Edge-group panels host their own header chrome (title + close
// button + toolbar) because dockview's side-rotated tab strip is
// hidden via CSS (`.dv-edge-group .dv-tabs-and-actions-container`).
//
// Refresh is explicit + on-mount + after sessions open/close from this
// app. We don't have a CLI-side session-lifecycle event stream yet
// (the SDK exposes `SessionLifecycleEvent` types but the renderer
// can't subscribe directly), so background-changed sessions appear
// only after a user-triggered refresh.

import { computed, onMounted, reactive, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import { useConfirm } from "primevue/useconfirm";
import ConfirmPopup from "primevue/confirmpopup";
import { useSessionsListStore } from "../stores/sessionsListStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useToastStore } from "../stores/toastStore";
import type { SessionMetadataSummary } from "../ipc/types";

/// The panel id we register from App.vue. Keep in sync with that
/// file; if it ever moves to a shared constants module, both should
/// import from there.
const PANEL_ID = "sessions-manager";

const sessionsList = useSessionsListStore();
const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();
const confirm = useConfirm();

const { grouped, isLoading, hasLoaded, error } = storeToRefs(sessionsList);

const openSessionIds = computed(
  () => new Set(sessionsStore.sessions.map((s) => s.id)),
);

/// Tracks whether the dockview edge group is collapsed (slim strip)
/// vs expanded (full content). Toggled by clicking the header title.
/// Defaults to expanded; resets on mount.
const sidebarCollapsed = ref(false);

function toggleSidebarCollapsed() {
  const dock = layoutStore.api;
  if (!dock) return;
  const next = !sidebarCollapsed.value;
  // setEdgeGroupCollapsed takes the underlying group, so look up the
  // panel and reach its group via the api.
  const panel = dock.getPanel(PANEL_ID);
  if (!panel) return;
  // Cast: setEdgeGroupCollapsed exists on the DockviewApi but the
  // type emitted from dockview-vue's ref doesn't always include the
  // optional shell-manager methods. Runtime is fine.
  (dock as unknown as {
    setEdgeGroupCollapsed: (group: unknown, collapsed: boolean) => void;
  }).setEdgeGroupCollapsed(panel.api.group, next);
  sidebarCollapsed.value = next;
}

/// Map of workspace-group-key -> collapsed flag. Reactive so toggling
/// re-renders the affected group. Default-collapsed for now would be
/// "everything expanded"; the user can collapse what they don't need.
/// State is in-memory only — persisting between launches can land
/// later if there's demand.
const collapsedGroups = reactive<Record<string, boolean>>({});

function toggleGroup(key: string) {
  collapsedGroups[key] = !collapsedGroups[key];
}

onMounted(() => {
  void sessionsList.refresh();
});

// Refresh after any in-app session is opened or closed — keeps the
// "currently open" badge accurate and picks up newly-created sessions
// that may not yet have been indexed by the previous fetch.
watch(
  () => sessionsStore.sessions.length,
  () => {
    void sessionsList.refresh();
  },
);

function onRefresh() {
  void sessionsList.refresh();
}

function onClose() {
  layoutStore.closePanel(PANEL_ID);
}

async function onResume(session: SessionMetadataSummary) {
  // If the session is already open in a panel, just focus it.
  if (openSessionIds.value.has(session.sessionId)) {
    // dockview-vue exposes setActive on the panel api; we
    // approximate by calling addPanel which is a no-op when the id
    // is already present (it returns early). For the focus case
    // we'd need extra plumbing — skip for v1, the user can click
    // the tab.
    return;
  }
  try {
    const record = await sessionsStore.restoreSession(session.sessionId);
    if (record) {
      layoutStore.addPanel(record.id);
    }
  } catch {
    /* toast already shown */
  }
}

function onDelete(event: Event, session: SessionMetadataSummary) {
  const label =
    session.summary ??
    `session ${session.sessionId.slice(0, 8)}…`;
  confirm.require({
    target: event.currentTarget as HTMLElement,
    message: `Permanently delete "${label}"? This removes all CLI-side data and can't be undone.`,
    icon: "pi pi-exclamation-triangle",
    acceptLabel: "Delete",
    rejectLabel: "Cancel",
    acceptProps: { severity: "danger", size: "small" },
    rejectProps: { severity: "secondary", text: true, size: "small" },
    accept: async () => {
      // If the session is currently open in a panel, close that panel
      // first so we don't leave an orphan around after the delete.
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

void toasts; // referenced inside async handlers; appease vue-tsc unused-import
</script>

<template>
  <div class="sessions-manager">
    <ConfirmPopup />

    <header class="manager-header">
      <button
        type="button"
        class="manager-title-button"
        :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        :aria-expanded="!sidebarCollapsed"
        @click="toggleSidebarCollapsed"
      >
        <i
          class="pi manager-title-chevron"
          :class="sidebarCollapsed ? 'pi-chevron-right' : 'pi-chevron-down'"
          aria-hidden="true"
        />
        <i class="pi pi-list" aria-hidden="true" />
        <span class="manager-title-text">Sessions</span>
      </button>
      <div class="manager-actions">
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
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          aria-label="Close Sessions panel"
          title="Close"
          @click="onClose"
        />
      </div>
    </header>

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
        No sessions yet. Create one from the topbar to get started.
      </p>

      <section
        v-for="group in grouped"
        :key="group.key"
        class="workspace-group"
        :class="{ 'is-collapsed': collapsedGroups[group.key] }"
      >
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

        <!-- Collapsed preview: show the latest session's label + relative
             time so the user can scan recency without expanding. -->
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
            v-for="session in group.sessions"
            :key="session.sessionId"
            class="session-row"
            :class="{ 'is-open': openSessionIds.has(session.sessionId) }"
          >
            <button
              type="button"
              class="session-main"
              :title="session.sessionId"
              :aria-label="`Resume ${sessionLabel(session)}`"
              :disabled="openSessionIds.has(session.sessionId)"
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
}

.manager-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem 0.35rem 0.6rem;
  border-bottom: 1px solid var(--p-content-border-color);
  min-height: var(--dv-tabs-and-actions-container-height, 35px);
}

.manager-title-button {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  margin: 0;
  padding: 0.2rem 0.3rem;
  color: var(--p-text-color);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  border: none;
  border-radius: var(--p-border-radius-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.manager-title-button:hover {
  background: color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.manager-title-button:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}

.manager-title-chevron {
  font-size: 0.65rem;
  width: 0.75rem;
  text-align: center;
  flex: 0 0 auto;
  color: var(--p-text-muted-color);
}

.manager-title-text {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manager-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.1rem;
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

.workspace-group {
  margin-bottom: 0.4rem;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
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
  background: color-mix(in srgb, var(--p-text-color) 5%, transparent);
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
  cursor: default;
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
  /* Allow long titles to wrap onto two lines rather than ellipsising
   * away the tail — chat-summary titles are valuable as-is. */
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
