<script setup lang="ts">
// Command palette overlay built on `vue-command-palette`
// (xiaoluoboding/vue-command-palette). Library handles fuzzy search,
// keyboard navigation (↑/↓/Enter), groups, and item highlighting; we
// just wire up the global open hotkey + close-on-Escape + map our
// registry into `Command.Group` / `Command.Item` nodes.
//
// Why this library: it ships built-in fuzzy search (via fuse.js as
// a transitive dep), is the canonical "cmdk for Vue" port, and
// avoids the maintenance burden of a bespoke list-and-fuzzy-match
// implementation. See `vue-command-palette` README.
//
// Hotkey: Ctrl+K (Windows/Linux) / Cmd+K (macOS). Strict modifier
// chord — no Shift, no Alt — so it doesn't collide with composer
// bindings (`Ctrl+Enter`, `Ctrl+Shift+Enter`, `Alt+Enter`). We
// listen on `window` with `capture: true` and `preventDefault()` so
// the WebView doesn't surface any platform shortcut tied to the
// chord. The listener fires even inside a contenteditable (Lexical
// composer) — VSCode-style global override is the goal.
//
// Closing: Escape (handled here) or the registered item's `perform`
// callback runs and we flip `open = false`. Clicking the mask is
// not yet wired (the library's Dialog doesn't expose a mask-click
// event; can be added with a custom listener later).
//
// We also suppress the hotkey while a PrimeVue confirm popup or
// modal dialog is open — opening a palette on top of a destructive
// confirm would steal focus from the confirm flow.

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Command } from "vue-command-palette";
import { useCommandRegistry, type Command as CommandDef } from "../stores/commandRegistry";
import { useLayoutStore } from "../stores/layoutStore";

const registry = useCommandRegistry();
const layoutStore = useLayoutStore();

const open = ref(false);
/// Element to restore focus to when the palette closes. Snapshot
/// taken at open time so the library's focus handling doesn't
/// interfere.
let prevFocus: HTMLElement | null = null;

/// Group adjacent same-group commands so each section renders under
/// one heading. Items inside a section keep registration order; the
/// library handles fuzzy-filtering them based on the input.
const grouped = computed(() => {
  const sections = new Map<string, CommandDef[]>();
  const ungrouped: CommandDef[] = [];
  for (const cmd of registry.visibleCommands) {
    if (cmd.group) {
      const bucket = sections.get(cmd.group) ?? [];
      bucket.push(cmd);
      sections.set(cmd.group, bucket);
    } else {
      ungrouped.push(cmd);
    }
  }
  return { sections: Array.from(sections.entries()), ungrouped };
});

function isOverlayOpen(): boolean {
  // PrimeVue stamps these on mounted overlays. Confirm popups and
  // modal dialog masks are the ones that should block the palette
  // hotkey so the destructive flow can't be hijacked.
  return Boolean(document.querySelector(".p-confirmpopup, .p-dialog-mask"));
}

function onHotkey(e: KeyboardEvent): void {
  if (e.repeat) return;
  if (e.key !== "k" && e.key !== "K") return;
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const cmdChord = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!cmdChord) return;
  if (e.altKey || e.shiftKey) return;
  if (!open.value && isOverlayOpen()) return;
  e.preventDefault();
  e.stopPropagation();
  if (open.value) closePalette();
  else openPalette();
}

function onEscape(e: KeyboardEvent): void {
  if (!open.value) return;
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  closePalette();
}

function openPalette(): void {
  prevFocus = (document.activeElement as HTMLElement | null) ?? null;
  open.value = true;
}

function closePalette(): void {
  open.value = false;
  // Defer focus restore until after the Dialog finishes its leave
  // transition.
  void nextTick(() => {
    if (prevFocus && document.contains(prevFocus)) {
      prevFocus.focus();
    } else if (layoutStore.activeSessionId) {
      window.dispatchEvent(
        new CustomEvent("dafman:focus-composer", {
          detail: { sessionId: layoutStore.activeSessionId },
        }),
      );
    }
    prevFocus = null;
  });
}

