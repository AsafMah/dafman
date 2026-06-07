<script setup lang="ts">
// Sessions Manager — left edge-group panel.
//
// Hosts both the catalogue of CLI-side sessions (grouped by workspace,
// per-group new-session shortcut, resume / delete) AND the create-new-
// session form at the top — the topbar no longer carries it. This is
// the primary control surface for sessions; the activity-bar item just
// toggles its visibility.

import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import AutoComplete, { type AutoCompleteCompleteEvent } from 'primevue/autocomplete';
import Button from 'primevue/button';
import Select from 'primevue/select';
import { useConfirm } from 'primevue/useconfirm';
import ConfirmPopup from 'primevue/confirmpopup';
import { useSessionsListStore, type GroupingMode } from '@/stores/chat/sessionsListStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useGroupsStore, extractPanelIdsFromBody } from '@/stores/shell/groupsStore';
import { useSessionSelectors } from '@/stores/chat/sessionSelectors';
import { indicatorStyle, type NotificationStyle } from '@/lib/notificationStyles';
import { emit as busEmit } from '@/lib/bus';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useClientStore } from '@/stores/app/clientStore';
import { useLayoutStore, composePanelTitle } from '@/stores/shell/layoutStore';
import { useToastStore } from '@/stores/app/toastStore';
import { useFolderPicker } from '@/composables/useFolderPicker';
import { browseDirectorySafe } from '@/lib/browseDirectory';
import type { SessionMetadataSummary } from '@/ipc/types';

const sessionsList = useSessionsListStore();
const sessionsStore = useSessionsStore();
const groupsStore = useGroupsStore();
const settingsStore = useSettingsStore();
const clientStore = useClientStore();
const layoutStore = useLayoutStore();
const toasts = useToastStore();
const confirm = useConfirm();
const { displayTitle } = useSessionSelectors();

const { grouped, isLoading, hasLoaded, error, viewState } = storeToRefs(sessionsList);
const { ready: clientReady, isCreating: isCreatingClient } = storeToRefs(clientStore);
const { isCreating: isCreatingSession } = storeToRefs(sessionsStore);
const { settings } = storeToRefs(settingsStore);

const openSessionIds = computed(() => new Set(sessionsStore.sessions.map((s) => s.id)));

/// Quick lookup: session-id → its live record (if currently open).
/// Used by the row template to look up pendingRequest / unseenTurns
/// without iterating `sessionsStore.sessions` per row.
const recordsById = computed(() => {
  const map = new Map<string, (typeof sessionsStore.sessions)[number]>();

  for (const r of sessionsStore.sessions) map.set(r.id, r);

  return map;
});

function indicatorFor(sessionId: string): NotificationStyle | null {
  const r = recordsById.value.get(sessionId);

  if (!r) return null;

  return indicatorStyle(r.pendingRequests[0]?.kind, r.isThinking, r.unseenTurns);
}

/// Kind icon shown on every row, regardless of pending/thinking state.
/// Picks the most specific class:
///   - draft (open, no messages yet) → pencil
///   - turn active                     → bolt (pulsed via indicator overlay)
///   - has-conversation                → comments
///   - closed (not in sessionsStore)   → comments-muted
/// The `indicatorFor` state badge layers over this for state changes.
function sessionKindIcon(sessionId: string): {
  iconClass: string;
  tooltip: string;
  muted: boolean;
} {
  const open = openSessionIds.value.has(sessionId);

  if (!open) {
    return { iconClass: 'pi-comments', tooltip: 'Closed session', muted: true };
  }

  const r = recordsById.value.get(sessionId);

  if (!r) {
    return { iconClass: 'pi-comments', tooltip: 'Open session', muted: false };
  }

  // Heuristic: a session with zero user/assistant message events is
  // still a "draft". We don't count tool/reasoning events because
  // those can fire mid-creation before any user typing.
  const hasUserOrAssistantMessage = r.events.some(
    (e) => e.eventType === 'user.message' || e.eventType === 'assistant.message',
  );

  if (!hasUserOrAssistantMessage) {
    return { iconClass: 'pi-pencil', tooltip: 'Draft — no messages yet', muted: false };
  }

  if (r.isThinking) {
    return { iconClass: 'pi-bolt', tooltip: 'Turn active', muted: false };
  }

  return { iconClass: 'pi-comments', tooltip: 'Open session', muted: false };
}

