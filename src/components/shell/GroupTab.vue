<script setup lang="ts">
/**
 * GroupTab — custom tab renderer for the OUTER dockview's body panels
 * (each panel = one group). Mirrors ChatTab.vue's design language but
 * showing group meta (color dot + name + session count badge).
 *
 * v3.1 polish (2026-05-27):
 *  - Dblclick the tab title → inline rename via an <input>. Enter / blur
 *    commits; Esc cancels.
 *  - Right-click anywhere on the tab → ContextMenu with "Rename" +
 *    "Change color…" (8-swatch submenu) + "Close group" (when > 1 group).
 */

import { computed, nextTick, ref, useTemplateRef } from 'vue';
import ContextMenu from 'primevue/contextmenu';
import Popover from 'primevue/popover';
import ColorPicker from 'primevue/colorpicker';
import type { MenuItem } from 'primevue/menuitem';
import { useGroupsStore, GROUP_COLORS } from '@/stores/shell/groupsStore';
import { useGroupsActions } from '@/composables/useGroupsActions';
import { useConfirm } from 'primevue/useconfirm';
import { usePanelLifecycle } from '@/composables/usePanelLifecycle';

type UserParams = { groupId?: string };
type WrappedParams = {
  params?: UserParams;
  api?: import('dockview-core').DockviewPanelApi;
};
type IncomingParams = UserParams & WrappedParams;

const props = defineProps<{
  params: IncomingParams;
  api?: import('dockview-core').DockviewPanelApi;
}>();

const { panelApi, isActive } = usePanelLifecycle(props);
const groupsStore = useGroupsStore();
const groupsActions = useGroupsActions();
const confirm = useConfirm();

const groupId = computed(
  () => props.params?.params?.groupId ?? props.params?.groupId ?? panelApi.value?.id ?? '',
);

const meta = computed(() => groupsStore.groups.find((g) => g.id === groupId.value) ?? null);

const displayName = computed(() => meta.value?.name ?? '');

const color = computed(() => meta.value?.color ?? 'var(--p-primary-color)');

/// Session count from the inner dockview, if mounted. We can't easily
/// derive it from the cached body either since the cache lags one event,
/// but for inactive groups the cache is the freshest source we have.
const sessionCount = computed(() => {
  const id = groupId.value;
  const api = groupsStore.innerApis[id];

  if (api) return api.panels.length;

  const cached = groupsStore.innerBodiesCache[id];

  if (!cached || typeof cached !== 'object') return 0;

  const panels = (cached as Record<string, unknown>).panels;

  if (!panels || typeof panels !== 'object') return 0;

  return Object.keys(panels).length;
});

// ─── Inline rename ───────────────────────────────────────────────────

const isRenaming = ref(false);
const renameDraft = ref('');
const renameInputRef = useTemplateRef<HTMLInputElement>('renameInputRef');

async function startRename(): Promise<void> {
  const m = meta.value;

  if (!m) return;

  renameDraft.value = m.name;
  isRenaming.value = true;
  await nextTick();
  const input = renameInputRef.value;

  if (input) {
    input.focus();
    input.select();
  }
}

function commitRename(): void {
  if (!isRenaming.value) return;

  const id = groupId.value;
  const next = renameDraft.value.trim();

  isRenaming.value = false;

  // renameGroup is no-op on empty input; safe to call regardless.
  if (next && next !== meta.value?.name) {
    groupsStore.renameGroup(id, next);
  }
}

function cancelRename(): void {
  isRenaming.value = false;
}

// ─── Color picker popover ────────────────────────────────────────────

const colorPopRef = useTemplateRef<InstanceType<typeof Popover>>('colorPopRef');