/// Wraps a command's `run` to also close the palette + log errors.
/// Library's `perform` prop is `() => void`; async work runs in the
/// background after we've already closed.
function makePerform(cmd: CommandDef): () => void {
  return () => {
    closePalette();
    void nextTick(() => {
      try {
        const result = cmd.run();
        if (result && typeof (result as Promise<void>).then === "function") {
          void (result as Promise<void>).catch((err) => {
            console.error(`[command palette] ${cmd.id} failed`, err);
          });
        }
      } catch (err) {
        console.error(`[command palette] ${cmd.id} threw`, err);
      }
    });
  };
}

onMounted(() => {
  window.addEventListener("keydown", onHotkey, true);
  window.addEventListener("keydown", onEscape, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onHotkey, true);
  window.removeEventListener("keydown", onEscape, true);
});
</script>

<template>
  <Command.Dialog :visible="open" theme="dafman">
    <template #header>
      <Command.Input placeholder="Type a command…" />
    </template>
    <template #body>
      <Command.List>
        <Command.Empty>No matching commands.</Command.Empty>

        <Command.Group
          v-for="([heading, items]) in grouped.sections"
          :key="heading"
          :heading="heading"
        >
          <Command.Item
            v-for="cmd in items"
            :key="cmd.id"
            :perform="makePerform(cmd)"
          >
            <i
              v-if="cmd.icon"
              class="cmd-icon"
              :class="cmd.icon"
              aria-hidden="true"
            />
            <span v-else class="cmd-icon cmd-icon-empty" />
            <span class="cmd-label">{{ cmd.label }}</span>
            <span v-if="cmd.hint" class="cmd-hint">{{ cmd.hint }}</span>
          </Command.Item>
        </Command.Group>

        <template v-if="grouped.ungrouped.length > 0">
          <Command.Separator />
          <Command.Item
            v-for="cmd in grouped.ungrouped"
            :key="cmd.id"
            :perform="makePerform(cmd)"
          >
            <i
              v-if="cmd.icon"
              class="cmd-icon"
              :class="cmd.icon"
              aria-hidden="true"
            />
            <span v-else class="cmd-icon cmd-icon-empty" />
            <span class="cmd-label">{{ cmd.label }}</span>
            <span v-if="cmd.hint" class="cmd-hint">{{ cmd.hint }}</span>
          </Command.Item>
        </template>
      </Command.List>
    </template>
  </Command.Dialog>
</template>

<style>
/* `theme="dafman"` opts out of the library's built-in styles; these
 * rules use PrimeVue tokens so the palette inherits the app's theme
 * (light + dark via `var(--p-*)`). Non-scoped because the library's
 * components render outside our component root via teleport. */

/* Backdrop mask. The library wraps the dialog in a transition with
 * the name `command-dialog`; the mask is a sibling div. */
div[command-dialog-mask] {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: color-mix(in srgb, var(--p-text-color) 30%, transparent);
  display: flex;
  justify-content: center;
  padding-top: 12vh;
  backdrop-filter: blur(2px);
}

div[command-dialog=""] {
  width: min(640px, 92vw);
  max-width: 92vw;
  background: var(--p-content-background);
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-lg, 0.75rem);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--p-text-color) 25%, transparent);
  overflow: hidden;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}

div[command-root=""] {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

div[command-input-wrapper=""],
input[command-input=""] {
  display: block;
  width: 100%;
}

input[command-input=""] {
  background: transparent;
  border: none;
  outline: none;
  color: var(--p-text-color);
  font: inherit;
  font-size: 0.95rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

input[command-input=""]::placeholder {
  color: var(--p-text-muted-color);
}

div[command-list=""] {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0.25rem 0;
}

div[command-empty=""] {
  padding: 1.25rem 1rem;
  color: var(--p-text-muted-color);
  text-align: center;
  font-size: 0.9rem;
}

div[command-group-heading=""] {
  padding: 0.5rem 1rem 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

div[command-item=""] {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
  color: var(--p-text-color);
  font-size: 0.92rem;
}

div[command-item=""][aria-selected="true"],
div[command-item=""][data-selected="true"],
div[command-item=""]:hover {
  background: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}

.cmd-icon {
  width: 1rem;
  flex: 0 0 auto;
  font-size: 0.95rem;
  color: var(--p-text-muted-color);
  text-align: center;
}

.cmd-icon-empty {
  display: inline-block;
}

.cmd-label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cmd-hint {
  flex: 0 0 auto;
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

hr[command-separator=""] {
  border: none;
  border-top: 1px solid var(--p-content-border-color);
  margin: 0.25rem 0;
}
</style>
