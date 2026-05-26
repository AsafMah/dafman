// Composable for ChatWindow's DOM-side scroll + tile-resize concerns.
//
// Extracted from ChatWindow.vue (Phase D.2 step 1). No transcript state
// ownership — pure DOM. Owns:
//
// 1. `scrollToBottom()` — double-rAF + nextTick gate so the scroll
//    write happens AFTER Vue has reconciled the latest items into the
//    transcript element. Used by the bus listeners ("focus-composer",
//    "scroll-to-bottom"), the flush pass, the submit handler, the
//    edit-save replay, and the error toast path.
//
// 2. `--tile-height` CSS var — updated on resize so the composer can
//    cap itself at a percentage of the chat tile's height even though
//    the tile lives inside a flex/grid layout with no fixed height.
//    Resize events fire hundreds of times per second during a
//    dockview drag; the update is coalesced through requestAnimationFrame
//    so style recalcs stay bounded.
//
// Test coverage: the 8 ChatWindow.test.ts tests still mount the full
// component and rely on this composable's behavior (notably the rAF
// gate inside scrollToBottom keeps the tests synchronizable via
// `flushFrames`). No isolated unit tests are added for the composable
// because both pieces are 100% DOM side-effects.

import { onBeforeUnmount, onMounted, nextTick, type Ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';

export interface UseChatScrollReturn {
  scrollToBottom: () => Promise<void>;
}

export function useChatScroll(
  messagesEl: Ref<HTMLElement | null>,
  tileEl: Ref<HTMLElement | null>,
): UseChatScrollReturn {
  async function scrollToBottom(): Promise<void> {
    await nextTick();

    if (typeof requestAnimationFrame !== 'undefined') {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    const el = messagesEl.value;

    if (el) el.scrollTop = el.scrollHeight;
  }

  let tileResizeRaf: number | null = null;

  const stopTileObserver = useResizeObserver(tileEl, () => {
    if (tileResizeRaf !== null) return;

    tileResizeRaf = requestAnimationFrame(() => {
      tileResizeRaf = null;
      const el = tileEl.value;

      if (el) el.style.setProperty('--tile-height', `${el.clientHeight}px`);
    });
  });

  onMounted(() => {
    const el = tileEl.value;

    if (el) el.style.setProperty('--tile-height', `${el.clientHeight}px`);
  });

  onBeforeUnmount(() => {
    stopTileObserver.stop();

    if (tileResizeRaf !== null) {
      cancelAnimationFrame(tileResizeRaf);
      tileResizeRaf = null;
    }
  });

  return { scrollToBottom };
}