/// Number of SDK-blocking pending requests beyond the first (the
/// first one's already represented by the colored indicator
/// icon/dot). Surfaces "queued questions" without making the row
/// busy.
function extraPendingCount(sessionId: string): number {
  const r = recordsById.value.get(sessionId);

  if (!r) return 0;

  return Math.max(0, r.pendingRequests.length - 1);
}

// ---------- New-session form ----------

const workspaceDraft = ref('');
const workspaceSuggestions = ref<string[]>([]);
const { isPicking: isPickingFolder, pick: pickWorkspaceFolder } = useFolderPicker();

const recentWorkspaces = computed(() => settings.value.workspaces?.recent ?? []);

/// Workspaces that have at least one CLI-side session. Pulled from
/// `sessionsListStore.grouped` so even users who never recorded an MRU
/// entry (e.g. fresh install where `recordWorkspaceUse` hasn't fired
/// yet) still get autocomplete suggestions backed by the sessions
/// the SDK already knows about. Empty-string key (the "No workspace"
/// bucket) is filtered out.
const sessionWorkspaces = computed<string[]>(() =>
  grouped.value
    .map((g) => g.path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0),
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

// Pre-fill with the user's default workspace on first settings load,
// falling back to the most-recently-used path. Only when the user
// hasn't typed anything yet (empty → non-empty transition).
const initialWorkspaceCandidate = computed<string>(() => {
  const def = settings.value.workspaces?.defaultWorkspace ?? '';

  if (def) return def;

  return allKnownWorkspaces.value[0] ?? '';
});

watch(
  initialWorkspaceCandidate,
  (next) => {
    if (workspaceDraft.value === '' && next) {
      workspaceDraft.value = next;
    }
  },
  { immediate: true },
);

let browseTimer: ReturnType<typeof setTimeout> | null = null;
let browseSeq = 0;

async function onSearchWorkspaces(event: AutoCompleteCompleteEvent) {
  const query = (event.query ?? '').trim();
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

  browseTimer = setTimeout(() => {
    browseTimer = null;
    void (async () => {
      const fs = await browseDirectorySafe(query);

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
    })();
  }, 120);
}

async function onPickFolder() {
  const picked = await pickWorkspaceFolder(workspaceDraft.value.trim() || undefined);

  if (picked) workspaceDraft.value = picked;
}

async function onCreateSession() {
  const wd = workspaceDraft.value.trim();

  try {
    const record = await sessionsStore.createSession(wd ? { workingDirectory: wd } : {});

    if (record) {
      if (wd) void settingsStore.recordWorkspaceUse(wd);

      layoutStore.addPanel(record.id, {
        title: composePanelTitle(record.id, record.title),
      });
    }
  } catch {
    /* toast already shown */
  }
}

async function onNewInWorkspace(workspacePath: string) {
  const wd = workspacePath.trim();

  try {
    const record = await sessionsStore.createSession(wd ? { workingDirectory: wd } : {});

    if (record) {
      if (wd) void settingsStore.recordWorkspaceUse(wd);

      layoutStore.addPanel(record.id, {
        title: composePanelTitle(record.id, record.title),
      });
    }
  } catch {
    /* toast already shown */
  }
}

// ---------- View-state toolbar options ----------

const GROUPING_OPTIONS = [
  { label: 'By workspace', value: 'workspace' },
  { label: 'By dockview group', value: 'dockview-group' },
  { label: 'By date', value: 'date-bucket' },
  { label: 'Flat', value: 'flat' },
] as const;

const SORT_OPTIONS = [
  { label: 'Modified', value: 'modified' },
  { label: 'Created', value: 'created' },
  { label: 'Name', value: 'name' },
  { label: 'Activity', value: 'activity' },
] as const;

function toggleSortDir() {
  viewState.value.sortDir = viewState.value.sortDir === 'desc' ? 'asc' : 'desc';
}

function toggleColorByGroup() {
  viewState.value.colorByGroup = !viewState.value.colorByGroup;
}

// ---------- Search ----------

const searchOpen = ref(false);
const searchInputEl = ref<HTMLInputElement | null>(null);

function openSearch() {
  searchOpen.value = true;
  void nextTick(() => {
    searchInputEl.value?.focus();
  });
}

function closeSearch() {
  viewState.value.searchQuery = '';
  searchOpen.value = false;
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeSearch();
  }
}

