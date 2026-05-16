<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import Button from "primevue/button";
import Tag from "primevue/tag";
import ToggleSwitch from "primevue/toggleswitch";
import ChatWindow from "./components/ChatWindow.vue";

const isDarkMode = ref(false);
const sessionIds = ref<string[]>([]);
const clientReady = ref(false);
const statusMessage = ref<string>("");
const isCreatingClient = ref(false);
const isCreatingSession = ref(false);

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

async function createClient() {
  isCreatingClient.value = true;
  try {
    statusMessage.value = await invoke<string>("create_client");
    clientReady.value = true;
  } catch (error) {
    statusMessage.value = `Error: ${String(error)}`;
  } finally {
    isCreatingClient.value = false;
  }
}

async function createSession() {
  isCreatingSession.value = true;
  try {
    const id = await invoke<string>("create_session");
    sessionIds.value.push(id);
    statusMessage.value = `Session created`;
  } catch (error) {
    statusMessage.value = `Error: ${String(error)}`;
  } finally {
    isCreatingSession.value = false;
  }
}

async function closeSession(id: string) {
  try {
    await invoke<string>("disconnect_session", { sessionId: id });
  } catch (error) {
    statusMessage.value = `Error closing session: ${String(error)}`;
  } finally {
    sessionIds.value = sessionIds.value.filter((s) => s !== id);
  }
}
</script>

<template>
  <main class="app-root" :class="{ 'app-dark': isDarkMode }">
    <div class="topbar">
      <div class="topbar-actions">
        <Button
          label="Create Client"
          icon="pi pi-play"
          :loading="isCreatingClient"
          :disabled="clientReady"
          @click="createClient"
        />
        <Button
          label="Create Session"
          icon="pi pi-plus"
          severity="secondary"
          :loading="isCreatingSession"
          :disabled="!clientReady"
          @click="createSession"
        />
        <Tag v-if="statusMessage" :value="statusMessage" severity="info" />
      </div>
      <div class="mode-toggle">
        <span>Dark mode</span>
        <ToggleSwitch v-model="isDarkMode" />
      </div>
    </div>

    <div v-if="sessionIds.length > 0" class="session-grid">
      <ChatWindow
        v-for="id in sessionIds"
        :key="id"
        :session-id="id"
        @close="closeSession(id)"
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