<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import ToggleSwitch from "primevue/toggleswitch";
import ChatWindow from "./components/ChatWindow.vue";
import { useClientStore } from "./stores/clientStore";
import { useSessionsStore } from "./stores/sessionsStore";
import { useToastStore } from "./stores/toastStore";

const isDarkMode = ref(false);

const clientStore = useClientStore();
const sessionsStore = useSessionsStore();
const toastStore = useToastStore();
const primeToast = useToast();

const { ready: clientReady, isCreating: isCreatingClient } = storeToRefs(clientStore);
const { sessions, isCreating: isCreatingSession } = storeToRefs(sessionsStore);

function applyThemeClass(isDark: boolean) {
  document.documentElement.classList.toggle("app-dark", isDark);
}

onMounted(() => {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  isDarkMode.value = prefersDark;
  applyThemeClass(prefersDark);
});

watch(isDarkMode, (nextValue) => {
  applyThemeClass(nextValue);
});

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

async function onCreateClient() {
  try {
    await clientStore.createClient();
  } catch {
    /* toast already shown */
  }
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
    <Toast />
    <div class="topbar">
      <div class="topbar-actions">
        <Button
          label="Create Client"
          icon="pi pi-play"
          :loading="isCreatingClient"
          :disabled="clientReady"
          @click="onCreateClient"
        />
        <Button
          label="Create Session"
          icon="pi pi-plus"
          severity="secondary"
          :loading="isCreatingSession"
          :disabled="!clientReady"
          @click="onCreateSession"
        />
      </div>
      <div class="mode-toggle">
        <span>Dark mode</span>
        <ToggleSwitch v-model="isDarkMode" />
      </div>
    </div>

    <div v-if="sessions.length > 0" class="session-grid">
      <ChatWindow
        v-for="session in sessions"
        :key="session.id"
        :session-id="session.id"
        :events="session.events"
        @close="sessionsStore.closeSession(session.id)"
      />
    </div>
    <div v-else class="placeholder">
      Create a client, then create a session to start chatting.
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

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.session-grid {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  grid-auto-rows: 1fr;
  gap: 0.75rem;
  padding: 0.75rem 1rem 1rem;
  overflow: auto;
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