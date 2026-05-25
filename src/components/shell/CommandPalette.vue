<script setup lang="ts">
// Command palette overlay built on `vue-command-palette`.
//
// **Library DOM hierarchy (verified by reading the compiled
// `vue-command-palette.js`):**
//
//   <div command-theme="dafman">
//     <div command-root="">
//       <div command-dialog="">
//         <div command-dialog-mask="">           ← fixed full-viewport overlay
//           <div command-dialog-wrapper="">      ← THE actual dialog box (max-height lives here)
//             <div command-dialog-header="">     ← header slot (Command.Input)
//             <div command-dialog-body="">       ← body slot (Command.List)
//               <div command-list="" role="listbox">
//                 <div command-list-sizer="">   ← sized by library's ResizeObserver
//                   ... groups + items ...
//
// The earlier styling put the bounded-box rules on `[command-dialog=""]`
// (an outer wrapper that just `display: contents`) instead of
// `[command-dialog-wrapper]`, so the dialog had no height bound and
// scrolled off-screen. Comments + structure tests added so this
// doesn't recur.
//
// **Library quirks discovered the hard way:**
//
// - `Command.Item`'s `:perform` fires ONLY for keyboard shortcuts
//   (the lib checks `t.shortcut.length > 0 && t.perform()`). Clicks
//   and Enter-on-selected go through `@select-item` on `Command.Dialog`
//   emitting `{ key, value }` where `value` is each item's
//   `data-value` attribute. We use `data-value` for lookup + as the
//   searchable text (library's fuse indexes on it).
//
// - `Command.Dialog` teleports to `document.body`. CSS rules must
//   be unscoped, and tests must clean teleported nodes between
//   cases (see `__tests__/CommandPalette.test.ts` afterEach).

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { Command } from 'vue-command-palette';
import { useCommandRegistry, type Command as CommandDef } from '@/stores/shell/commandRegistry';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { searchValueFor } from '@/lib/palette';
import { emit as busEmit } from '@/lib/bus';

const registry = useCommandRegistry();
const layoutStore = useLayoutStore();

const open = ref(false);
let prevFocus: HTMLElement | null = null;

const visibleCommands = computed(() => registry.visibleCommands);

const valueToCommand = computed(() => {
  const map = new Map<string, CommandDef>();

  for (const cmd of visibleCommands.value) {
    map.set(searchValueFor(cmd), cmd);
  }

  return map;
});

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
  return Boolean(document.querySelector('.p-confirmpopup, .p-dialog-mask'));
}

function onHotkey(e: KeyboardEvent): void {
  if (e.repeat) return;

  if (e.key !== 'k' && e.key !== 'K') return;

  const isMac = navigator.platform.toUpperCase().includes('MAC');
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

  if (e.key !== 'Escape') return;

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
      busEmit('focus-composer', { sessionId: layoutStore.activeSessionId });
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

      if (result && typeof result.then === 'function') {
        void result.catch((err: unknown) => {
          console.error(`[command palette] ${cmd.id} failed`, err);
        });
      }
    } catch (err) {
      console.error(`[command palette] ${cmd.id} threw`, err);
    }
  });
}

