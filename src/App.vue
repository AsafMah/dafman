<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import type { ToastMessageOptions } from "primevue/toast";
import { DockviewVue, type DockviewReadyEvent } from "dockview-vue";
import ActivityBar, { type ActivityItem } from "./components/ActivityBar.vue";
import GroupsBar from "./components/GroupsBar.vue";
import BootSplash from "./components/BootSplash.vue";
import CommandPalette from "./components/CommandPalette.vue";
import { useClientStore } from "./stores/clientStore";
import { useSessionsStore } from "./stores/sessionsStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useToastStore } from "./stores/toastStore";
import { useLayoutStore, composePanelTitle } from "./stores/layoutStore";
import { useModelsStore } from "./stores/modelsStore";
import { useBootStore } from "./stores/bootStore";
import { useJobsStore } from "./stores/jobsStore";
import { useGroupsStore } from "./stores/groupsStore";
import { useConfirm } from "primevue/useconfirm";
import ConfirmDialog from "primevue/confirmdialog";
import { resolveIsDark } from "./lib/theme";
import { registerBuiltinCommands } from "./lib/registerBuiltinCommands";
import {
  extractChatPanelIds,
  enforcePersistedEdgeMinimums,
  persistedLayoutHasPanel as persistedLayoutHasPanelImpl,
  stripLegacyDetailsPanels,
  stripPanelFromLayout,
} from "./lib/layoutSanitize";
import { toErrorMessage } from "./lib/errorMessage";

