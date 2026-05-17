<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import type { ToastMessageOptions } from "primevue/toast";
import ChatWindow from "./components/ChatWindow.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import { useClientStore } from "./stores/clientStore";
import { useSessionsStore } from "./stores/sessionsStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useToastStore } from "./stores/toastStore";
import { resolveIsDark } from "./lib/theme";

const clientStore = useClientStore();
const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();
const toastStore = useToastStore();
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
  // Auto-start the SDK client so the user is one click away from
  // creating a session. Errors are surfaced via the toast store; the
  // user can retry via the Create Session button (which stays disabled
  // until the client is ready).
  try {
    await clientStore.createClient();
  } catch {
    /* toast already shown */
  }
});

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

async function onCreateSession() {
  try {
    await sessionsStore.createSession();
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

    <div v-if="sessions.length > 0" class="session-grid">
      <ChatWindow
        v-for="session in sessions"
        :key="session.id"
        :session-id="session.id"
        :accent="session.accent"
        :events="session.events"
        :model="session.model"
        :reasoning-effort="session.reasoningEffort"
        @close="sessionsStore.closeSession(session.id)"
      />
    </div>
    <div v-else class="placeholder">
      <template v-if="!clientReady">Starting Copilot client...</template>
      <template v-else>
        Click <strong>&nbsp;New Session&nbsp;</strong> to start chatting.
      </template>
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
  gap: 0.75rem;
  padding: 0.75rem 1rem 0;
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
  gap: 0.75rem;
}

.session-grid {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
  grid-auto-rows: 1fr;
  gap: 0.75rem;
  padding: 0.75rem 1rem 1rem;
  overflow: auto;
  min-width: 0;
}

.placeholder {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-text-muted-color);
  padding: 1rem;
}
</style>
