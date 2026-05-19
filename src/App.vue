<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import type { ToastMessageOptions } from "primevue/toast";
import { DockviewVue, type DockviewReadyEvent } from "dockview-vue";
import ActivityBar, { type ActivityItem } from "./components/ActivityBar.vue";
import BootSplash from "./components/BootSplash.vue";
import CommandPalette from "./components/CommandPalette.vue";
import PendingRequestModal from "./components/PendingRequestModal.vue";
import { useClientStore } from "./stores/clientStore";
import { useSessionsStore } from "./stores/sessionsStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useToastStore } from "./stores/toastStore";
import { useLayoutStore, composePanelTitle } from "./stores/layoutStore";
import { useModelsStore } from "./stores/modelsStore";
import { useBootStore } from "./stores/bootStore";
import { useConfirm } from "primevue/useconfirm";
import ConfirmDialog from "primevue/confirmdialog";
import { resolveIsDark } from "./lib/theme";
import { registerBuiltinCommands } from "./lib/registerBuiltinCommands";

const clientStore = useClientStore();
const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const toastStore = useToastStore();
const layoutStore = useLayoutStore();
const modelsStore = useModelsStore();
const bootStore = useBootStore();
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
    existing.api.setActive();
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
      const message = err instanceof Error ? err.message : String(err);
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
  await restoreFromLayout();

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

  // Dev-only: auto-create a session when none exist and the URL
  // carries `?autosession=1`. One-shot per page load; will not loop
  // on HMR refreshes.
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
  const sanitized = stripPanelFromLayout(layout, SETTINGS_PANEL_ID);
  const sessionIds = extractChatPanelIds(sanitized);
  if (sessionIds.length === 0) {
    if (layoutStore.api) {
      layoutStore.restore(sanitized);
    } else {
      pendingRestoreLayout.value = sanitized;
    }
    return;
  }
  // Flip the boot store into "sessions" phase so the splash status
  // text becomes "Restoring sessions… N of M". Each restoreSession
  // bumps the counter when it settles (success or failure).
  bootStore.beginSessions(sessionIds.length);
  await Promise.all(
    sessionIds.map((id) =>
      sessionsStore
        .restoreSession(id)
        .finally(() => bootStore.markSessionRestored()),
    ),
  );
  // Yield a frame so the splash can paint "N of N" before we
  // start the heavy `dockview.fromJSON` + panel mount work — that
  // single synchronous burst can take hundreds of milliseconds and
  // would otherwise look like a freeze on top of "0 of N".
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => resolve()),
  );
  bootStore.beginApplying();
  // Yield once more so the "Applying layout…" status paints before
  // the synchronous block.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => resolve()),
  );
  // Always apply the full layout, even when no sessions resumed —
  // preserving the user's grid layout is more important than hiding
  // dead panels (and the orphan UI gives them a one-click recovery
  // path). See `ChatPanel.vue`.
  if (layoutStore.api) {
    layoutStore.restore(sanitized);
  } else {
    pendingRestoreLayout.value = sanitized;
  }
}

/// Returns a shallow copy of a dockview layout JSON with the given
/// panel id removed from `panels`, and pruned from any group's
/// `data.views` so dockview doesn't error on a dangling reference.
/// Other fields are left untouched. Pure: never mutates the input.
function stripPanelFromLayout(layout: unknown, panelId: string): unknown {
  if (!layout || typeof layout !== "object") return layout;
  const obj = layout as Record<string, unknown>;
  const panels = obj.panels;
  if (!panels || typeof panels !== "object") return layout;
  if (!Object.prototype.hasOwnProperty.call(panels, panelId)) return layout;
  const nextPanels: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(panels as Record<string, unknown>)) {
    if (k !== panelId) nextPanels[k] = v;
  }
  // Walk the grid + edge groups and remove the id from each group's
  // views list. Dockview stores groups under `grid.root.data` (tree)
  // and `floatingGroups` / edge groups under top-level arrays — but
  // a JSON-walk over all "views: string[]" arrays is the robust path
  // that doesn't depend on which exact slot the panel was in.
  const stripViews = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(stripViews);
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "views" && Array.isArray(v)) {
        next[k] = (v as unknown[]).filter((x) => x !== panelId);
      } else {
        next[k] = stripViews(v);
      }
    }
    return next;
  };
  const stripped = stripViews({ ...obj, panels: nextPanels });
  return stripped;
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
    sessions.value.map((s) => [s.id, s.title] as const),
  (entries) => {
    for (const [id, title] of entries) {
      layoutStore.renamePanel(id, composePanelTitle(id, title));
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
    // Settings rows pack an input + 2 icon buttons + a "Request
    // permission" button — 280 px clipped the right edge in
    // practice. 340 / 300 fits comfortably and still leaves the
    // body group ~60 % of a 1280 px viewport.
    initialSize: 340,
    minimumSize: 300,
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
    <ConfirmDialog />
    <!-- Command palette: global Ctrl/Cmd+K overlay. Mounted once at
         the app root so the listener is alive regardless of which
         panel has focus. -->
    <CommandPalette />
    <!-- Pending-request modal: opens whenever any session has a
         pending SDK callback (permission / user_input / elicitation).
         Lives at app-root so requests on non-active panels can still
         be answered; the modal auto-activates the owning panel so
         the user has chat context behind it. -->
    <PendingRequestModal />
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