/// Two-way bound to ColorPicker. PrimeVue's ColorPicker emits hex
/// WITHOUT the leading `#` (e.g. `"3b82f6"`), so we normalize both
/// directions: read drops the `#` if present, write prepends it.
const colorModel = computed<string>({
  get: () => (meta.value?.color ?? '#3b82f6').replace(/^#/, ''),
  set: (next: string) => {
    if (!next) return;

    const withHash = next.startsWith('#') ? next : `#${next}`;

    groupsStore.setGroupColor(groupId.value, withHash);
  },
});

function openColorPicker(event: Event): void {
  colorPopRef.value?.show(event);
}

function pickSwatch(swatch: string): void {
  groupsStore.setGroupColor(groupId.value, swatch);
}

function closeGroupOrConfirm(id: string, target?: HTMLElement): void {
  const count = sessionCount.value;

  if (count === 0) {
    groupsActions.deleteGroup(id);

    return;
  }

  confirm.require({
    ...(target ? { target } : {}),
    header: 'Close group',
    message: `Close ${count} session${count === 1 ? '' : 's'} in "${displayName.value}"? This will close ${
      count === 1 ? 'that session' : 'those sessions'
    }.`,
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Close group', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', text: true },
    defaultFocus: 'reject',
    accept: () => {
      groupsActions.deleteGroup(id);
    },
  });
}

// ─── Right-click context menu ────────────────────────────────────────

const ctxMenuRef = useTemplateRef<InstanceType<typeof ContextMenu>>('ctxMenuRef');

const menuItems = computed<MenuItem[]>(() => [
  {
    label: 'Rename group',
    icon: 'pi pi-pencil',
    command: () => {
      void startRename();
    },
  },
  {
    label: 'Change color…',
    icon: 'pi pi-palette',
    command: (e) => {
      // Open the color popover anchored on the current contextmenu's
      // trigger element (the tab itself). PrimeVue's MenuItem command
      // receives `{ originalEvent, item }` — we use originalEvent so the
      // popover positions near the click.
      openColorPicker(e.originalEvent);
    },
  },
  { separator: true },
  {
    label: 'Close group',
    icon: 'pi pi-times',
    // Disable when this is the last remaining group.
    disabled: groupsStore.groups.length <= 1,
    command: () => {
      const id = groupId.value;

      if (!id) return;

      closeGroupOrConfirm(id);
    },
  },
]);

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  ctxMenuRef.value?.show(event);
}

function onClose(event: MouseEvent): void {
  event.stopPropagation();
  const id = groupId.value;

  if (!id) return;

  // Deleting the last group is a no-op at the store level. UX: confirm
  // with the user before closing all sessions in this group.
  if (groupsStore.groups.length <= 1) return;

  // useGroupsActions.deleteGroup handles the full orchestration:
  // closes sessions in this group, removes the outer body panel,
  // calls groupsStore.deleteGroup. Idempotent + safe.
  closeGroupOrConfirm(id, event.currentTarget as HTMLElement);
}
</script>

