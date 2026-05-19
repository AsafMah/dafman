<script setup lang="ts">
// Command palette overlay built on `vue-command-palette`
// (xiaoluoboding/vue-command-palette).
//
// **Library quirks discovered the hard way (see the unit test in
// `CommandPalette.test.ts`):**
//
// - `Command.Item`'s `perform` prop only fires for KEYBOARD SHORTCUTS
//   (the lib checks `t.shortcut.length > 0 && t.perform()`). Clicks
//   and Enter-on-selected go through `@select-item` on the parent
//   `Command.Root` / `Command.Dialog`, emitting `{ key, value }`
//   where `value` is each item's `data-value` attribute. We use that
//   to map back to our `Command` registry entry.
//
// - The library's fuzzy search reads `data-value` as the
//   searchable text (NOT slot text content). Default fuse options:
//   `{ threshold: 0.2, keys: ['label'] }` where each indexed item is
//   `{ key: command-item-key (auto), label: data-value }`. So our
//   `data-value` must be a human-searchable composite of label +
//   group + hint + keywords (and, to keep values unique per
//   command, the id appended). We then look the command up via a
//   `valueToCommand` map.
//
// - The dialog teleports to `body`, so `Command.Dialog`'s mask,
//   wrapper, and dialog elements live OUTSIDE our component root.
//   Theme via CSS rules on the library's `[command-*=""]`
//   data-attribute selectors (NOT scoped).
//
// Hotkey: Ctrl+K (Win/Linux) / Cmd+K (macOS). Strict modifier chord
// — no Shift, no Alt. Suppressed while a PrimeVue confirm/dialog
// overlay is open so destructive confirms aren't hijacked.
//
// Closing: Escape, or clicking the mask, or selecting an item.
// (Library handles ↑/↓/Enter navigation internally.)

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Command } from "vue-command-palette";
import { useCommandRegistry, type Command as CommandDef } from "../stores/commandRegistry";
import { useLayoutStore } from "../stores/layoutStore";
import { searchValueFor } from "../lib/palette";

const registry = useCommandRegistry();
const layoutStore = useLayoutStore();

const open = ref(false);
let prevFocus: HTMLElement | null = null;

const visibleCommands = computed(() => registry.visibleCommands);

/// Lookup table from data-value → command. Rebuilt whenever the
/// visible command set changes; the search value is unique because
/// it starts with the command id.
const valueToCommand = computed(() => {
  const map = new Map<string, CommandDef>();
  for (const cmd of visibleCommands.value) {
    map.set(searchValueFor(cmd), cmd);
  }
  return map;
});

