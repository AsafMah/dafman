// Shared dockview panel lifecycle composable. Both ChatTab and
// SidebarTab need reactive title/isActive tracking and cleanup
// of dockview event subscriptions. This composable centralizes
// that logic.
//
// dockview-vue uses the same VueRenderer for tabs and panels, so
// the prop shape varies: on first mount we get `{ params, api,
// containerApi }` at the top level; on any later `update()`
// everything is re-wrapped into `{ params: { params, api, … } }`.

import { computed, onBeforeUnmount, ref, watchEffect, type Ref } from 'vue';
import type { DockviewPanelApi } from 'dockview-core';

export interface PanelProps {
  params?: { api?: DockviewPanelApi; [k: string]: unknown };
  api?: DockviewPanelApi;
}

export interface PanelLifecycle {
  panelApi: Ref<DockviewPanelApi | undefined>;
  title: Ref<string>;
  isActive: Ref<boolean>;
  close: (event: MouseEvent) => void;
}

export function usePanelLifecycle(props: PanelProps): PanelLifecycle {
  const panelApi = computed<DockviewPanelApi | undefined>(
    () => props.api ?? props.params?.api,
  );

  const title = ref<string>(panelApi.value?.title ?? '');
  const isActive = ref<boolean>(panelApi.value?.isActive ?? false);

  let unsubTitle: (() => void) | null = null;
  let unsubActive: (() => void) | null = null;

  watchEffect((onCleanup) => {
    const api = panelApi.value;

    if (!api) return;

    title.value = api.title ?? '';
    isActive.value = api.isActive;
    unsubTitle?.();
    unsubActive?.();

    const titleSub = api.onDidTitleChange((e) => {
      title.value = e.title ?? '';
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

  function close(event: MouseEvent) {
    event.stopPropagation();
    panelApi.value?.close();
  }

  return { panelApi, title, isActive, close };
}
