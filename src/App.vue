<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import AutoComplete, {
  type AutoCompleteCompleteEvent,
} from "primevue/autocomplete";
import Button from "primevue/button";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import type { ToastMessageOptions } from "primevue/toast";
import { DockviewVue, type DockviewReadyEvent } from "dockview-vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import { useClientStore } from "./stores/clientStore";
import { useSessionsStore } from "./stores/sessionsStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useToastStore } from "./stores/toastStore";
import { useLayoutStore, composePanelTitle } from "./stores/layoutStore";
import { resolveIsDark } from "./lib/theme";
import { invokeCommand } from "./ipc/invoke";

const clientStore = useClientStore();
const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const toastStore = useToastStore();
const layoutStore = useLayoutStore();
const primeToast = useToast();

const { ready: clientReady, isCreating: isCreatingClient } = storeToRefs(clientStore);
const { sessions, isCreating: isCreatingSession } = storeToRefs(sessionsStore);
const { settings } = storeToRefs(settingsStore);

const prefersDark = ref(false);
const settingsOpen = ref(false);

// Dev playground is only built in dev mode; the button is tree-shaken in prod.
const isDev = import.meta.env.DEV;
function openPlayground() {
  const url = new URL(window.location.href);
  url.searchParams.set("dev", "1");
  window.location.href = url.toString();
}

const isDarkMode = computed(() =>
  resolveIsDark(settings.value.appearance.theme, prefersDark.value),
);

function applyThemeClass(isDark: boolean) {
  document.documentElement.classList.toggle("app-dark", isDark);
}

onMounted(async () => {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  prefersDark.value = mql.matches;
  mql.addEventListener("change", (e) => {
    prefersDark.value = e.matches;
  });
  applyThemeClass(isDarkMode.value);
  try {
    await settingsStore.load();
  } catch {
    /* toast already shown */
  }
  try {
    await clientStore.createClient();
  } catch {
    /* toast already shown */
  }

  // Restore previously-open sessions. We resume *first*, then hand the
  // layout JSON to dockview — the slot can't render a session that
  // isn't in the store yet, and dockview won't call `addPanel` for
  // panels we drop from the layout. This intentionally runs after the
  // client is up (the SDK rejects `resumeSession` otherwise).
  if (clientStore.ready) {
    await restoreFromLayout();
  }

  // Open the Sessions Manager by default. We do this only when the
  // persisted dockview JSON didn't contain it — i.e. first launch, or
  // the user explicitly closed it last time we don't want to reopen it.
  // The presence check looks at the layout we tried to restore (so it
  // covers the layout-not-ready-yet case too).
  if (!persistedLayoutHasPanel(SESSIONS_PANEL_ID)) {
    // Defer until the dockview api is up (`onDockReady` will run by
    // then, but we mounted before the child component, so check via
    // the store getter rather than assuming).
    setTimeout(openSessionsByDefault, 0);
  }

  // Dev-only: auto-create a session when none exist and the URL carries
  // `?autosession=1`. Used by the typing diagnostic flow so we can see
  // the composer mount without manually clicking "New Session". One-shot
  // per page load; will not loop on HMR refreshes.
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("autosession")
  ) {
    setTimeout(() => {
      if (sessionsStore.sessions.length === 0) {
        void sessionsStore.createSession().then((r) => {
          if (r) layoutStore.addPanel(r.id);
        });
      }
    }, 500);
  }
});

/// Resumes each session id referenced by the persisted dockview JSON,
/// then applies the JSON via `layoutStore.restore()` if at least one
/// resume succeeded. The dockview side won't be `@ready` yet on
/// startup, so we defer the actual `fromJSON` until the api shows up
/// (`onDockReady` will check this).
const pendingRestoreLayout = ref<unknown | null>(null);