// ---------- Groups (collapse / latest preview / resume / delete) ----------

const collapsedGroups = reactive<Record<string, boolean>>({});

function toggleGroup(key: string) {
  collapsedGroups[key] = !collapsedGroups[key];
}

/// A group is expanded if explicitly not-collapsed AND no search query
/// (a non-empty query forces all groups open so matches are visible).
function isGroupExpanded(key: string): boolean {
  if (viewState.value.searchQuery.trim()) return true;

  return !collapsedGroups[key];
}

/// PrimeIcon class for the group header icon (workspace / date-bucket /
/// fallback). dockview-group uses a color dot instead of an icon.
function groupFolderIcon(kind: GroupingMode): string {
  if (kind === 'date-bucket') return 'pi-calendar';

  return 'pi-folder';
}

// searchQuery is intentionally ephemeral — not persisted across reloads
// (OQ1). Reset on mount even if a stale value slipped into localStorage.
onMounted(() => {
  viewState.value.searchQuery = '';
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

/// Set of session ids the user is currently resuming via this
/// sidebar. Drives a per-row spinner so a clicked "Resume" row gives
/// immediate visual feedback during the ~200-800 ms it takes the SDK
/// `resumeSession` RPC to read session.db + replay history.
const resumingIds = ref<Set<string>>(new Set());

async function onResume(session: SessionMetadataSummary) {
  // Already-open sessions: activate the panel (or re-add if the panel
  // was removed while the session was detached with active jobs).
  if (openSessionIds.value.has(session.sessionId)) {
    const dock = layoutStore.api;
    const panel = dock?.getPanel(session.sessionId);

    if (panel) {
      panel.api.setActive();
    } else {
      // Panel was removed while session was detached — re-add it.
      layoutStore.addPanel(session.sessionId);
      // Explicitly activate after re-add so it's visible even when
      // another panel grabbed focus during the addPanel flow.
      layoutStore.activatePanel(session.sessionId);
    }

    // Restore-aware: just focus. `focus-composer` re-pins to the bottom
    // only if the user was already there (a scrolled-up reader keeps
    // their place); we no longer force a scroll-to-bottom here.
    busEmit('focus-composer', { sessionId: session.sessionId });

    return;
  }

  // Optimistic flip + finally-cleanup so a failed resume doesn't
  // strand the spinner. The Set copy/reassign dance is so Vue's
  // reactivity picks up the change — mutating the underlying Set
  // doesn't notify watchers.
  const next = new Set(resumingIds.value);

  next.add(session.sessionId);
  resumingIds.value = next;

  try {
    const record = await sessionsStore.restoreSession(session.sessionId);

    if (record) layoutStore.addPanel(record.id);
  } catch {
    /* toast already shown */
  } finally {
    const after = new Set(resumingIds.value);

    after.delete(session.sessionId);
    resumingIds.value = after;
  }
}

function onDelete(event: Event, session: SessionMetadataSummary) {
  const label = sessionLabel(session);

  confirm.require({
    group: 'sessions-manager',
    target: event.currentTarget as HTMLElement,
    message: `Permanently delete "${label}"? This removes all CLI-side data and can't be undone.`,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    acceptProps: { severity: 'danger', size: 'small' },
    rejectProps: { severity: 'secondary', text: true, size: 'small' },
    accept: () => {
      void (async () => {
        try {
          await sessionsList.deleteSession(session.sessionId);
        } catch {
          /* toast already shown */
        }
      })();
    },
  });
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);

  if (Number.isNaN(then)) return iso;

  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (diffSec < 60) return 'just now';

  const m = Math.floor(diffSec / 60);

  if (m < 60) return `${m}m ago`;

  const h = Math.floor(m / 60);

  if (h < 24) return `${h}h ago`;

  const d = Math.floor(h / 24);

  if (d < 7) return `${d}d ago`;

  return new Date(then).toLocaleDateString();
}

/// Row label. Derives from the single-owner title selector: an open
/// session shows its live `SessionRecord` title, a closed one the
/// durable catalog summary, falling back to the short GUID (#149).
function sessionLabel(session: SessionMetadataSummary): string {
  return displayTitle(session.sessionId);
}

// ---------- Color-by-group ----------

/// sessionId → dockview group hex color, built from innerBodiesCache
/// and live innerApis. Null when colorByGroup is disabled.
const sessionGroupColor = computed((): Map<string, string> | null => {
  if (!viewState.value.colorByGroup) return null;

  const map = new Map<string, string>();

  for (const g of groupsStore.groups) {
    const body = groupsStore.innerBodiesCache[g.id] ?? groupsStore.innerApis[g.id]?.toJSON();

    for (const sid of extractPanelIdsFromBody(body)) {
      map.set(sid, g.color);
    }
  }

  return map;
});

/// Inline border-left style for a session row when colorByGroup is on.
function rowGroupColorStyle(sessionId: string): { borderLeft: string } | undefined {
  const color = sessionGroupColor.value?.get(sessionId);

  if (!color) return undefined;

  return { borderLeft: `3px solid ${color}` };
}

void toasts; // referenced inside async handlers
</script>

<template>
  <div class="sessions-manager">
    <ConfirmPopup group="sessions-manager" />

    <!-- Create-new-session block. Stays at the top of the panel so
         it's always reachable without scrolling. -->
    <section class="new-session-block">
      <form
        class="new-session-form"
        @submit.prevent="onCreateSession"
      >
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

    <!-- Sessions list toolbar -->
    <div class="manager-toolbar">
      <span class="manager-toolbar-label">Sessions</span>
      <div class="toolbar-controls">
        <Select
          v-model="viewState.grouping"
          :options="[...GROUPING_OPTIONS]"
          option-label="label"
          option-value="value"
          aria-label="Grouping mode"
          title="Grouping mode"
          class="toolbar-select toolbar-select-group"
          size="small"
          unstyled
        />
        <Select
          v-model="viewState.sortField"
          :options="[...SORT_OPTIONS]"
          option-label="label"
          option-value="value"
          aria-label="Sort by"
          title="Sort by"
          class="toolbar-select toolbar-select-sort"
          size="small"
          unstyled
        />
        <Button
          :icon="
            viewState.sortDir === 'desc' ? 'pi pi-sort-amount-down' : 'pi pi-sort-amount-up-alt'
          "
          text
          rounded
          size="small"
          :aria-label="
            viewState.sortDir === 'desc'
              ? 'Descending — click to reverse'
              : 'Ascending — click to reverse'
          "
          :title="viewState.sortDir === 'desc' ? 'Sort descending' : 'Sort ascending'"
          @click="toggleSortDir"
        />
        <Button
          icon="pi pi-palette"
          text
          rounded
          size="small"
          :class="{ 'toolbar-btn-active': viewState.colorByGroup }"
          aria-label="Color rows by dockview group"
          title="Color by group"
          @click="toggleColorByGroup"
        />
        <Button
          icon="pi pi-search"
          text
          rounded
          size="small"
          :class="{ 'toolbar-btn-active': searchOpen || !!viewState.searchQuery.trim() }"
          aria-label="Toggle search"
          title="Search sessions"
          @click="searchOpen ? closeSearch() : openSearch()"
        />
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
    </div>

    <!-- Inline search bar (visible when searchOpen) -->
    <div
      v-if="searchOpen"
      class="search-bar"
    >
      <i
        class="pi pi-search search-bar-icon"
        aria-hidden="true"
      />
      <input
        ref="searchInputEl"
        v-model="viewState.searchQuery"
        class="search-bar-input"
        type="search"
        placeholder="Filter sessions…"
        aria-label="Filter sessions"
        @keydown="onSearchKeydown"
      />
      <Button
        icon="pi pi-times"
        text
        rounded
        size="small"
        aria-label="Clear search"
        title="Clear search"
        @click="closeSearch"
      />
    </div>

    <div class="manager-body">
      <p
        v-if="error"
        class="state-message error-message"
      >
        <i
          class="pi pi-exclamation-circle"
          aria-hidden="true"
        />
        {{ error }}
      </p>
      <p
        v-else-if="!hasLoaded && isLoading"
        class="state-message"
        aria-live="polite"
      >
        Loading sessions…
      </p>
      <p
        v-else-if="hasLoaded && grouped.length === 0"
        class="state-message"
      >
        No sessions yet.
      </p>
      <p
        v-else-if="hasLoaded && grouped.every((g) => g.sessions.length === 0)"
        class="state-message"
      >
        No sessions match the current filter.
      </p>

      <section
        v-for="group in grouped"
        :key="group.key"
        class="workspace-group"
        :class="{ 'is-collapsed': !isGroupExpanded(group.key) }"
      >
        <!-- Group header — hidden in flat mode -->
        <template v-if="group.kind !== 'flat'">
          <div class="group-header-row">
            <button
              type="button"
              class="group-header"
              :title="group.path || group.label"
              :aria-expanded="isGroupExpanded(group.key)"
              @click="toggleGroup(group.key)"
            >
              <i
                class="pi group-chevron"
                :class="isGroupExpanded(group.key) ? 'pi-chevron-down' : 'pi-chevron-right'"
                aria-hidden="true"
              />
              <!-- dockview-group: show color dot instead of folder icon -->
              <span
                v-if="group.kind === 'dockview-group' && group.color"
                class="group-color-dot"
                :style="{ background: group.color }"
                aria-hidden="true"
              />
              <i
                v-else
                class="pi group-folder"
                :class="groupFolderIcon(group.kind)"
                aria-hidden="true"
              />
              <span class="group-label">{{ group.label }}</span>
              <span class="group-count">{{ group.sessions.length }}</span>
            </button>
            <!-- New session in workspace — workspace groups only -->
            <Button
              v-if="group.kind === 'workspace'"
              icon="pi pi-plus"
              text
              rounded
              size="small"
              class="group-new"
              :aria-label="
                group.path ? `New session in ${group.label}` : 'New session (no workspace)'
              "
              :title="group.path ? `New session in ${group.path}` : 'New session (no workspace)'"
              :disabled="!clientReady"
              @click.stop="onNewInWorkspace(group.path ?? '')"
            />
          </div>

          <div
            v-if="!isGroupExpanded(group.key) && group.sessions.length > 0"
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
        </template>

        <ul
          v-show="isGroupExpanded(group.key)"
          class="session-list"
          :class="{ 'session-list-flat': group.kind === 'flat' }"
        >
          <li
            v-for="session in group.sessions"
            :key="session.sessionId"
            class="session-row"
            :class="{
              'is-open': openSessionIds.has(session.sessionId),
              'is-resuming': resumingIds.has(session.sessionId),
            }"
            :style="rowGroupColorStyle(session.sessionId)"
          >
            <button
              type="button"
              class="session-main"
              :disabled="resumingIds.has(session.sessionId)"
              :title="session.sessionId"
              :aria-label="
                openSessionIds.has(session.sessionId)
                  ? `Focus ${sessionLabel(session)}`
                  : `Resume ${sessionLabel(session)}`
              "
              @click="onResume(session)"
            >
              <span class="session-label">
                <span class="session-kind">
                  <i
                    class="pi session-kind-icon"
                    :class="[
                      sessionKindIcon(session.sessionId).iconClass,
                      { 'is-muted': sessionKindIcon(session.sessionId).muted },
                    ]"
                    :title="sessionKindIcon(session.sessionId).tooltip"
                    aria-hidden="true"
                  />
                  <span
                    v-if="indicatorFor(session.sessionId)"
                    class="session-state-dot"
                    :class="{
                      'session-state-dot-pulse': indicatorFor(session.sessionId)!.pulse,
                    }"
                    :style="{ '--dot-color': indicatorFor(session.sessionId)!.color }"
                    :aria-label="indicatorFor(session.sessionId)!.label"
                    :title="indicatorFor(session.sessionId)!.label"
                  />
                </span>
                {{ sessionLabel(session) }}
              </span>
              <span class="session-meta">
                <span
                  v-if="resumingIds.has(session.sessionId)"
                  class="resuming-pill"
                  aria-label="Resuming"
                >
                  <i
                    class="pi pi-spin pi-spinner"
                    aria-hidden="true"
                  />
                  Resuming…
                </span>
                <template v-else>
                  <span
                    v-if="extraPendingCount(session.sessionId) > 0"
                    class="badge-pending"
                    :title="`${extraPendingCount(session.sessionId)} additional request(s) waiting`"
                  >
                    +{{ extraPendingCount(session.sessionId) }}
                  </span>
                  <span>{{ relativeTime(session.modifiedTime) }}</span>
                  <span
                    v-if="openSessionIds.has(session.sessionId)"
                    class="open-badge"
                    title="Currently open in a panel"
                  >
                    open
                  </span>
                </template>
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
  padding: 0.2rem 0.1rem 0.2rem 0.55rem;
  border-bottom: 1px solid var(--p-content-border-color);
  gap: 0.25rem;
}

