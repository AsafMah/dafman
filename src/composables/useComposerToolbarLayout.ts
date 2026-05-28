// Composer toolbar responsive layout — tracks the toolbar's clientWidth
// via ResizeObserver and derives how many format-action buttons fit
// inline vs collapse into the overflow popover. Extracted from
// MessageComposer.vue (Phase D.4.2).
//
// The breakpoints are tuned for a single horizontal row that shares
// space with the file-picker button on the left and the
// session/mode controls on the right. Below 390 px the toolbar drops
// every inline button (everything goes to the overflow popover) so
// the composer collapses cleanly into narrow dockview panes.

import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';

import {
  editorFormatActions,
  type EditorFormatActionDescriptor,
} from '@/composables/composerFormat';

export interface UseComposerToolbarLayoutReturn {
  inlineFormatActions: ComputedRef<readonly EditorFormatActionDescriptor[]>;
  overflowFormatActions: ComputedRef<readonly EditorFormatActionDescriptor[]>;
}

/// Composer toolbar responsive layout. The toolbar element is owned by
/// the caller (template ref) and passed in — that keeps the
/// template-ref binding visible to vue-tsc 3 instead of hiding it
/// behind a composable-internal `ref()` that the compiler can't link
/// to the template string ref.
export function useComposerToolbarLayout(
  toolbarRef: Ref<HTMLElement | null>,
): UseComposerToolbarLayoutReturn {
  /// Default to a wide value so all buttons render inline on the
  /// first paint (before the ResizeObserver fires).
  const toolbarWidth = ref(1000);

  const visibleFormatCount = computed(() => {
    const width = toolbarWidth.value;

    if (width >= 860) return editorFormatActions.length;

    if (width >= 740) return 8;

    if (width >= 620) return 6;

    if (width >= 500) return 4;

    if (width >= 390) return 2;

    return 0;
  });

  const inlineFormatActions = computed(() =>
    editorFormatActions.slice(0, visibleFormatCount.value),
  );
  const overflowFormatActions = computed(() => editorFormatActions.slice(visibleFormatCount.value));

  useResizeObserver(toolbarRef, () => {
    if (toolbarRef.value) toolbarWidth.value = toolbarRef.value.clientWidth;
  });

  onMounted(() => {
    if (toolbarRef.value) toolbarWidth.value = toolbarRef.value.clientWidth;
  });

  return { inlineFormatActions, overflowFormatActions };
}