async function restoreFromLayout() {
  const layout = settingsStore.settings.layout?.dockview;
  if (!layout || typeof layout !== "object") return;
  const panelIds = extractPanelIds(layout);
  if (panelIds.length === 0) return;
  // Best-effort resume each session referenced by the layout. Failures
  // are non-fatal — the panel still shows up (dockview replays it from
  // the JSON below) but with no `SessionRecord` behind it; ChatPanel
  // renders a friendly "session no longer available" surface with a
  // button to spawn a replacement in the same tab.
  await Promise.all(
    panelIds.map((id) => sessionsStore.restoreSession(id)),
  );
  // Always apply the full layout, even when no sessions resumed —
  // preserving the user's grid layout is more important than hiding
  // dead panels (and the orphan UI gives them a one-click recovery
  // path). See `ChatPanel.vue`.
  if (layoutStore.api) {
    layoutStore.restore(layout);
  } else {
    pendingRestoreLayout.value = layout;
  }
}

/// Extract panel ids from a dockview `toJSON()` blob. The shape is
/// `{ panels: Record<panelId, ...>, ... }`. We treat it opaquely
/// elsewhere; this is the one place we peek inside.
function extractPanelIds(layout: unknown): string[] {
  if (!layout || typeof layout !== "object") return [];
  const panels = (layout as { panels?: unknown }).panels;
  if (!panels || typeof panels !== "object") return [];
  return Object.keys(panels);
}

watch(isDarkMode, (next) => applyThemeClass(next), { immediate: true });

// Drain queued toasts into PrimeVue's service. Stores can `push` without a
// component context; this watcher is the only place that talks to PrimeVue.
watch(
  () => toastStore.pending.length,
  (len) => {
    if (len === 0) return;
    for (const msg of toastStore.consume()) {
      primeToast.add({
        severity: msg.severity,
        summary: msg.summary,
        detail: msg.detail,
        life: msg.life,
      });
    }
  },
);

function closeToast({ message }: { message: ToastMessageOptions }) {
  primeToast.remove(message);
}

/// Keep each dockview tab's title in sync with both the SDK-supplied
/// `session.title_changed` value and the session's workspace path. The
/// composed title leads with the workspace basename — it's the most
/// recognisable label, especially before the model has auto-summarised
/// the conversation — followed by the SDK title (`folder · title`).
watch(
  () =>
    sessions.value.map(
      (s) => [s.id, s.title, s.workingDirectory] as const,
    ),
  (entries) => {
    for (const [id, title, wd] of entries) {
      layoutStore.renamePanel(id, composePanelTitle(id, title, wd));
    }
  },
  { deep: true },
);

function onDockReady(event: DockviewReadyEvent) {
  layoutStore.setApi(event.api);
  // Whenever the user closes a tab via dockview's own X (we hide the
  // in-pane close button to keep a single source of truth), tear down
  // the underlying session too. closeSession is idempotent and safe to
  // call even if the session is already gone.
  event.api.onDidRemovePanel((panel) => {
    // Capture the parent group id BEFORE the panel is fully torn down
    // — at this point the panel still has its `api.group` reference,
    // but its `group.panels.length` reflects the post-removal count.
    const groupId = panel.api.group.id;
    if (sessionsStore.sessions.some((s) => s.id === panel.id)) {
      void sessionsStore.closeSession(panel.id);
    }
    // If this panel was the last one in its edge group (e.g. user
    // closed the Sessions sidebar via dockview's own X), tear down
    // the edge group too so the next open recreates at the
    // configured `initialSize` instead of inheriting a residual
    // sliver. Safe to call for body groups: it's a no-op when the
    // group isn't an edge group.
    layoutStore.pruneEmptyEdgeGroup(groupId);
  });
  // If startup-resume already produced a pruned layout, hand it over
  // now that the api is alive. Done before subscribing to layout
  // changes so the restore itself doesn't trigger a write.
  if (pendingRestoreLayout.value) {
    layoutStore.restore(pendingRestoreLayout.value);
    pendingRestoreLayout.value = null;
  }
  // Persist on every layout change (debounced). Covers add/remove/
  // resize/move/popout/dock — everything dockview considers a layout
  // mutation collapses into this single event.
  event.api.onDidLayoutChange(() => {
    scheduleLayoutSave();
    // Keep the topbar button state in sync with reality (panel closed
    // via dockview X, restored from layout, dragged out, etc.).
    sessionsPanelOpen.value = layoutStore.isPanelOpen(SESSIONS_PANEL_ID);
  });
}

