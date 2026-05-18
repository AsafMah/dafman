<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
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
import { useLayoutStore, shortPanelTitle } from "./stores/layoutStore";
import { resolveIsDark } from "./lib/theme";

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

/// Keep each dockview tab's title in sync with the SDK-supplied
/// `session.title_changed` value. We watch the live `(id, title)` map
/// and call into the layout store on any delta.
watch(
  () => sessions.value.map((s) => [s.id, s.title] as const),
  (entries) => {
    for (const [id, title] of entries) {
      layoutStore.renamePanel(id, title ?? shortPanelTitle(id));
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
    if (sessionsStore.sessions.some((s) => s.id === panel.id)) {
      void sessionsStore.closeSession(panel.id);
    }
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
  event.api.onDidLayoutChange(() => scheduleLayoutSave());
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

async function onCreateSession() {
  try {
    const record = await sessionsStore.createSession();
    if (record) layoutStore.addPanel(record.id);
  } catch {
    /* toast already shown */
  }
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
      <div class="topbar-actions">
        <Button
          label="New Session"
          icon="pi pi-plus"
          :loading="isCreatingSession || (isCreatingClient && !clientReady)"
          :disabled="!clientReady"
          @click="onCreateSession"
        />
      </div>
      <div class="topbar-right">
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