<template>
  <div
    class="group-tab"
    :class="{ 'group-tab-active': isActive }"
    :style="{ '--group-color': color }"
    :title="displayName"
    @contextmenu="onContextMenu"
  >
    <span
      class="group-tab-dot"
      aria-hidden="true"
    />
    <input
      v-if="isRenaming"
      ref="renameInputRef"
      v-model="renameDraft"
      type="text"
      class="group-tab-rename-input"
      aria-label="Rename group"
      @click.stop
      @pointerdown.stop
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="cancelRename"
      @blur="commitRename"
    />
    <span
      v-else
      class="group-tab-title"
      @dblclick.stop="startRename"
      >{{ displayName }}</span
    >
    <span
      v-if="sessionCount > 0 && !isRenaming"
      class="group-tab-badge"
      :aria-label="`${sessionCount} session${sessionCount === 1 ? '' : 's'}`"
      >{{ sessionCount }}</span
    >
    <button
      v-if="groupsStore.groups.length > 1 && !isRenaming"
      type="button"
      class="group-tab-close"
      aria-label="Close group"
      @pointerdown.stop
      @click="onClose"
    >
      <i
        class="pi pi-times"
        aria-hidden="true"
      />
    </button>
    <ContextMenu
      ref="ctxMenuRef"
      :model="menuItems"
    />
    <Popover ref="colorPopRef">
      <div class="group-color-popover">
        <div class="group-color-swatches">
          <button
            v-for="swatch in GROUP_COLORS"
            :key="swatch"
            type="button"
            class="group-color-swatch"
            :class="{ active: swatch === meta?.color }"
            :style="{ '--swatch-color': swatch }"
            :aria-label="`Select color ${swatch}`"
            :title="swatch"
            @click="pickSwatch(swatch)"
          />
        </div>
        <div class="group-color-custom">
          <span class="group-color-custom-label">Custom</span>
          <ColorPicker
            v-model="colorModel"
            format="hex"
            inline
          />
        </div>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.group-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  margin: 2px 4px 0 0;
  border-top-left-radius: var(--p-border-radius-xl);
  border-top-right-radius: var(--p-border-radius-xl);
  border-bottom: 2px solid transparent;
  background: color-mix(
    in srgb,
    var(--group-color) 6%,
    var(--dv-inactivegroup-visiblepanel-tab-background-color, var(--p-surface-100))
  );
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
  line-height: 1.25;
  max-width: 16rem;
  min-width: 0;
  height: calc(var(--dv-tabs-and-actions-container-height, 35px) - 4px);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease,
    border-bottom-color 120ms ease;
}

.group-tab-active {
  background: color-mix(in srgb, var(--group-color) 18%, var(--p-content-background));
  color: var(--p-text-color);
  font-weight: 500;
  border-bottom-color: var(--group-color);
  /* Push the tab's bottom edge over the body to visually merge. */
  margin-bottom: -1px;
  padding-bottom: calc(0.3rem + 1px);
}

.group-tab:not(.group-tab-active):hover {
  background: color-mix(in srgb, var(--group-color) 12%, var(--p-content-background));
  color: var(--p-text-color);
}

.group-tab-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--group-color);
  flex: 0 0 auto;
}

.group-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}

.group-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1rem;
  height: 1.1rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--group-color) 28%, transparent);
  color: var(--p-text-color);
  font-size: 0.7rem;
  font-weight: 500;
  flex: 0 0 auto;
}

.group-tab-close {
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
  transition:
    opacity 120ms ease,
    background 120ms ease;
}

.group-tab:hover .group-tab-close,
.group-tab-active .group-tab-close,
.group-tab-close:focus-visible {
  opacity: 0.85;
}

.group-tab-close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--group-color) 35%, transparent);
}

.group-tab-rename-input {
  flex: 1 1 auto;
  min-width: 4rem;
  max-width: 12rem;
  height: 1.3rem;
  margin: 0;
  padding: 0 0.3rem;
  border: 1px solid var(--group-color);
  border-radius: var(--p-border-radius-sm);
  background: var(--p-content-background);
  color: var(--p-text-color);
  font-size: 0.8rem;
  line-height: 1.25;
  outline: none;
}

.group-tab-rename-input:focus {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--group-color) 30%, transparent);
}
</style>

<!-- Unscoped popover styling. PrimeVue Popover teleports outside the
component's scoped CSS boundary. -->
<style>
.group-color-popover {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.25rem;
  min-width: 12rem;
}

.group-color-swatches {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
}

.group-color-swatch {
  width: 1.8rem;
  height: 1.8rem;
  border: 2px solid transparent;
  border-radius: 50%;
  background: var(--swatch-color);
  cursor: pointer;
  padding: 0;
  transition:
    transform 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.group-color-swatch:hover {
  transform: scale(1.08);
}

.group-color-swatch.active {
  border-color: var(--p-text-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--swatch-color) 30%, transparent);
}

.group-color-swatch:focus-visible {
  outline: none;
  border-color: var(--p-primary-color);
}

.group-color-custom {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--p-content-border-color);
}

.group-color-custom-label {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}
</style>