function onWindowClick(e: MouseEvent): void {
  if (!open.value) return;

  const target = e.target as HTMLElement | null;

  if (!target) return;

  if (target.hasAttribute('command-dialog-mask')) {
    closePalette();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onHotkey, true);
  window.addEventListener('keydown', onEscape, true);
  window.addEventListener('click', onWindowClick, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onHotkey, true);
  window.removeEventListener('keydown', onEscape, true);
  window.removeEventListener('click', onWindowClick, true);
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
          v-for="[heading, items] in grouped.sections"
          :key="heading"
          :heading="heading"
          :data-group="heading"
        >
          <Command.Item
            v-for="cmd in items"
            :key="cmd.id"
            :data-value="searchValueFor(cmd)"
            :data-group="cmd.group ?? ''"
            :shortcut="cmd.shortcut"
            :style="cmd.accent ? { '--cmd-accent': cmd.accent } : {}"
            :data-has-accent="cmd.accent ? 'true' : 'false'"
          >
            <i
              v-if="cmd.icon"
              class="cmd-icon"
              :class="cmd.icon"
              aria-hidden="true"
            />
            <span
              v-else
              class="cmd-icon cmd-icon-empty"
            />
            <span class="cmd-label">{{ cmd.label }}</span>
            <span
              v-if="cmd.hint"
              class="cmd-hint"
              >{{ cmd.hint }}</span
            >
            <span
              v-if="cmd.shortcut && cmd.shortcut.length > 0"
              class="cmd-shortcut"
              aria-label="Keyboard shortcut"
            >
              <kbd
                v-for="(k, idx) in cmd.shortcut"
                :key="idx"
                >{{ k }}</kbd
              >
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
            :style="cmd.accent ? { '--cmd-accent': cmd.accent } : {}"
            :data-has-accent="cmd.accent ? 'true' : 'false'"
          >
            <i
              v-if="cmd.icon"
              class="cmd-icon"
              :class="cmd.icon"
              aria-hidden="true"
            />
            <span
              v-else
              class="cmd-icon cmd-icon-empty"
            />
            <span class="cmd-label">{{ cmd.label }}</span>
            <span
              v-if="cmd.hint"
              class="cmd-hint"
              >{{ cmd.hint }}</span
            >
            <span
              v-if="cmd.shortcut && cmd.shortcut.length > 0"
              class="cmd-shortcut"
              aria-label="Keyboard shortcut"
            >
              <kbd
                v-for="(k, idx) in cmd.shortcut"
                :key="idx"
                >{{ k }}</kbd
              >
            </span>
          </Command.Item>
        </template>
      </Command.List>
    </template>
  </Command.Dialog>
</template>

<style>
/*
 * CRITICAL: the actual bounded "dialog box" is `[command-dialog-wrapper]`,
 * NOT `[command-dialog=""]`. The latter is an inert outer div.
 * See the structure comment in `<script>` and the DOM-structure tests
 * in `CommandPalette.test.ts`.
 */

/* Flatten the outer chrome so the mask can position-fixed the real
 * dialog. Without `display: contents` the intermediate divs trap the
 * mask's fixed-positioning context and screw with stacking. */
div[command-theme='dafman'],
div[command-theme='dafman'] > div[command-root=''],
div[command-theme='dafman'] > div[command-root=''] > div[command-dialog=''] {
  display: contents;
}

/* The mask is the full-viewport overlay. Centers the wrapper. */
div[command-dialog-mask] {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: color-mix(in srgb, var(--p-mask-background, rgb(0 0 0 / 35%)) 100%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  /* NO backdrop-filter — caused the "whole screen blurred" complaint.
   * The mask alone provides enough visual separation. */
}

/* THE dialog box. All bounding lives here. */
div[command-dialog-wrapper] {
  width: min(640px, 92vw);
  max-width: 92vw;
  max-height: 80vh;
  background: var(--p-content-background);
  color: var(--p-text-color);
  border: 1px solid color-mix(in srgb, var(--p-primary-color) 40%, var(--p-content-border-color));
  border-radius: 0.75rem;
  box-shadow:
    0 24px 56px -12px color-mix(in srgb, black 60%, transparent),
    0 0 0 1px color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

div[command-dialog-header] {
  flex: 0 0 auto;
}

/* The body must be a flex column with `min-height: 0` for its
 * `[command-list]` descendant to be scrollable instead of pushing the
 * wrapper past `max-height`. */
div[command-dialog-body] {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

input[command-input=''] {
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

input[command-input='']::placeholder {
  color: var(--p-text-muted-color);
}

div[command-list=''] {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0.35rem 0 0.5rem;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--p-text-color) 25%, transparent) transparent;
}

div[command-list-sizer] {
  display: block;
}

div[command-empty=''] {
  padding: 1.5rem 1rem;
  color: var(--p-text-muted-color);
  text-align: center;
  font-size: 0.9rem;
}

/* ----- group / item visuals + per-category accents ----- */

/* Default group heading color: muted. Per-group heading colors come
 * from the `[data-group]` attribute we put on the group element. */
div[command-group-heading=''] {
  padding: 0.55rem 1rem 0.25rem;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

/* Category color-coding. Each known group label resolves to a token
 * we can also reuse on the row's left rail / icon. The user-asked
 * "color-coded categories" lives here — pick colors that read on
 * both light and dark by using `--p-{hue}-{500,400}` semantic
 * tokens (PrimeVue ships these). */
div[command-group=''][data-group='Navigation'] div[command-group-heading=''] {
  color: var(--p-blue-500, #3b82f6);
}
div[command-group=''][data-group='Sessions'] div[command-group-heading=''] {
  color: var(--p-emerald-500, #10b981);
}
div[command-group=''][data-group='Active Session'] div[command-group-heading=''] {
  color: var(--p-violet-500, #8b5cf6);
}
div[command-group=''][data-group='Appearance'] div[command-group-heading=''] {
  color: var(--p-amber-500, #f59e0b);
}
div[command-group=''][data-group='Diagnostics'] div[command-group-heading=''] {
  color: var(--p-orange-500, #f97316);
}

/* Per-group accent passed down to items via custom property so the
 * item rail + icon adopt the section's hue. Items can also override
 * via `--cmd-accent` inline style (see "Switch to: session" — that
 * uses the session's own accent). */
div[command-group=''][data-group='Navigation'] div[command-item=''] {
  --cmd-accent: var(--p-blue-500, #3b82f6);
}
div[command-group=''][data-group='Sessions'] div[command-item=''] {
  --cmd-accent: var(--p-emerald-500, #10b981);
}
div[command-group=''][data-group='Active Session'] div[command-item=''] {
  --cmd-accent: var(--p-violet-500, #8b5cf6);
}
div[command-group=''][data-group='Appearance'] div[command-item=''] {
  --cmd-accent: var(--p-amber-500, #f59e0b);
}
div[command-group=''][data-group='Diagnostics'] div[command-item=''] {
  --cmd-accent: var(--p-orange-500, #f97316);
}

/* Per-item override (e.g. session-specific accent on "Switch to: …").
 * Inline `style="--cmd-accent: ..."` wins via specificity-of-style. */

div[command-item=''] {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 1rem 0.45rem calc(1rem + 3px);
  cursor: pointer;
  color: var(--p-text-color);
  font-size: 0.92rem;
  border-left: 3px solid transparent;
  transition:
    background 80ms ease,
    color 80ms ease,
    border-left-color 80ms ease;
}

/* Idle: thin tinted rail in the category accent so groups read at a
 * glance even when scrolled past the heading. */
div[command-item=''][style*='--cmd-accent'],
div[command-item=''] {
  border-left-color: color-mix(in srgb, var(--cmd-accent, var(--p-primary-color)) 35%, transparent);
}

/* Selected via keyboard nav. Library sets aria-selected="true". */
div[command-item=''][aria-selected='true'] {
  background: color-mix(in srgb, var(--cmd-accent, var(--p-primary-color)) 22%, transparent);
  border-left-color: var(--cmd-accent, var(--p-primary-color));
}

/* Hover (mouse). Distinct from selected so users can read what
 * they'd hit if they Enter'd vs what they're hovering. */
div[command-item='']:hover:not([aria-selected='true']) {
  background: color-mix(in srgb, var(--cmd-accent, var(--p-primary-color)) 12%, transparent);
}

/* Hidden by the library when filtered out via fuse. */
div[command-item=''][style*='display: none'] {
  display: none !important;
}

.cmd-icon {
  width: 1rem;
  flex: 0 0 auto;
  font-size: 0.95rem;
  /* Per-category icon color via the same custom property. */
  color: var(--cmd-accent, var(--p-primary-color));
  text-align: center;
}

div[command-item=''][aria-selected='true'] .cmd-icon {
  color: var(--p-text-color);
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

hr[command-separator=''] {
  border: none;
  border-top: 1px solid var(--p-content-border-color);
  margin: 0.4rem 0;
}
</style>