/// Debounced write — drag-resize fires `onDidLayoutChange` continuously
/// at frame rate; we coalesce into one settings write per ~300ms.
let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLayoutSave() {
  if (layoutSaveTimer !== null) clearTimeout(layoutSaveTimer);
  layoutSaveTimer = setTimeout(() => {
    layoutSaveTimer = null;
    void settingsStore.persistLayout(layoutStore.snapshot());
  }, 300);
}

// Inline new-session controls (no dialog) — the path lives in the
// topbar so creating sessions in different workspaces is a one-step
// flow. The AutoComplete suggests from `settings.workspaces.recent`,
// which is persisted across runs by `settingsStore.recordWorkspaceUse`.
const workspaceDraft = ref("");
const workspaceSuggestions = ref<string[]>([]);
const isPickingFolder = ref(false);

const recentWorkspaces = computed(
  () => settings.value.workspaces?.recent ?? [],
);

// Pre-fill the workspace input with the last-used path so quick
// repeat creates don't make the user retype or repick. We seed once
// per page load after settings finish loading; subsequent edits by
// the user aren't clobbered (the watcher fires only on the empty →
// non-empty transition).
watch(
  recentWorkspaces,
  (next) => {
    if (workspaceDraft.value === "" && next.length > 0) {
      workspaceDraft.value = next[0];
    }
  },
  { immediate: true },
);