const clientStore = useClientStore();
const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const toastStore = useToastStore();
const layoutStore = useLayoutStore();
const modelsStore = useModelsStore();
const bootStore = useBootStore();
const jobsStore = useJobsStore();
const groupsStore = useGroupsStore();
const primeToast = useToast();
const primeConfirm = useConfirm();

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
    dock.removePanel(existing);
    return;
  }
  // Resolve a body (non-edge) group inline rather than going through
  // layoutStore — exposing a new store method mid-session breaks
  // Pinia's HMR, which left users on an older bundle staring at
  // `firstBodyGroupId is not a function`.
  const bodyGroups = dock.groups.filter(
    (g) => (g as unknown as { location?: { type?: string } }).location?.type === "grid",
  );
  const referenceGroup = bodyGroups[0]?.id ?? dock.addGroup().id;
  dock.addPanel({
    id: PLAYGROUND_PANEL_ID,
    component: "playground",
    title: "Dev Playground",
    position: { referenceGroup, direction: "within" },
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

  // Splash watchdog. Whatever happens below — uncaught rejection,
  // dockview throw, infinite await on a hung RPC — the splash MUST
  // dismiss quickly so the user can actually use the app. Normal
  // boot completes in <2 s; anything past 6 s is a bug, not a
  // legitimate slow load. Pushed down from 20 → 6 s because users
  // hit it repeatedly on commits that broke restoreFromLayout in
  // ways the catch arm couldn't cover (e.g. fromJSON throw
  // recovery still left the splash up because a downstream async
  // never settled).
  const SPLASH_WATCHDOG_MS = 6_000;
  const splashWatchdog = window.setTimeout(() => {
    if (bootStore.isBooting && bootStore.phase !== "failed") {
      console.error(
        `[boot] watchdog: splash still up after ${SPLASH_WATCHDOG_MS}ms, forcing ready`,
      );
      toastStore.warn(
        "Startup took too long",
        "The app loaded but something didn't finish. Try Reload Layout from the command palette if anything looks wrong.",
      );
      bootStore.markReady();
    }
  }, SPLASH_WATCHDOG_MS);

  // Settings + client load in parallel — they don't depend on each
  // other. Previously these were sequential, costing ~50-200 ms of
  // settings file I/O against the ~1-3 s CLI startup. We track each
  // independently so the BootSplash status text can flip to "Loading
  // settings…" if that piece is the only thing still pending (rare
  // — usually it finishes first).
  const settingsLoad = settingsStore
    .load()
    .then((s) => {
      bootStore.markSettingsLoaded();
      return s;
    })
    .catch((err) => {
      // Don't fail the whole boot for settings — the defaults are
      // good enough to get the user into the app. Toast already
      // surfaced by the store.
      bootStore.markSettingsLoaded();
      console.error("[boot] settings.load failed; continuing with defaults", err);
      return null;
    });

  const clientCreate = clientStore
    .createClient()
    .then(() => {
      bootStore.markClientReady();
    })
    .catch((err) => {
      const message = toErrorMessage(err);
      bootStore.markFailed(message);
      // Re-throw is unnecessary — Promise.all below will see the
      // failure via clientStore.ready remaining false.
    });

  await Promise.all([settingsLoad, clientCreate]);

  // If client failed, leave the splash up so the user sees the
  // error + reload button. They can't do anything useful without
  // the client anyway.
  if (!clientStore.ready) return;

  // Seed the command palette catalog. Static commands land
  // immediately; "Switch Model: …" entries fill in when
  // modelsStore.load() resolves (`watch(immediate)` re-fires on
  // each models[] mutation, registry replaces by id). Safe to call
  // before sessions restore — none of the commands run at register
  // time.
  registerBuiltinCommands({ confirm: primeConfirm });
  // Lazy model catalog warm-up so palette commands have entries to
  // surface without the user opening the per-session model picker
  // first. Failures are toasted by modelsStore itself.
  void modelsStore.load().catch(() => {
    /* toast already shown */
  });

  // Restore previously-open sessions. The resume calls fan out in
  // parallel (`Promise.all`); we report per-session completion to
  // the boot store so the splash can show "Restoring 3 of 5…"
  // without us threading progress through every layer.
  //
  // Wrapped in try/catch so a malformed persisted layout / SDK
  // rejection / dockview throw doesn't strand the splash on
  // "Restoring sessions…" / "Applying layout…" forever. We log,
  // toast, and continue to `markReady` — better to surface a
  // half-restored app the user can fix than to lock them out.
  console.info("[boot] starting restoreFromLayout");
  try {
    await restoreFromLayout();
  } catch (err) {
    const message = toErrorMessage(err);
    // eslint-disable-next-line no-console
    console.error("[App] restoreFromLayout threw — continuing to ready", err);
    toastStore.error(
      "Layout restore failed",
      `${message}. The app will load empty — your sessions are still in the catalog.`,
    );
  }

  // Open the Sessions Manager by default. We do this only when the
  // persisted dockview JSON didn't contain it — i.e. first launch, or
  // the user explicitly closed it last time we don't want to reopen it.
  if (!persistedLayoutHasPanel(SESSIONS_PANEL_ID)) {
    setTimeout(openSessionsByDefault, 0);
  }

  // Final yield: lets the just-mounted dockview panels paint at
  // least one frame before the splash fades out. Without this the
  // user briefly sees blank panels behind the fading splash.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  // Boot complete — splash fades out.
  bootStore.markReady();
  window.clearTimeout(splashWatchdog);

  // Click-on-OS-notification handler. The `notificationsStore`
  // dispatches `dafman:focus-session` from a Notification's onclick;
  // we activate the matching panel here. Window focus is already
  // attempted on the store side.
  window.addEventListener("dafman:focus-session", (e: Event) => {
    const detail = (e as CustomEvent<{ sessionId?: string }>).detail;
    if (!detail?.sessionId) return;
    const dock = layoutStore.api;
    const panel = dock?.getPanel(detail.sessionId);
    panel?.api.setActive();
  });

  // Auto-create a session when none exist and the URL carries
  // `?autosession=1`. One-shot per page load; will not loop on HMR
  // refreshes. Available in prod too so the E2E harness can use it
  // without needing a separate `?dev` switch (the param is opt-in,
  // so production users never trigger it).
  if (
    typeof window !== "undefined" &&
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
  // Hydrate groups from settings — creates "Default" group on migration
  groupsStore.hydrate(settingsStore.settings.layout);

  // Determine which layout to restore: active group's or legacy dockview
  const activeGroup = groupsStore.activeGroup;
  let rawLayout: unknown | null = null;
  if (activeGroup?.layout) {
    // Group-aware: merge body with empty edge state (edges auto-open later)
    rawLayout = activeGroup.layout;
  } else {
    rawLayout = settingsStore.settings.layout?.dockview;
  }
  if (!rawLayout || typeof rawLayout !== "object") {
    console.info("[boot] restoreFromLayout: no layout to restore");
    return;
  }
  const withoutLegacyDetails = stripLegacyDetailsPanels(rawLayout);
  const withoutSettings = stripPanelFromLayout(withoutLegacyDetails, SETTINGS_PANEL_ID);
  const sanitized = enforcePersistedEdgeMinimums(withoutSettings);
  const sessionIds = extractChatPanelIds(sanitized);
  console.info(
    `[boot] restoreFromLayout: ${sessionIds.length} chat sessions to resume`,
  );
  if (sessionIds.length === 0) {
    if (layoutStore.api) {
      const ok = layoutStore.restore(sanitized);
      if (!ok) layoutStore.resetToDefault();
    } else {
      pendingRestoreLayout.value = sanitized;
    }
    return;
  }
  bootStore.beginSessions(sessionIds.length);
  // Parallel resumes — safe again now that rpcGuard throws a real
  // Error (encoded AppErrorPayload). Previously this hung because
  // Electrobun's bridge drops non-Error throws (see src-bun/app/
  // errors.ts comment).
  await Promise.all(
    sessionIds.map((id) =>
      sessionsStore
        .restoreSession(id)
        .finally(() => bootStore.markSessionRestored()),
    ),
  );
  console.info("[boot] restoreFromLayout: all resumes settled, applying layout");
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => resolve()),
  );
  bootStore.beginApplying();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => resolve()),
  );
  if (layoutStore.api) {
    const ok = layoutStore.restore(sanitized);
    console.info(`[boot] restoreFromLayout: fromJSON ok=${ok}`);
    if (!ok) {
      // fromJSON threw — toast and fall back to a default layout
      // so the user has something to work with instead of a blank
      // window.
      useToastStore().warn(
        "Layout restore failed",
        "The persisted dockview JSON was rejected. Resetting to default.",
      );
      layoutStore.resetToDefault();
    }
  } else {
    pendingRestoreLayout.value = sanitized;
  }
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
    sessions.value.map((s) => [s.id, s.title] as const),
  (entries) => {
    for (const [id, title] of entries) {
      layoutStore.renamePanel(id, composePanelTitle(id, title));
    }
  },
  { deep: true, immediate: true },
);

