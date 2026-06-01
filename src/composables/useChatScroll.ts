// Composable for ChatWindow's DOM-side scroll + tile-resize concerns.
//
// Extracted from ChatWindow.vue (Phase D.2 step 1). No transcript state
// ownership — pure DOM. Owns the transcript's single scroll-anchoring
// model plus the `--tile-height` resize var:
//
// 1. STICK-TO-BOTTOM. `isPinned` tracks whether the user is sitting at
//    (or within `AT_BOTTOM_OFFSET_PX` of) the bottom. It flips ONLY on a
//    real upward user scroll — never on content growth or our own
//    programmatic bottom-scrolls (both of which scroll DOWN). So:
//    - `scrollToBottom()` is the FORCE path (explicit user intent:
//      sending, edit-replay, the "scroll-to-bottom" bus, the
//      jump-to-latest pill, the reveal not-found fallback). It pins.
//    - `autoScrollIfPinned()` is the AUTO path (after every event flush
//      + on panel re-activation). It scrolls only if still pinned, so
//      streaming can't yank a user who scrolled up to read.
//    Both gate the write behind nextTick + double-rAF so it lands AFTER
//    Vue reconciles the latest items; `autoScrollIfPinned` re-checks the
//    pin AFTER the gate (the user may scroll up during those frames).
//
// 2. `showJumpToLatest` — true when the user is scrolled up AND new
//    content streamed in below them, driving the floating pill.
//
// 3. `--tile-height` CSS var — updated on resize so the composer can
//    cap itself at a percentage of the chat tile's height even though
//    the tile lives inside a flex/grid layout with no fixed height.
//    Resize events fire hundreds of times per second during a
//    dockview drag; the update is coalesced through requestAnimationFrame
//    so style recalcs stay bounded.
//
// Test coverage: the ChatWindow.test.ts tests mount the full component
// and rely on this composable's behavior (the rAF gate keeps the tests
// synchronizable via `flushFrames`). In happy-dom scrollHeight is 0 so
// `arrivedState.bottom` reads true → `isPinned` stays true → the auto
// path always scrolls, matching the pre-change unconditional behavior.

import {
  computed,
  onBeforeUnmount,
  onMounted,
  nextTick,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import { useElementVisibility, useResizeObserver, useScroll } from '@vueuse/core';

/// Distance from the bottom (px) still counted as "pinned to the latest
/// message". Locked dogfood spec (2026-06-01 scroll total-solution).
const AT_BOTTOM_OFFSET_PX = 80;

/// After `unpin()` (the reveal flow lands on an up-transcript card), the
/// browser dispatches the `scrollIntoView`-induced `scroll` event
/// ASYNCHRONOUSLY. If the revealed card sits within `AT_BOTTOM_OFFSET_PX`
/// of the tail, that trailing event would re-enter `onScroll` with
/// `arrivedState.bottom === true` and silently re-pin — undoing the
/// unpin and letting the next flush yank the user off the card. We
/// suppress exactly that bottom-zone re-pin for a short window after an
/// `unpin()` so the reveal sticks. The window only gates programmatic
/// settle; a real upward user scroll (`directions.top`) still un-pins,
/// and any bottom arrival after it expires re-pins normally.
const UNPIN_REPIN_GUARD_MS = 300;

export interface UseChatScrollReturn {
  /// Force the transcript to the latest message and pin it there.
  /// Explicit user intent only.
  scrollToBottom: () => Promise<void>;
  /// Scroll to the latest message ONLY if the user is still pinned to
  /// the bottom. Safe to call after every flush / on re-activation.
  autoScrollIfPinned: () => Promise<void>;
  /// Drop the pin without scrolling. Used by the reveal flow so that
  /// landing on an up-transcript tool card isn't immediately undone by
  /// the next auto-scroll.
  unpin: () => void;
  /// True when the user has scrolled up AND new content has streamed in
  /// below — drives the floating "Jump to latest" pill.
  showJumpToLatest: ComputedRef<boolean>;
}

export function useChatScroll(
  messagesEl: Ref<HTMLElement | null>,
  tileEl: Ref<HTMLElement | null>,
): UseChatScrollReturn {
  /// Whether the user is at (or near) the bottom. Defaults true so a
  /// freshly-mounted / resumed transcript pins to the latest message.
  const isPinned = ref(true);
  /// Set when a flush lands while the user is scrolled up; cleared the
  /// moment they return to (or are snapped back to) the bottom.
  const hasUnseenLatest = ref(false);

  /// Timestamp (ms) until which an `arrivedState.bottom` re-pin is
  /// suppressed — set by `unpin()` to survive the trailing programmatic
  /// scrollIntoView event (see UNPIN_REPIN_GUARD_MS).
  let repinSuppressedUntil = 0;

  const { arrivedState, directions } = useScroll(messagesEl, {
    offset: { bottom: AT_BOTTOM_OFFSET_PX },
    // Pin whenever the bottom zone is reached; UN-pin only on an active
    // upward scroll. This is deliberately immune to programmatic
    // bottom-scrolls and content-growth scroll events (both move DOWN,
    // never up), so our own scrollToBottom / streaming can never
    // accidentally un-pin the user.
    onScroll() {
      if (arrivedState.bottom) {
        // Suppress the trailing programmatic re-pin right after a reveal
        // unpin (the scrollIntoView scroll event lands here); a real
        // upward scroll below still un-pins via the else-branch.
        if (Date.now() < repinSuppressedUntil) return;

        isPinned.value = true;
      } else if (directions.top) {
        // User scrolled up out of the bottom zone — end any reveal guard.
        repinSuppressedUntil = 0;
        isPinned.value = false;
      }
    },
  });

  watch(isPinned, (pinned) => {
    if (pinned) hasUnseenLatest.value = false;
  });

  const showJumpToLatest = computed(() => !isPinned.value && hasUnseenLatest.value);

  async function afterRender(): Promise<void> {
    await nextTick();

    if (typeof requestAnimationFrame !== 'undefined') {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  function writeToBottom(): void {
    const el = messagesEl.value;

    if (el) el.scrollTop = el.scrollHeight;
  }

  async function scrollToBottom(): Promise<void> {
    isPinned.value = true;
    hasUnseenLatest.value = false;
    await afterRender();
    writeToBottom();
  }

  async function autoScrollIfPinned(): Promise<void> {
    await afterRender();

    // Re-check the pin AFTER the render gate: the user may have scrolled
    // up during those frames, in which case we must NOT yank them down —
    // we just flag that there's new content waiting below.
    if (!isPinned.value) {
      hasUnseenLatest.value = true;

      return;
    }

    writeToBottom();
  }

  function unpin(): void {
    isPinned.value = false;
    repinSuppressedUntil = Date.now() + UNPIN_REPIN_GUARD_MS;
  }

  // Re-pin when the panel becomes visible again. dockview hides inactive
  // panels with display:none; on re-activation a pinned user snaps back
  // to the live tail, a scrolled-up user keeps their place, and neither
  // ever lands at the top.
  const isVisible = useElementVisibility(messagesEl);

  watch(isVisible, (visible) => {
    if (visible) void autoScrollIfPinned();
  });

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

  return { scrollToBottom, autoScrollIfPinned, unpin, showJumpToLatest };
}
