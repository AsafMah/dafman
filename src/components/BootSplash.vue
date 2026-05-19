<script setup lang="ts">
// Full-screen splash overlay shown during startup. Catches all input
// so the user can't fire actions against a not-yet-alive client.
// Fades out cleanly once `bootStore.isBooting` flips false.
//
// Status text + progress come from `bootStore.statusText`, which
// reflects the slowest active phase (settings / client / session
// restore with `n of m` count).

import { computed } from "vue";
import { useBootStore } from "../stores/bootStore";
import { useSettingsStore } from "../stores/settingsStore";
import { resolveIsDark } from "../lib/theme";
import { ref, onMounted, onBeforeUnmount } from "vue";

const bootStore = useBootStore();
const settingsStore = useSettingsStore();

const prefersDark = ref(false);

onMounted(() => {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  prefersDark.value = mql.matches;
  const onChange = (e: MediaQueryListEvent) => {
    prefersDark.value = e.matches;
  };
  mql.addEventListener("change", onChange);
  onBeforeUnmount(() => mql.removeEventListener("change", onChange));
});

/// Whether we should render dark-mode chrome on the splash. Settings
/// may not have loaded yet (that's literally what the splash is
/// covering), so fall back to the OS preference.
const isDark = computed(() => {
  if (!settingsStore.loaded) return prefersDark.value;
  return resolveIsDark(
    settingsStore.settings.appearance.theme,
    prefersDark.value,
  );
});

const showProgressBar = computed(
  () => bootStore.phase === "sessions" && bootStore.sessionsTotal > 0,
);

const progressPct = computed(() => {
  if (bootStore.sessionsTotal === 0) return 0;
  return Math.min(
    100,
    Math.round((bootStore.sessionsRestored / bootStore.sessionsTotal) * 100),
  );
});

function reload() {
  window.location.reload();
}
</script>

<template>
  <Transition name="boot-fade">
    <div
      v-if="bootStore.isBooting"
      class="boot-splash"
      :class="{ 'app-dark': isDark }"
      role="status"
      aria-live="polite"
      :aria-busy="bootStore.phase !== 'failed'"
    >
      <div class="boot-card">
        <div class="boot-brand">
          <i class="pi pi-prime boot-icon" aria-hidden="true" />
          <h1 class="boot-title">Dafman</h1>
        </div>

        <div v-if="bootStore.phase === 'failed'" class="boot-error">
          <i class="pi pi-exclamation-triangle" aria-hidden="true" />
          <p class="boot-status">{{ bootStore.statusText }}</p>
          <p class="boot-error-detail" v-if="bootStore.error">
            {{ bootStore.error }}
          </p>
          <button type="button" class="boot-reload" @click="reload">
            Reload
          </button>
        </div>

        <template v-else>
          <div class="boot-spinner" aria-hidden="true">
            <i class="pi pi-spin pi-spinner" />
          </div>
          <p class="boot-status">{{ bootStore.statusText }}</p>
          <div v-if="showProgressBar" class="boot-progress">
            <div
              class="boot-progress-fill"
              :style="{ width: `${progressPct}%` }"
            />
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.boot-splash {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--p-content-background);
  color: var(--p-text-color);
}

.boot-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  padding: 2.5rem 3rem;
  text-align: center;
  max-width: 28rem;
}

.boot-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.boot-icon {
  font-size: 2rem;
  color: var(--p-primary-color);
}

.boot-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.boot-spinner {
  font-size: 1.5rem;
  color: var(--p-primary-color);
}

.boot-status {
  margin: 0;
  font-size: 0.95rem;
  color: var(--p-text-muted-color);
}

.boot-progress {
  width: 18rem;
  max-width: 100%;
  height: 4px;
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  border-radius: 2px;
  overflow: hidden;
}

.boot-progress-fill {
  height: 100%;
  background: var(--p-primary-color);
  transition: width 200ms ease;
}

.boot-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  color: var(--p-text-color);
}

.boot-error .pi-exclamation-triangle {
  font-size: 1.75rem;
  color: var(--p-red-500, #ef4444);
}

.boot-error-detail {
  margin: 0;
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
  max-width: 24rem;
  white-space: pre-wrap;
}

.boot-reload {
  margin-top: 0.5rem;
  padding: 0.45rem 1rem;
  font: inherit;
  font-size: 0.9rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, white);
  cursor: pointer;
}

.boot-reload:hover {
  filter: brightness(1.05);
}

.boot-fade-leave-active {
  transition: opacity 240ms ease;
}

.boot-fade-leave-to {
  opacity: 0;
}
</style>
