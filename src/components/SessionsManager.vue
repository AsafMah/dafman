<script setup lang="ts">
// Sessions Manager — left edge-group panel.
//
// Lists every CLI-side session (from `listSessions` RPC), grouped by
// workspace path. Each row supports:
//   - resume into a new chat panel (drops a `chat` panel into the body)
//   - delete the session permanently (calls bun `deleteSession` →
//     `client.deleteSession`)
//
// Refresh is explicit + on-mount + after sessions open/close from this
// app. We don't have a CLI-side session-lifecycle event stream yet
// (the SDK exposes `SessionLifecycleEvent` types but the renderer
// can't subscribe directly), so background-changed sessions appear
// only after a user-triggered refresh.

import { computed, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import { useConfirm } from "primevue/useconfirm";
import ConfirmPopup from "primevue/confirmpopup";
import { useSessionsListStore } from "../stores/sessionsListStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useToastStore } from "../stores/toastStore";
import type { SessionMetadataSummary } from "../ipc/types";

const sessionsList = useSessionsListStore();
const sessionsStore = useSessionsStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();
const confirm = useConfirm();

const { grouped, isLoading, hasLoaded, error } = storeToRefs(sessionsList);

const openSessionIds = computed(
  () => new Set(sessionsStore.sessions.map((s) => s.id)),
);

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
    <!-- Tab strip already carries the "Sessions" label via SidebarTab,
         so the inner panel doesn't repeat the title. The refresh
         button + future toolbar bits live in a slim toolbar above
         the list. -->
    <div class="manager-toolbar">
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
        No sessions yet. Create one from the topbar to get started.
      </p>

      <section
        v-for="group in grouped"
        :key="group.key"
        class="workspace-group"
      >
        <header class="group-header" :title="group.path">
          <i class="pi pi-folder" aria-hidden="true" />
          <span class="group-label">{{ group.label }}</span>
          <span class="group-count">{{ group.sessions.length }}</span>
        </header>
        <ul class="session-list">
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

.manager-toolbar {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 0.2rem 0.4rem;
  border-bottom: 1px solid var(--p-content-border-color);
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
  margin-bottom: 0.5rem;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem;
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: default;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