.manager-toolbar-label {
  font-size: 0.7rem;
  letter-spacing: 0.05em;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
  flex: 0 0 auto;
}

.toolbar-controls {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  flex: 1 1 auto;
  justify-content: flex-end;
  min-width: 0;
}

/* Unstyled Select rendered as a compact text button. */
.toolbar-select {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  padding: 0.25rem 0.35rem;
  border-radius: var(--p-border-radius-sm);
  border: none;
  background: transparent;
  white-space: nowrap;
}

.toolbar-select:hover {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}

/* PrimeVue Select unstyled — hide the internal chevron on narrow widths */
.toolbar-select-group {
  max-width: 7rem;
}

.toolbar-select-sort {
  max-width: 5.5rem;
}

@container (max-width: 230px) {
  .toolbar-select-group,
  .toolbar-select-sort {
    max-width: 4rem;
  }
}

/* Active-state tint for icon-toggle buttons (color-by-group, search) */
.toolbar-btn-active :deep(.p-button-icon) {
  color: var(--p-primary-color);
}

/* ---- Inline search bar ---- */

.search-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.4rem;
  border-bottom: 1px solid var(--p-content-border-color);
  background: color-mix(in srgb, var(--p-primary-color) 5%, transparent);
}

.search-bar-icon {
  flex: 0 0 auto;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.search-bar-input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  font-size: 0.8rem;
  color: var(--p-text-color);
}