/// Group adjacent same-group commands so each section renders under
/// one heading. Ungrouped commands go into a final unnamed bucket.
const grouped = computed(() => {
  const sections = new Map<string, CommandDef[]>();
  const ungrouped: CommandDef[] = [];
  for (const cmd of visibleCommands.value) {
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

function isOtherOverlayOpen(): boolean {
  return Boolean(document.querySelector(".p-confirmpopup, .p-dialog-mask"));
}

function onHotkey(e: KeyboardEvent): void {
  if (e.repeat) return;
  if (e.key !== "k" && e.key !== "K") return;
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const cmdChord = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!cmdChord) return;
  if (e.altKey || e.shiftKey) return;
  if (!open.value && isOtherOverlayOpen()) return;
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

function onSelectItem(item: { key: string; value: string }): void {
  const cmd = valueToCommand.value.get(item.value);
  closePalette();
  if (!cmd) return;
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
}

/// Click on the backdrop closes the palette. The library doesn't
/// expose a mask-click event, so we attach a global listener while
/// the palette is open and check the target for the mask attribute.
function onWindowClick(e: MouseEvent): void {
  if (!open.value) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.hasAttribute("command-dialog-mask")) {
    closePalette();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onHotkey, true);
  window.addEventListener("keydown", onEscape, true);
  window.addEventListener("click", onWindowClick, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onHotkey, true);
  window.removeEventListener("keydown", onEscape, true);
  window.removeEventListener("click", onWindowClick, true);
});

defineExpose({
  /// Test-only: open the palette imperatively.
  __testOpen() {
    openPalette();
  },
});
</script>

<template>
  <Command.Dialog
    :visible="open"
    theme="dafman"
    @select-item="onSelectItem"
  >
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
            :data-value="searchValueFor(cmd)"
            :shortcut="cmd.shortcut"
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
            <span
              v-if="cmd.shortcut && cmd.shortcut.length > 0"
              class="cmd-shortcut"
              aria-label="Keyboard shortcut"
            >
              <kbd v-for="(k, idx) in cmd.shortcut" :key="idx">{{ k }}</kbd>
            </span>
          </Command.Item>
        </Command.Group>

        <template v-if="grouped.ungrouped.length > 0">
          <Command.Separator />
          <Command.Item
            v-for="cmd in grouped.ungrouped"
            :key="cmd.id"
            :data-value="searchValueFor(cmd)"
            :shortcut="cmd.shortcut"
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
            <span
              v-if="cmd.shortcut && cmd.shortcut.length > 0"
              class="cmd-shortcut"
              aria-label="Keyboard shortcut"
            >
              <kbd v-for="(k, idx) in cmd.shortcut" :key="idx">{{ k }}</kbd>
            </span>
          </Command.Item>
        </template>
      </Command.List>
    </template>
  </Command.Dialog>
</template>

<style>
/* `theme="dafman"` opts out of the library's built-in styles. Rules
 * are unscoped because the library teleports Command.Dialog to body.
 * Selectors target the library's `[command-*=""]` data attributes. */

/* Backdrop. Dim + light blur — strong enough that the palette pops
 * but not so much that the app behind looks broken. Mask covers the
 * whole viewport; the dialog centers inside it via flex. */
div[command-dialog-mask] {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: color-mix(in srgb, var(--p-text-color) 40%, transparent);
  backdrop-filter: blur(1px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
}

div[command-dialog=""] {
  width: min(640px, 92vw);
  max-width: 92vw;
  max-height: 70vh;
  background: var(--p-content-background);
  color: var(--p-text-color);
  border: 1px solid color-mix(in srgb, var(--p-primary-color) 30%, var(--p-content-border-color));
  border-radius: 0.75rem;
  box-shadow:
    0 24px 48px -12px color-mix(in srgb, black 50%, transparent),
    0 0 0 1px color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* The library wraps each panel section in its own div; we drive
   * the inner scroll from `[command-list=""]`. */
}

div[command-root=""] {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

div[command-dialog-header] {
  flex: 0 0 auto;
}

div[command-dialog-body] {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

input[command-input=""] {
  display: block;
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--p-text-color);
  font: inherit;
  font-size: 1rem;
  padding: 0.95rem 1.1rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

input[command-input=""]::placeholder {
  color: var(--p-text-muted-color);
}

div[command-list=""] {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0.35rem 0 0.5rem;
  /* Custom scrollbar that doesn't look like a 90s widget on Windows */
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--p-text-color) 25%, transparent) transparent;
}

div[command-empty=""] {
  padding: 1.5rem 1rem;
  color: var(--p-text-muted-color);
  text-align: center;
  font-size: 0.9rem;
}

div[command-group-heading=""] {
  padding: 0.55rem 1rem 0.25rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--p-primary-color) 80%, var(--p-text-muted-color));
}

div[command-item=""] {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 1rem;
  cursor: pointer;
  color: var(--p-text-color);
  font-size: 0.92rem;
  /* Smooth selection transition. */
  transition: background 80ms ease, color 80ms ease;
}

/* Selected (keyboard nav). The library toggles `aria-selected="true"`. */
div[command-item=""][aria-selected="true"] {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, white);
}

div[command-item=""][aria-selected="true"] .cmd-icon,
div[command-item=""][aria-selected="true"] .cmd-hint,
div[command-item=""][aria-selected="true"] kbd {
  color: var(--p-primary-contrast-color, white);
}

/* Hover (mouse). Distinct from selected so users can read what
 * they'd hit if they Enter'd vs what they're hovering. */
div[command-item=""]:hover:not([aria-selected="true"]) {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}

/* Hidden by the library when filtered out via fuse. */
div[command-item=""][style*="display: none"] {
  display: none !important;
}

.cmd-icon {
  width: 1rem;
  flex: 0 0 auto;
  font-size: 0.95rem;
  color: var(--p-primary-color);
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
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmd-shortcut {
  display: inline-flex;
  gap: 0.2rem;
  flex: 0 0 auto;
}

.cmd-shortcut kbd {
  font: inherit;
  font-size: 0.72rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  background: color-mix(in srgb, var(--p-text-color) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--p-text-color) 12%, transparent);
  color: var(--p-text-muted-color);
}

hr[command-separator=""] {
  border: none;
  border-top: 1px solid var(--p-content-border-color);
  margin: 0.4rem 0;
}
</style>
