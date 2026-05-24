<script setup lang="ts">
// Custom dockview tab renderer for chat session panels. Replaces
// dockview's default tab so each tab can carry its session's accent
// colour and match the chat tile's rounded design language.
//
// dockview-vue uses the same `VueRenderer` for tabs and panels, so the
// prop-shape gotcha applies: on first mount we get
// `{ params, api, containerApi }` at the top level, on any later
// `update()` everything is re-wrapped into a single `params` prop. See
// stored memory "dockview-vue panel props".

import { computed, onBeforeUnmount, ref, watchEffect } from "vue";
import type { DockviewPanelApi } from "dockview-core";
import { useSessionsStore } from "../stores/sessionsStore";
import { indicatorStyle } from "../lib/notificationStyles";

type UserParams = { sessionId?: string };
type WrappedParams = {
  params?: UserParams;
  api?: DockviewPanelApi;
};
type IncomingParams = UserParams & WrappedParams;

const props = defineProps<{
  params: IncomingParams;
  api?: DockviewPanelApi;
}>();

const sessionsStore = useSessionsStore();

const panelApi = computed<DockviewPanelApi | undefined>(
  () => props.api ?? props.params?.api,
);

const sessionId = computed(() => {
  const fromUserParams =
    props.params?.params?.sessionId ?? props.params?.sessionId;
  return fromUserParams ?? panelApi.value?.id ?? "";
});

const record = computed(() =>
  sessionsStore.getSession(sessionId.value),
);

/// Reactive mirror of `api.title`. Dockview emits `onDidTitleChange`
/// when the layout-side title updates (we drive it from
/// `layoutStore.renamePanel` on `session.title_changed`), so we'd miss
/// changes if we just read `api.title` once.
const title = ref<string>(panelApi.value?.title ?? "");
/// Reactive `api.isActive`. Drives the active/inactive styling without
/// reaching for the parent `.dv-active-tab` class.
const isActive = ref<boolean>(panelApi.value?.isActive ?? false);

let unsubTitle: (() => void) | null = null;
let unsubActive: (() => void) | null = null;

watchEffect((onCleanup) => {
  const api = panelApi.value;
  if (!api) return;
  title.value = api.title ?? "";
  isActive.value = api.isActive;
  unsubTitle?.();
  unsubActive?.();
  const titleSub = api.onDidTitleChange((e) => {
    title.value = e.title ?? "";
  });
  const activeSub = api.onDidActiveChange(() => {
    isActive.value = api.isActive;
  });
  unsubTitle = () => titleSub.dispose();
  unsubActive = () => activeSub.dispose();
  onCleanup(() => {
    unsubTitle?.();
    unsubActive?.();
    unsubTitle = null;
    unsubActive = null;
  });
});

onBeforeUnmount(() => {
  unsubTitle?.();
  unsubActive?.();
});

const accent = computed(() => record.value?.accent ?? "var(--p-primary-color)");

const displayTitle = computed(() => {
  if (title.value) return title.value;
  return record.value?.title ?? sessionId.value.slice(0, 8);
});

/// Status indicator for this session. Maps the record's
/// `pendingRequest.type` + `isThinking` + `unseenTurns` to one of
/// five semantic styles via the shared `indicatorStyle` helper —
/// kept centralised so the dot color, icon, and pulse behavior
/// stay consistent with the Sessions sidebar row + composer
/// banner. `null` when nothing's worth surfacing.
const indicator = computed(() =>
  indicatorStyle(
    record.value?.pendingRequests[0]?.kind,
    record.value?.isThinking ?? false,
    record.value?.unseenTurns ?? 0,
  ),
);

/// `pointerdown.stop` keeps the close click from bubbling into
/// dockview's drag-start handler on the tab; `click.stop` keeps it
/// from re-activating the panel right before we close it.
function onClose(event: MouseEvent) {
  event.stopPropagation();
  panelApi.value?.close();
}

const maximized = ref(false);

watchEffect((onCleanup) => {
  const api = panelApi.value;
  if (!api) return;
  maximized.value = api.isMaximized();
  const sub = (api as any).onDidMaximizedChange?.((e: { isMaximized: boolean }) => {
    maximized.value = e.isMaximized;
  });
  // Fallback: dockview 6.x fires onDidDimensionsChange on maximize/restore
  const dimSub = api.onDidDimensionsChange(() => {
    maximized.value = api.isMaximized();
  });
  onCleanup(() => {
    sub?.dispose?.();
    dimSub.dispose();
  });
});

function onMaximizeToggle(event: MouseEvent) {
  event.stopPropagation();
  const api = panelApi.value;
  if (!api) return;
  if (api.isMaximized()) {
    api.exitMaximized();
  } else {
    api.maximize();
  }
}
</script>

