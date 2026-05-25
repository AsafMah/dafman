<script setup lang="ts">
// Full-screen splash overlay during startup. Catches all input so
// the user can't fire actions against a not-yet-alive client. Fades
// out cleanly once `bootStore.isBooting` flips false.
//
// **Anti-freeze design notes (from a user-reported regression):**
//
// During `dockview.fromJSON()` + panel mounting (the "applying"
// phase) the main JS thread is fully blocked for hundreds of ms.
// CSS animations run on the compositor thread *if* the element has
// its own compositor layer — we force one via `will-change:
// transform` on the spinner + indeterminate progress bar. Without
// this, both freeze during the heavy block and the user sees a
// dead UI.
//
// Status text + progress come from `bootStore.statusText`. The
// numeric N-of-M counter in the sessions phase is informational; we
// also draw a CSS-only "indeterminate shimmer" so the splash always
// has motion even when the counter is stuck (sessions tend to
// resolve in bursts, so the counter often jumps 0→N in microseconds
// of wall-clock time and reads as frozen).
//
// Teleported to body so it's outside the app's normal Vue subtree —
// keeps it from getting caught in any parent component's reactivity
// flush and lets it overlay popouts cleanly.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useBootStore } from '../stores/bootStore';
import { useSettingsStore } from '../stores/settingsStore';
import { resolveIsDark } from '../lib/theme';

const bootStore = useBootStore();
const settingsStore = useSettingsStore();

const prefersDark = ref(false);

onMounted(() => {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  prefersDark.value = mql.matches;
  const onChange = (e: MediaQueryListEvent) => {
    prefersDark.value = e.matches;
  };
  mql.addEventListener('change', onChange);
  onBeforeUnmount(() => mql.removeEventListener('change', onChange));
});

const isDark = computed(() => {
  if (!settingsStore.loaded) return prefersDark.value;
  return resolveIsDark(settingsStore.settings.appearance.theme, prefersDark.value);
});

const showDeterminateBar = computed(
  () => bootStore.phase === 'sessions' && bootStore.sessionsTotal > 0,
);

const progressPct = computed(() => {
  if (bootStore.sessionsTotal === 0) return 0;
  return Math.min(100, Math.round((bootStore.sessionsRestored / bootStore.sessionsTotal) * 100));
});

function reload() {
  window.location.reload();
}
</script>

<template>
  <Teleport to="body">
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
          <!-- Inline SVG wordmark. Placeholder pending real branding —
               two stacked rounded rects suggesting "panels" in the
               primary tint, with the wordmark in the text color. -->
          <div class="boot-brand">
            <svg
              class="boot-mark"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="4"
                y="6"
                width="18"
                height="14"
                rx="3"
              />
              <rect
                x="10"
                y="12"
                width="18"
                height="14"
                rx="3"
                class="boot-mark-back"
              />
            </svg>
            <h1 class="boot-title">dafman</h1>
          </div>

          <div
            v-if="bootStore.phase === 'failed'"
            class="boot-error"
          >
            <i
              class="pi pi-exclamation-triangle"
              aria-hidden="true"
            />
            <p class="boot-status">{{ bootStore.statusText }}</p>
            <p
              v-if="bootStore.error"
              class="boot-error-detail"
            >
              {{ bootStore.error }}
            </p>
            <button
              type="button"
              class="boot-reload"
              @click="reload"
            >
              Reload
            </button>
          </div>

          <template v-else>
            <!-- Spinner is GPU-promoted via will-change so its rotation
                 keeps animating even when the main thread is blocked
                 by dockview's synchronous panel-mount burst. -->
            <div
              class="boot-spinner"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke-width="3"
                  class="boot-spinner-track"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke-width="3"
                  stroke-linecap="round"
                  class="boot-spinner-head"
                />
              </svg>
            </div>
            <p class="boot-status">{{ bootStore.statusText }}</p>
            <!-- Determinate bar (N of M) over an indeterminate shimmer
                 track. Even when the counter is stuck, the shimmer
                 keeps moving — also compositor-layered via
                 will-change. -->
            <div class="boot-progress">
              <div class="boot-progress-shimmer" />
              <div
                v-if="showDeterminateBar"
                class="boot-progress-fill"
                :style="{ width: `${progressPct}%` }"
              />
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
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
  /* Promote the whole splash to its own compositor layer. Combined
   * with will-change on the animated children below, this keeps the
   * splash painting smoothly during the main-thread blocks caused by
   * dockview's panel mount burst. */
  will-change: opacity;
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
  gap: 0.65rem;
  margin-bottom: 0.25rem;
}

.boot-mark {
  width: 2.25rem;
  height: 2.25rem;
}

.boot-mark rect {
  stroke: var(--p-primary-color);
  stroke-width: 2.5;
  fill: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}

.boot-mark-back {
  fill: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
}

.boot-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  /* Lowercase mark to keep room for a real wordmark later. */
  font-variant: small-caps;
}

.boot-spinner {
  width: 2.5rem;
  height: 2.5rem;
  /* GPU layer: keeps the rotation smooth even when JS is busy. */
  will-change: transform;
  animation: boot-spin 1s linear infinite;
}

.boot-spinner svg {
  width: 100%;
  height: 100%;
}

.boot-spinner-track {
  stroke: color-mix(in srgb, var(--p-text-color) 10%, transparent);
}

.boot-spinner-head {
  stroke: var(--p-primary-color);
  stroke-dasharray: 14 42;
  stroke-dashoffset: 0;
}

@keyframes boot-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.boot-status {
  margin: 0;
  font-size: 0.95rem;
  color: var(--p-text-muted-color);
  /* Match the spinner's width so a long string doesn't shove the
   * card sideways. */
  min-width: 14rem;
}

.boot-progress {
  position: relative;
  width: 18rem;
  max-width: 100%;
  height: 4px;
  background: color-mix(in srgb, var(--p-text-color) 6%, transparent);
  border-radius: 2px;
  overflow: hidden;
}

/* Indeterminate shimmer — always animating, runs on the compositor
 * thread via will-change so it doesn't freeze during the
 * "applying" phase's synchronous JS block. */
.boot-progress-shimmer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 35%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--p-primary-color) 35%, transparent) 50%,
    transparent 100%
  );
  will-change: transform;
  animation: boot-shimmer 1.2s ease-in-out infinite;
}

@keyframes boot-shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(370%);
  }
}

.boot-progress-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: var(--p-primary-color);
  border-radius: 2px;
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