function onSearchWorkspaces(event: AutoCompleteCompleteEvent) {
  const query = (event.query ?? "").trim().toLowerCase();
  const recent = recentWorkspaces.value;
  if (!query) {
    workspaceSuggestions.value = [...recent];
    return;
  }
  workspaceSuggestions.value = recent.filter((p) =>
    p.toLowerCase().includes(query),
  );
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

async function onConfirmCreateSession() {
  const wd = workspaceDraft.value.trim();
  try {
    const record = await sessionsStore.createSession(
      wd ? { workingDirectory: wd } : {},
    );
    if (record) {
      // Fire-and-forget MRU bump. Failures only get a toast; the
      // session itself is already created and visible.
      if (wd) void settingsStore.recordWorkspaceUse(wd);
      layoutStore.addPanel(record.id, {
        title: composePanelTitle(record.id, record.title, record.workingDirectory),
      });
    }
  } catch {
    /* toast already shown */
  }
}

// Sessions Manager — left edge-group panel toggle. Track open state
// separately so the toolbar button can show a pressed state; we sync
// in onDockReady's layout-change subscription so reopens-from-layout
// (and tab-X closes) keep the ref accurate.
const SESSIONS_PANEL_ID = "sessions-manager";
const sessionsPanelOpen = ref(false);

function toggleSessionsPanel() {
  if (layoutStore.isPanelOpen(SESSIONS_PANEL_ID)) {
    layoutStore.closePanel(SESSIONS_PANEL_ID);
    sessionsPanelOpen.value = false;
  } else {
    layoutStore.openEdgePanel("left", {
      id: SESSIONS_PANEL_ID,
      component: "sessionsManager",
      tabComponent: "sidebarTab",
      title: "Sessions",
      initialSize: 280,
    });
    sessionsPanelOpen.value = true;
  }
}

/// Returns true when the persisted dockview JSON references the
/// given panel id. Used by the "open by default" path to avoid
/// re-opening a panel the user explicitly closed last time.
function persistedLayoutHasPanel(id: string): boolean {
  const layout = settingsStore.settings.layout?.dockview;
  if (!layout || typeof layout !== "object") return false;
  const panels = (layout as { panels?: unknown }).panels;
  if (!panels || typeof panels !== "object") return false;
  return Object.prototype.hasOwnProperty.call(panels, id);
}

/// Opens the Sessions panel as the default sidebar on first launch.
/// Retries briefly if the dockview api isn't up yet — the @ready
/// event fires from the child component's onMounted, which races
/// with our parent onMounted.
function openSessionsByDefault(attempt = 0) {
  if (!layoutStore.api) {
    if (attempt < 20) {
      setTimeout(() => openSessionsByDefault(attempt + 1), 50);
    }
    return;
  }
  if (layoutStore.isPanelOpen(SESSIONS_PANEL_ID)) return;
  layoutStore.openEdgePanel("left", {
    id: SESSIONS_PANEL_ID,
    component: "sessionsManager",
    tabComponent: "sidebarTab",
    title: "Sessions",
    initialSize: 280,
  });
  sessionsPanelOpen.value = true;
}
</script>

<template>
  <main class="app-root" :class="{ 'app-dark': isDarkMode }">
    <Toast :on-click="closeToast" />
    <SettingsDialog
      :visible="settingsOpen"
      @update:visible="(v) => (settingsOpen = v)"
    />
    <div class="topbar">
      <form class="topbar-actions new-session-form" @submit.prevent="onConfirmCreateSession">
        <AutoComplete
          v-model="workspaceDraft"
          :suggestions="workspaceSuggestions"
          :complete-on-focus="true"
          placeholder="Workspace (defaults to cwd)"
          aria-label="Workspace folder for the next session"
          class="workspace-input"
          :disabled="!clientReady"
          @complete="onSearchWorkspaces"
        />
        <Button
          type="button"
          icon="pi pi-folder-open"
          severity="secondary"
          aria-label="Pick folder"
          title="Pick folder"
          :loading="isPickingFolder"
          :disabled="!clientReady"
          @click="onPickFolder"
        />
        <Button
          type="submit"
          label="New Session"
          icon="pi pi-plus"
          :loading="isCreatingSession || (isCreatingClient && !clientReady)"
          :disabled="!clientReady"
        />
      </form>
      <div class="topbar-right">
        <Button
          icon="pi pi-list"
          severity="secondary"
          text
          rounded
          aria-label="Sessions manager"
          title="Sessions manager"
          :class="{ 'is-active-toggle': sessionsPanelOpen }"
          :disabled="!clientReady"
          @click="toggleSessionsPanel"
        />
        <Button
          v-if="isDev"
          icon="pi pi-wrench"
          severity="secondary"
          text
          rounded
          aria-label="Open dev playground"
          title="Open dev playground"
          @click="openPlayground"
        />
        <Button
          icon="pi pi-cog"
          severity="secondary"
          text
          rounded
          aria-label="Open settings"
          @click="settingsOpen = true"
        />
      </div>
    </div>

    <div
      class="dock-wrapper"
      :class="isDarkMode ? 'dockview-theme-dark' : 'dockview-theme-light'"
    >
      <DockviewVue
        class="dock"
        watermark-component="watermark"
        right-header-actions-component="chatTabActions"
        default-tab-component="chatTab"
        @ready="onDockReady"
      />
    </div>
  </main>
</template>

<style scoped>
.app-root {
  height: 100dvh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--p-surface-100);
  color: var(--p-text-color);
}

.app-root.app-dark {
  background: var(--p-surface-950);
}

.topbar {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  /* Slim app-chrome strip — global actions only. All functional UI
   * (recent sessions, permission queue, log viewer, MCP status, …)
   * goes inside dockview as panels / edge groups (see layoutStore). */
  border-bottom: 1px solid var(--p-content-border-color);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Pressed-state for toggle buttons (Sessions panel). PrimeVue's `text`
 * Button has no built-in "active" variant, so we tint it ourselves
 * with a theme-aware mix. */
.topbar-right :deep(.p-button.is-active-toggle) {
  background: color-mix(in srgb, var(--p-text-color) 12%, transparent);
  color: var(--p-text-color);
}

.dock-wrapper {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  min-width: 0;
}

.dock {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}

.new-session-form {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: 1 1 auto;
  min-width: 0;
}

.workspace-input {
  flex: 1 1 24rem;
  min-width: 12rem;
  max-width: 36rem;
}

.workspace-input :deep(.p-autocomplete-input) {
  width: 100%;
  font-size: 0.85rem;
}
</style>