function onDockReady(event: DockviewReadyEvent) {
  console.info("[boot] onDockReady fired");
  layoutStore.setApi(event.api);
  // Whenever the user closes a tab via dockview's own X (we hide the
  // in-pane close button to keep a single source of truth), tear down
  // the underlying session too. closeSession is idempotent and safe to
  // call even if the session is already gone.
  event.api.onDidRemovePanel((panel) => {
    // During a group switch, panels are removed by fromJSON — don't
    // close the underlying sessions.
    if (layoutStore.switching) return;
    // Capture the parent group id BEFORE the panel is fully torn down
    // — at this point the panel still has its `api.group` reference,
    // but its `group.panels.length` reflects the post-removal count.
    const groupId = panel.api.group.id;
    if (sessionsStore.sessions.some((s) => s.id === panel.id)) {
      const record = sessionsStore.getSession(panel.id);
      const sessionBusy =
        jobsStore.hasActiveJobsForSession(panel.id) ||
        record?.isThinking ||
        (record?.pendingRequests?.length ?? 0) > 0;
      if (sessionBusy) {
        toastStore.info(
          "Session detached",
          "Session is still busy. Reopen from the Sessions sidebar.",
        );
      } else {
        void sessionsStore.closeSession(panel.id);
      }
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
    const ok = layoutStore.restore(pendingRestoreLayout.value);
    if (!ok) layoutStore.resetToDefault();
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
    layoutStore.enforceKnownEdgeMinimums();
    layoutStore.rememberSessionDetailsWidth();
    scheduleLayoutSave();
    // Keep the ActivityBar's pressed-state in sync with reality
    // (panels closed via their in-panel X, restored from layout,
    // dragged into popouts, …).
    activityBarRef.value?.sync();
  });
}

/// Debounced write — drag-resize fires `onDidLayoutChange` continuously
/// at frame rate; we coalesce into one settings write per ~300ms.
/// Group-aware: saves the active group's body snapshot via groupsStore.
let layoutSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLayoutSave() {
  if (layoutSaveTimer !== null) clearTimeout(layoutSaveTimer);
  layoutSaveTimer = setTimeout(() => {
    layoutSaveTimer = null;
    if (groupsStore.groups.length > 0) {
      void groupsStore.saveLayout();
    } else {
      void settingsStore.persistLayout(layoutStore.snapshot());
    }
  }, 300);
}

// Sessions Manager — left edge-group panel toggle. Owned by the
// ActivityBar; the SESSIONS_PANEL_ID constant is shared with the
// activity-item config below and with the open-by-default path.
const SESSIONS_PANEL_ID = "sessions-manager";
const SETTINGS_PANEL_ID = "settings-panel";
const LOG_VIEWER_PANEL_ID = "log-viewer";
const LIBRARY_PANEL_ID = "library";
const JOBS_PANEL_ID = "jobs-panel";
const TERMINALS_PANEL_ID = "terminals-panel";

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
      initialSize: 260,
      minimumSize: 180,
    },
    {
      kind: "panel",
      id: TERMINALS_PANEL_ID,
      component: "terminalsPanel",
      icon: "pi-chevron-right",
      title: "Terminals — running shells",
      initialSize: 360,
      minimumSize: 320,
    },
    {
      kind: "panel",
      id: LIBRARY_PANEL_ID,
      component: "library",
      icon: "pi-book",
      title: "Library — MCP servers + Tools + Skills + Agents + Instructions",
      initialSize: 360,
      minimumSize: 320,
    },
    {
      kind: "panel",
      id: JOBS_PANEL_ID,
      component: "jobsPanel",
      icon: "pi-clock",
      title: "Jobs",
      initialSize: 380,
      minimumSize: 380,
      badge: jobsStore.activeCount > 0 ? jobsStore.activeCount : undefined,
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
    id: LOG_VIEWER_PANEL_ID,
    component: "logViewer",
    icon: "pi-bars",
    title: "Diagnostics — live log + bundle export",
    group: "bottom",
    initialSize: 480,
    minimumSize: 420,
  });
  items.push({
    kind: "panel",
    id: SETTINGS_PANEL_ID,
    component: "settingsPanel",
    icon: "pi-cog",
    title: "Settings",
    group: "bottom",
    // Settings rows pack an input + 2 icon buttons + a "Request
    // permission" button — 280 px clipped the right edge in
    // practice. 400 / 380 fits comfortably and still leaves the
    // body group ~60 % of a 1280 px viewport.
    initialSize: 400,
    minimumSize: 380,
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
  return persistedLayoutHasPanelImpl(settingsStore.settings.layout?.dockview, id);
}

/// Opens the Sessions panel as the default sidebar on first launch.
/// Retries briefly if the dockview api isn't up yet — the @ready
/// event fires from the child component's onMounted, which races
/// with our parent onMounted.
function openSessionsByDefault(attempt = 0) {
  if (!layoutStore.api) {
    if (attempt < 20) {
      setTimeout(() => openSessionsByDefault(attempt + 1), 50);
    } else {
      // U3: don't silently bail. If dockview's @ready never fires
      // after 20 * 50ms = 1s, the user gets a chrome-free renderer
      // with no Sessions panel. Surface the issue in the log so we
      // can diagnose from the in-app log viewer.
      console.warn(
        "[boot] openSessionsByDefault: dockview api never became ready after 20 retries; Sessions panel will not auto-open",
      );
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
    exclusive: true,
  });
  activityBarRef.value?.sync();
}
</script>

<template>
  <main class="app-root" :class="{ 'app-dark': isDarkMode }">
    <Toast :on-click="closeToast" />
    <ConfirmDialog />
    <!-- Command palette: global Ctrl/Cmd+K overlay. Mounted once at
         the app root so the listener is alive regardless of which
         panel has focus. -->
    <CommandPalette />
    <!-- Boot splash: catches input until settings + client are up
         and previously-open sessions have resumed. Fades on
         bootStore.markReady(); stays put with an error + reload
         button on bootStore.markFailed(). -->
    <BootSplash />

    <!-- App body: persistent ActivityBar on the far left + dockview
         body taking the rest. The ActivityBar hosts everything that
         used to live in the topbar (settings + dev wrench) plus the
         panel toggles. No topbar — the rail is the only chrome.
         Settings is a panel like Sessions, not a modal. -->
    <div class="app-body">
      <ActivityBar ref="activityBarRef" :items="activityItems" />
      <div class="dock-area">
        <GroupsBar />
        <div
          class="dock-wrapper"
          :class="isDarkMode ? 'dockview-theme-dark' : 'dockview-theme-light'"
        >
          <DockviewVue
            class="dock"
            watermark-component="watermark"
            default-tab-component="chatTab"
            @ready="onDockReady"
          />
        </div>
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

.dock-area {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