<template>
  <div
    class="chat-tab"
    :class="{ 'chat-tab-active': isActive, 'chat-tab-inactive': !isActive }"
    :style="{ '--accent': accent }"
    :title="displayTitle"
  >
    <i
      v-if="indicator"
      class="pi chat-tab-icon"
      :class="[
        `pi-${indicator.iconSuffix}`,
        { 'chat-tab-icon-pulse': indicator.pulse },
      ]"
      :style="{ '--icon-color': indicator.color }"
      :aria-label="indicator.label"
      :title="indicator.label"
    />
    <span class="chat-tab-title">{{ displayTitle }}</span>
    <button
      type="button"
      class="chat-tab-action"
      :aria-label="maximized ? 'Restore panel' : 'Maximize panel'"
      :title="maximized ? 'Restore' : 'Maximize'"
      @pointerdown.stop
      @click="onMaximizeToggle"
    >
      <i
        class="pi"
        :class="maximized ? 'pi-window-minimize' : 'pi-window-maximize'"
        aria-hidden="true"
      />
    </button>
    <button
      type="button"
      class="chat-tab-action chat-tab-close"
      aria-label="Close session"
      @pointerdown.stop
      @click="onClose"
    >
      <i class="pi pi-times" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.chat-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  /* Match the chat-tile design language: top-rounded corners + accent
   * left rail. Negative bottom margin pulls the tab's bottom edge into
   * the tile's top so an active tab visually merges with its panel. */
  border-top-left-radius: var(--p-border-radius-xl);
  border-top-right-radius: var(--p-border-radius-xl);
  padding: 0.3rem 0.6rem 0.3rem 0.7rem;
  /* No left margin: the active tab's 4 px accent rail must sit flush at
   * x=0 so it lines up with `.chat-tile`'s 4 px left rail underneath.
   * A right-side gap keeps stacked tabs visually separated. */
  margin: 0 4px 0 0;
  /* Inactive tabs get a thinner accent rail; active gets the full 4 px
   * to match `.chat-tile`'s left rail. Inactive tabs add 2 px of left
   * padding to compensate so their content still aligns with active. */
  border-left: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
  padding-left: calc(0.7rem + 2px);
  /* Slight accent tint even when inactive — keeps the session
   * identifiable in a stack. */
  background: color-mix(
    in srgb,
    var(--accent) 6%,
    var(--dv-inactivegroup-visiblepanel-tab-background-color, var(--p-surface-100))
  );
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  line-height: 1.25;
  max-width: 18rem;
  min-width: 0;
  height: calc(var(--dv-tabs-and-actions-container-height, 35px) - 4px);
  margin-top: 2px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.chat-tab-active {
  border-left-width: 4px;
  border-left-color: var(--accent);
  /* Active tab now has a 4 px border; reset the inactive 2 px padding
   * compensation so content x-position is the same as inactive tabs and
   * the rail is flush with `.chat-tile`'s 4 px left rail underneath. */
  padding-left: 0.7rem;
  background: color-mix(in srgb, var(--accent) 18%, var(--p-content-background));
  color: var(--p-text-color);
  font-weight: 500;
  /* Push the tab's bottom edge over the tile's top border so the two
   * surfaces visually merge into a single rounded shape. */
  margin-bottom: -1px;
  padding-bottom: calc(0.3rem + 1px);
}

.chat-tab-inactive:hover {
  background: color-mix(in srgb, var(--accent) 12%, var(--p-content-background));
  color: var(--p-text-color);
}

.chat-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}

.chat-tab-action {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
}

.chat-tab:hover .chat-tab-action,
.chat-tab-active .chat-tab-action,
.chat-tab-action:focus-visible {
  opacity: 0.85;
}

.chat-tab-action:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--accent) 35%, transparent);
}

.chat-tab-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  color: var(--icon-color, var(--p-primary-color));
  /* Compositor-layered so the pi-spin animation on `thinking` keeps
   * ticking through main-thread blocks (Lexical reconciles, reducer
   * runs, dockview re-layouts). PrimeIcons' default pi-spin runs on
   * the main thread; our keyframe override below replaces it with
   * a transform-only version that runs on the compositor. */
  will-change: transform;
}

/* Compositor-friendly override of PrimeIcons' default pi-spin
 * keyframe — transform-only rotation goes to the compositor thread,
 * unlike pi-spin's default which animates a CSS variable. */
.chat-tab-icon.pi-spin {
  animation: chat-tab-spin 1s linear infinite !important;
}

@keyframes chat-tab-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.chat-tab-icon.chat-tab-icon-pulse {
  /* Pending requests pulse to draw the eye; "thinking" already
   * self-animates via pi-spin, and unseen-activity stays static. */
  animation: chat-tab-icon-pulse 1.6s ease-in-out infinite;
}

@keyframes chat-tab-icon-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
</style>
