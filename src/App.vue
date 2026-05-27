<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import Toast, { type ToastMessageOptions } from 'primevue/toast';
import { useToast } from 'primevue/usetoast';
import { DockviewVue, type DockviewReadyEvent } from 'dockview-vue';
import BootSplash from '@/components/shell/BootSplash.vue';
import CommandPalette from '@/components/shell/CommandPalette.vue';
import StatusBar from '@/components/shell/StatusBar.vue';
import { useClientStore } from '@/stores/app/clientStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useToastStore } from '@/stores/app/toastStore';
import { useLayoutStore, composePanelTitle } from '@/stores/shell/layoutStore';
import { useGroupsStore } from '@/stores/shell/groupsStore';
import { useModelsStore } from '@/stores/library/modelsStore';
import { useBootStore } from '@/stores/app/bootStore';
// jobsStore was used by the outer onDidRemovePanel session-busy check;
// in v3 chat panels live in inner dockviews so that handler moved to
// GroupPanel and the busy-toast UX is currently disabled. Re-add the
// busy check inside GroupPanel.onInnerReady if M7 surfaces complaints.
// import { useJobsStore } from '@/stores/observability/jobsStore';
import { useConfirm } from 'primevue/useconfirm';
import ConfirmDialog from 'primevue/confirmdialog';
import { resolveIsDark } from '@/lib/theme';
import { registerBuiltinCommands } from '@/lib/registerBuiltinCommands';
import { on as busOn } from '@/lib/bus';
import { isActivityBarPanel } from '@/constants/panels';
import { useBootLayout } from '@/lib/bootLayout';
import { schedulePersist, cancelPendingPersist } from '@/lib/persistScheduler';
import { toErrorMessage } from '@/lib/errorMessage';

const clientStore = useClientStore();
const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const toastStore = useToastStore();
const layoutStore = useLayoutStore();
const groupsStore = useGroupsStore();
const modelsStore = useModelsStore();
const bootStore = useBootStore();
const primeToast = useToast();
const primeConfirm = useConfirm();

const { sessions } = storeToRefs(sessionsStore);
const { settings } = storeToRefs(settingsStore);

const prefersDark = ref(false);

const PLAYGROUND_PANEL_ID = 'playground';

/// Opens the Settings panel. v2 keeps Settings as a left-edge
/// activity-bar tab — clicking the status-bar cog toggles it via
/// the same `activateEdgePanel` path used by the rail click and
/// the command palette.
function openSettings() {
  layoutStore.toggleSettings();
}

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
    (g) => (g as unknown as { location?: { type?: string } }).location?.type === 'grid',
  );
  const referenceGroup = bodyGroups[0]?.id ?? dock.addGroup().id;

  dock.addPanel({
    id: PLAYGROUND_PANEL_ID,
    component: 'playground',
    title: 'Dev Playground',
    position: { referenceGroup, direction: 'within' },
  });
}

const isDarkMode = computed(() =>
  resolveIsDark(settings.value.appearance.theme, prefersDark.value),
);

function applyThemeClass(isDark: boolean) {
  document.documentElement.classList.toggle('app-dark', isDark);
}

// Focus-session handler for OS notification clicks. Subscribed via
// the typed app bus inside onMounted; cleanup is stored at script
// scope so onBeforeUnmount can call it.
let offFocusSession: (() => void) | null = null;

function handleFocusSession({ sessionId }: { sessionId: string }): void {
  if (!sessionId) return;

  const dock = layoutStore.api;
  const panel = dock?.getPanel(sessionId);

  panel?.api.setActive();
}

onBeforeUnmount(() => {
  offFocusSession?.();
  offFocusSession = null;
  // Cancel any pending layout-persist debounce so it doesn't fire
  // against a stale store after the component teardown (matters in
  // HMR + test scenarios — code-review finding 2026-05-27).
  cancelPendingPersist();
});

