<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import type { ToastMessageOptions } from "primevue/toast";
import { DockviewVue, type DockviewReadyEvent } from "dockview-vue";
import ActivityBar, { type ActivityItem } from "./components/ActivityBar.vue";
import { useClientStore } from "./stores/clientStore";
import { useSessionsStore } from "./stores/sessionsStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useToastStore } from "./stores/toastStore";
import { useLayoutStore, composePanelTitle } from "./stores/layoutStore";
import { resolveIsDark } from "./lib/theme";

const clientStore = useClientStore();
const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const toastStore = useToastStore();
const layoutStore = useLayoutStore();
const primeToast = useToast();

const { sessions } = storeToRefs(sessionsStore);
const { settings } = storeToRefs(settingsStore);

const prefersDark = ref(false);

// Dev playground is only built in dev mode; the action item is
// stripped from the ActivityBar in prod.
const isDev = import.meta.env.DEV;
const PLAYGROUND_PANEL_ID = "playground";

/// Opens the Dev Playground as a regular dockview body tab (not a
/// sidebar edge panel). Subsequent calls just focus the existing tab.
function openPlayground() {
  const dock = layoutStore.api;
  if (!dock) return;
  const existing = dock.getPanel(PLAYGROUND_PANEL_ID);
  if (existing) {
    existing.api.setActive();
    return;
  }
  dock.addPanel({
    id: PLAYGROUND_PANEL_ID,
    component: "playground",
    title: "Dev Playground",
  });
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
  const sessionIds = extractChatPanelIds(layout);
  if (sessionIds.length === 0) {
    // Even with no chat sessions to resume, hand the layout to
    // dockview so sidebar panels (Sessions / Settings) restore.
    if (layoutStore.api) {
      layoutStore.restore(layout);
    } else {
      pendingRestoreLayout.value = layout;
    }
    return;
  }
  // Best-effort resume each CLI-side session referenced by the layout.
  // Sidebar panel ids (sessions-manager, settings-panel, ...) are
  // filtered out of `sessionIds` already — we never ask the SDK to
  // resume those, which used to produce a flurry of spurious
  // "Session not restored" toasts on every reload.
  await Promise.all(
    sessionIds.map((id) => sessionsStore.restoreSession(id)),
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

/// Extract panel ids from a dockview `toJSON()` blob whose
/// `contentComponent` is `"chat"`. The layout shape is roughly
/// `{ panels: Record<panelId, { contentComponent, params, ... }>, ... }`.
/// We deliberately exclude sidebar / activity-bar panels (sessions-
/// manager, settings-panel) — those don't correspond to CLI sessions
/// and asking the SDK to resume them just produces error toasts.
function extractChatPanelIds(layout: unknown): string[] {
  if (!layout || typeof layout !== "object") return [];
  const panels = (layout as { panels?: unknown }).panels;
  if (!panels || typeof panels !== "object") return [];
  const out: string[] = [];
  for (const [id, entry] of Object.entries(
    panels as Record<string, unknown>,
  )) {
    if (!entry || typeof entry !== "object") continue;
    const component = (entry as { contentComponent?: unknown })
      .contentComponent;
    if (typeof component !== "string") continue;
    if (component !== "chat") continue;
    out.push(id);
  }
  return out;
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
  // One-shot rescue: older builds (or a stale persisted layout) could
  // leave chat panels stuck inside the Sessions sidebar's edge group,
  // where they have no tab/header chrome and look broken. Move any
  // such strays out to the body. Safe no-op when the layout is clean.
  layoutStore.rescueChatPanelsFromEdgeGroups();
  // Persist on every layout change (debounced). Covers add/remove/
  // resize/move/popout/dock — everything dockview considers a layout
  // mutation collapses into this single event.
  event.api.onDidLayoutChange(() => {
    scheduleLayoutSave();
    // Keep the ActivityBar's pressed-state in sync with reality
    // (panels closed via their in-panel X, restored from layout,
    // dragged into popouts, …).
    activityBarRef.value?.sync();
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

// Sessions Manager — left edge-group panel toggle. Owned by the
// ActivityBar; the SESSIONS_PANEL_ID constant is shared with the
// activity-item config below and with the open-by-default path.
const SESSIONS_PANEL_ID = "sessions-manager";
const SETTINGS_PANEL_ID = "settings-panel";

/// ActivityBar items.
/// - Top stack (default `group: "top"`): panel toggles. Sessions today;
///   Library / Log viewer / MCP status / ... append here.
/// - Bottom stack (`group: "bottom"`): settings panel + (dev-only) the
///   playground escape hatch. Settings is a panel like Sessions, not
///   a modal dialog — collapsible groups inside, future search across.
const activityItems = computed<ActivityItem[]>(() => {
  const items: ActivityItem[] = [
    {
      kind: "panel",
      id: SESSIONS_PANEL_ID,
      component: "sessionsManager",
      icon: "pi-list",
      title: "Sessions",
      initialSize: 240,
      minimumSize: 160,
    },
  ];
  if (isDev) {
    items.push({
      kind: "action",
      id: "playground",
      icon: "pi-wrench",
      title: "Open dev playground",
      group: "bottom",
      onClick: openPlayground,
    });
  }
  items.push({
    kind: "panel",
    id: SETTINGS_PANEL_ID,
    component: "settingsPanel",
    icon: "pi-cog",
    title: "Settings",
    group: "bottom",
    initialSize: 280,
    minimumSize: 200,
  });
  return items;
});

/// Ref to the ActivityBar so onDockReady can ask it to resync after
/// any layout change (covers panels closed via their own X, restored
/// from layout, etc.).
const activityBarRef = ref<InstanceType<typeof ActivityBar> | null>(null);

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
    initialSize: 240,
    minimumSize: 160,
  });
  activityBarRef.value?.sync();
}
</script>

<template>
  <main class="app-root" :class="{ 'app-dark': isDarkMode }">
    <Toast :on-click="closeToast" />

    <!-- App body: persistent ActivityBar on the far left + dockview
         body taking the rest. The ActivityBar hosts everything that
         used to live in the topbar (settings + dev wrench) plus the
         panel toggles. No topbar — the rail is the only chrome.
         Settings is a panel like Sessions, not a modal. -->
    <div class="app-body">
      <ActivityBar ref="activityBarRef" :items="activityItems" />
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

.app-body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  min-width: 0;
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
</style>