.search-bar-input::placeholder {
  color: var(--p-text-muted-color);
}

/* Hide the native clear button that some browsers add to type="search" */
.search-bar-input::-webkit-search-cancel-button {
  display: none;
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
  /* Sticky to the top of the scrolling .manager-body so the folder
   * name stays visible while you scroll a long session list. The
   * background mask blends with the panel so rows that pass behind
   * the header don't bleed through. */
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--p-content-background);
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

/* Color dot for dockview-group headers */
.group-color-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  flex: 0 0 auto;
  display: inline-block;
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
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
}

.session-list {
  list-style: none;
  padding: 0 0 0 0.7rem;
  margin: 0;
  border-left: 1px dotted color-mix(in srgb, var(--p-text-color) 15%, transparent);
  margin-left: 0.85rem;
}

/* Flat mode list has no group indent */
.session-list-flat {
  padding: 0;
  margin: 0;
  border-left: none;
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

.session-row {
  display: flex;
  align-items: stretch;
  border-radius: var(--p-border-radius-md);
  margin: 0 0.4rem;
  /* border-left applied inline when colorByGroup is on */
  box-sizing: border-box;
}

.session-row:hover {
  background: color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.session-row.is-open {
  background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
}

.session-row.is-resuming {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}

.session-row.is-resuming .session-main {
  cursor: progress;
}

.resuming-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  color: var(--p-primary-color);
  font-style: italic;
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

.session-kind {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-right: 0.4rem;
  flex: 0 0 auto;
}

.session-kind-icon {
  font-size: 0.9rem;
  color: var(--p-text-color);
  /* Compositor layer — see ChatTab.vue::.chat-tab-icon for rationale.
   * Without this the pi-spin animation on the "thinking" indicator
   * freezes under main-thread load. */
  will-change: transform;
}

.session-kind-icon.is-muted {
  color: var(--p-text-muted-color);
  opacity: 0.55;
}

.session-state-dot {
  position: absolute;
  top: -2px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dot-color, var(--p-primary-color));
  border: 2px solid var(--p-content-background);
  box-sizing: content-box;
}

.session-state-dot-pulse {
  animation: session-state-dot-pulse 1.6s ease-in-out infinite;
}

@keyframes session-state-dot-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.55;
    transform: scale(0.85);
  }
}

.badge-pending {
  padding: 0 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--p-orange-500) 22%, transparent);
  color: var(--p-orange-700, var(--p-orange-500));
  font-size: 0.68rem;
  font-weight: 600;
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