onMounted(async () => {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');

  prefersDark.value = mql.matches;
  mql.addEventListener('change', (e) => {
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
    if (bootStore.isBooting && bootStore.phase !== 'failed') {
      console.error(
        `[boot] watchdog: splash still up after ${SPLASH_WATCHDOG_MS}ms, forcing ready`,
      );
      toastStore.warn(
        'Startup took too long',
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
    .catch((err: unknown) => {
      // Don't fail the whole boot for settings — the defaults are
      // good enough to get the user into the app. Toast already
      // surfaced by the store.
      bootStore.markSettingsLoaded();
      console.error('[boot] settings.load failed; continuing with defaults', err);

      return null;
    });

  const clientCreate = clientStore
    .createClient()
    .then(() => {
      bootStore.markClientReady();
    })
    .catch((err: unknown) => {
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
  console.info('[boot] starting restoreFromLayout');

  try {
    await restoreFromLayout();
  } catch (err) {
    const message = toErrorMessage(err);

    console.error('[App] restoreFromLayout threw — continuing to ready', err);
    toastStore.error(
      'Layout restore failed',
      `${message}. The app will load empty — your sessions are still in the catalog.`,
    );
  }

  // Open the Sessions Manager by default. We do this only when the
  // persisted dockview JSON didn't contain it — i.e. first launch, or
  // the user explicitly closed it last time we don't want to reopen it.
  //
  // Removed in v2: the activity-bar tabs are now seeded permanently,
  // so the user clicks Sessions in the rail to open. No auto-open.

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
  // emits `focus-session` on the app bus from a Notification's
  // onclick; we activate the matching panel here. Window focus is
  // already attempted on the store side.
  offFocusSession = busOn('focus-session', handleFocusSession);

  // NOTE: cleanup is registered at top-level <script setup> scope
  // (not here) because onBeforeUnmount loses the component instance
  // after awaits inside onMounted.

  // Auto-create a session when none exist and the URL carries
  // `?autosession=1`. One-shot per page load; will not loop on HMR
  // refreshes. Available in prod too so the E2E harness can use it
  // without needing a separate `?dev` switch (the param is opt-in,
  // so production users never trigger it).
  if (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('autosession')
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

/// Layout-side pending state for the boot race lives in `useBootLayout`.
/// `restoreFromLayout` is called from `onMounted` (below) and the result of
/// the boot intent gets flushed in `onDockReady` once the dockview api is
/// available.
const { restoreFromLayout, flushPendingLayout } = useBootLayout();

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
  () => sessions.value.map((s) => [s.id, s.title] as const),
  (entries) => {
    for (const [id, title] of entries) {
      layoutStore.renamePanel(id, composePanelTitle(id, title));
    }
  },
  { deep: true, immediate: true },
);

function onDockReady(event: DockviewReadyEvent) {
  console.info('[boot] onDockReady fired');
  layoutStore.setApi(event.api);
  // Wire layoutStore -> sessionsStore title lookup via a callback so
  // layoutStore doesn't need to import sessionsStore (would create a
  // circular import that previously needed a require() workaround).
  layoutStore.setSessionTitleResolver(
    (sessionId) => sessionsStore.getSession(sessionId)?.title ?? null,
  );
  // Whenever the user closes a tab via dockview's own X (we hide the
  // in-pane close button to keep a single source of truth), tear down
  // Per-inner dockviews handle chat-session lifecycle (closing the tab
  // there → closeSession). The OUTER handler now only cares about edge
  // panels and the rare case of a group panel being removed externally;
  // group panels are normally removed by GroupTab's X handler which has
  // already disposed inner cleanly.
  event.api.onDidRemovePanel((panel) => {
    const parentGroupId = panel.api.group.id;
    // If this panel was the last one in its edge group (e.g. user closed
    // the Sessions sidebar via dockview's own X), tear down the edge
    // group too so the next open recreates at the configured
    // `initialSize` instead of inheriting a residual sliver. Safe to
    // call for body groups: it's a no-op when the group isn't an edge
    // group.
    layoutStore.pruneEmptyEdgeGroup(parentGroupId);
  });

  // If startup-resume already produced a pruned layout, hand it over
  // now that the api is alive. Done before subscribing to layout
  // changes so the restore itself doesn't trigger a write.
  flushPendingLayout();

  // Consolidated drag-overlay policy on the OUTER dockview:
  //
  // 1. Activity-bar panels (Sessions / Terminals / Jobs / Logs /
  //    SessionDetails / Library) can only drop into another edge group's
  //    tab strip. Block body / floating / popout / split-an-edge-into-
  //    two-columns positions.
  //
  // 2. Group panels (v3 nested-dockview body panels) can only drop into
  //    the body tab strip — they're tabs at the top of the body, not a
  //    surface to split-screen sideways. Block edge + content drops.
  event.api.onWillShowOverlay((evt) => {
    const draggedPanel = evt.getData()?.panelId;

    if (!draggedPanel) return;

    const isActivity = isActivityBarPanel(draggedPanel);
    const isGroup = groupsStore.isGroupPanelId(draggedPanel);

    if (!isActivity && !isGroup) return;

    const targetLocation = evt.group?.api.location.type;
    const okKind = evt.kind === 'tab' || evt.kind === 'header_space';

    if (isActivity) {
      // Activity-bar panel: only land in another edge group's tab strip.
      const okTarget = targetLocation === 'edge';
      if (!(okKind && okTarget)) {
        evt.preventDefault();
      }
      return;
    }

    if (isGroup) {
      // Group panel: only reorder within the body tab strip. Reject any
      // 'edge' / 'content' drop (would split the body), and reject any
      // 'tab' / 'header_space' drop into an EDGE group (would stuff the
      // group panel into an activity-bar sidebar where it has no visible
      // chrome and the inner DockviewVue collapses to 0x0).
      const targetIsBody = targetLocation === 'grid';
      if (!okKind || !targetIsBody) {
        evt.preventDefault();
      }
    }
  });

  // One-shot rescue: older builds (or a stale persisted layout) could
  // leave chat panels stuck inside the Sessions sidebar's edge group,
  // where they have no tab/header chrome and look broken. Move any
  // such strays out to the body. Safe no-op when the layout is clean.
  layoutStore.rescueChatPanelsFromEdgeGroups();
  // Persist on every OUTER layout change (debounced). Inner dockviews
  // (each GroupPanel) subscribe to their own onDidLayoutChange and
  // also call schedulePersist — that path is what catches chat / terminal
  // panel add/remove inside groups.
  event.api.onDidLayoutChange(() => {
    layoutStore.enforceKnownEdgeMinimums();
    schedulePersist();
  });
}

// Activity-bar panel IDs — kept for the layout-sanitize call below
// (stripping legacy settings panel from old persisted JSON). The
// activity bar itself is gone in v2; tabs are seeded directly into
// dockview's edge groups by `layoutStore.seedDefaultLayout`.
</script>

<template>
  <main
    class="app-root"
    :class="{ 'app-dark': isDarkMode }"
  >
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

    <!-- App body: dockview workspace with native edge-group tab
         strips on the left (Sessions / Terminals / Jobs / Logs) and
         right (Session Details / Library). The strips are dockview's
         own vertical-tab rails — collapsed to 44 px until the user
         clicks a tab. Status bar pinned to the bottom for non-panel
         actions (Settings, dev wrench). -->
    <div class="app-body">
      <div
        class="dock-wrapper"
        :class="isDarkMode ? 'dockview-theme-dark' : 'dockview-theme-light'"
      >
        <DockviewVue
          class="dock"
          watermark-component="watermark"
          default-tab-component="chatTab"
          left-header-actions-component="groupsHeaderActions"
          @ready="onDockReady"
        />
      </div>
    </div>
    <StatusBar
      @open-settings="openSettings"
      @open-playground="openPlayground"
    />
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
