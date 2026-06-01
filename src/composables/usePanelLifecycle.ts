// Shared dockview panel lifecycle composable. Both ChatTab and
// SidebarTab need reactive title/isActive tracking and cleanup
// of dockview event subscriptions. This composable centralizes
// that logic.
//
// dockview-vue uses the same VueRenderer for tabs and panels, so
// the prop shape varies: on first mount we get `{ params, api,
// containerApi }` at the top level; on any later `update()`
// everything is re-wrapped into `{ params: { params, api, … } }`.

import { computed, getCurrentInstance, onBeforeUnmount, ref, watchEffect, type Ref } from 'vue';
import type { DockviewPanelApi } from 'dockview-core';

export interface PanelProps {
  params?: { api?: DockviewPanelApi; [k: string]: unknown };
  api?: DockviewPanelApi;
}

export interface PanelLifecycle {
  panelApi: Ref<DockviewPanelApi | undefined>;
  title: Ref<string>;
  isActive: Ref<boolean>;
  maximized: Ref<boolean>;
  close: (event: MouseEvent) => void;
  toggleMaximized: (event: MouseEvent) => void;
}

interface MaximizeEvents {
  onDidMaximizedChange?: (listener: (event: { isMaximized: boolean }) => void) => {
    dispose(): void;
  };
}

export function usePanelLifecycle(props: PanelProps): PanelLifecycle {
  const panelApi = computed<DockviewPanelApi | undefined>(() => props.api ?? props.params?.api);

  const title = ref<string>(panelApi.value?.title ?? '');
  const isActive = ref<boolean>(panelApi.value?.isActive ?? false);
  const maximized = ref<boolean>(panelApi.value?.isMaximized() ?? false);

  let unsubTitle: (() => void) | null = null;
  let unsubActive: (() => void) | null = null;
  let unsubMaximized: (() => void) | null = null;

  watchEffect((onCleanup) => {
    const api = panelApi.value;

    if (!api) return;

    title.value = api.title ?? '';
    isActive.value = api.isActive;
    maximized.value = api.isMaximized();
    unsubTitle?.();
    unsubActive?.();
    unsubMaximized?.();

    const titleSub = api.onDidTitleChange((e) => {
      title.value = e.title ?? '';
    });

    const activeSub = api.onDidActiveChange(() => {
      isActive.value = api.isActive;
    });
    const maximizedSub = (api as DockviewPanelApi & MaximizeEvents).onDidMaximizedChange?.(
      (event) => {
        maximized.value = event.isMaximized;
      },
    );
    const dimensionsSub = api.onDidDimensionsChange(() => {
      maximized.value = api.isMaximized();
    });

    unsubTitle = () => titleSub.dispose();
    unsubActive = () => activeSub.dispose();
    unsubMaximized = () => {
      maximizedSub?.dispose();
      dimensionsSub.dispose();
    };

    onCleanup(() => {
      unsubTitle?.();
      unsubActive?.();
      unsubMaximized?.();
      unsubTitle = null;
      unsubActive = null;
      unsubMaximized = null;
    });
  });

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      unsubTitle?.();
      unsubActive?.();
      unsubMaximized?.();
    });
  }

  function close(event: MouseEvent) {
    event.stopPropagation();
    panelApi.value?.close();
  }

  function toggleMaximized(event: MouseEvent) {
    event.stopPropagation();
    const api = panelApi.value;

    if (!api) return;

    if (api.isMaximized()) {
      api.exitMaximized();
    } else {
      api.maximize();
    }

    maximized.value = api.isMaximized();
  }

  return { panelApi, title, isActive, maximized, close, toggleMaximized };
}
