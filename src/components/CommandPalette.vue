<script setup lang="ts">
// Command palette overlay. Mounted once at the App.vue root.
//
// Built on top of PrimeVue `Dialog` rather than a third-party headless
// palette package — PrimeVue is already in, so theme tokens / z-index
// stacking / focus-trap / Escape-to-close all just work. The list +
// keyboard navigation + Fuse.js fuzzy match are custom (it's ~50 LOC).
//
// Hotkey: `Ctrl+K` (Windows/Linux) / `Cmd+K` (macOS). Strict modifier
// chord — no Shift, no Alt — to keep clear of composer bindings
// (`Ctrl+Enter`, `Ctrl+Shift+Enter`, `Alt+Enter`). We listen on
// `window` and call `preventDefault()` so the WebView doesn't surface
// any platform shortcut tied to the chord. Opens inside a contenteditable
// (Lexical composer) too — VSCode-style global override is the goal.
//
// Focus restore: we snapshot `document.activeElement` on open and
// restore it on close. If the previous focus target was inside a
// chat tile that's still mounted, focus returns there; otherwise we
// dispatch `dafman:focus-composer` for the active session as a
// fallback (same channel the Sessions sidebar uses).
//
// We also suppress the hotkey while a PrimeVue confirm popup or modal
// dialog is open — opening a palette on top of a destructive confirm
// would steal focus and break the confirm flow.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Fuse from "fuse.js";
import { useCommandRegistry, type Command } from "../stores/commandRegistry";
import { useLayoutStore } from "../stores/layoutStore";

const registry = useCommandRegistry();
const layoutStore = useLayoutStore();

const open = ref(false);
const query = ref("");
const selectedIndex = ref(0);
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
/// Element to restore focus to when the palette closes. Snapshot taken
/// at open time so the Dialog's focus-trap doesn't interfere.
let prevFocus: HTMLElement | null = null;

const fuse = computed(
  () =>
    new Fuse(registry.visibleCommands, {
      keys: [
        { name: "label", weight: 2 },
        { name: "group", weight: 0.5 },
        { name: "hint", weight: 0.5 },
        { name: "keywords", weight: 1 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: false,
    }),
);

const filtered = computed<Command[]>(() => {
  const q = query.value.trim();
  if (!q) return registry.visibleCommands;
  return fuse.value.search(q).map((r) => r.item);
});

watch(filtered, () => {
  selectedIndex.value = 0;
});

function isModalOpen(): boolean {
  // PrimeVue stamps these on mounted overlays. Confirm popup +
  // dialog masks are the ones that should block the palette hotkey.
  return Boolean(
    document.querySelector(".p-confirmpopup, .p-dialog-mask:not(.p-command-palette-mask)"),
  );
}

function onHotkey(e: KeyboardEvent): void {
  if (e.repeat) return;
  if (e.key !== "k" && e.key !== "K") return;
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const cmdChord = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!cmdChord) return;
  if (e.altKey || e.shiftKey) return;
  if (isModalOpen()) return;
  e.preventDefault();
  e.stopPropagation();
  if (open.value) {
    closePalette();
  } else {
    openPalette();
  }
}

function openPalette(): void {
  prevFocus = (document.activeElement as HTMLElement | null) ?? null;
  query.value = "";
  selectedIndex.value = 0;
  open.value = true;
  // Focus the input after the Dialog has actually mounted.
  void nextTick(() => {
    inputEl.value?.focus();
  });
}

function closePalette(): void {
  open.value = false;
  // Defer restore until after the Dialog tears down (so its focus-trap
  // doesn't pull focus back).
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

function selectIndex(idx: number): void {
  const n = filtered.value.length;
  if (n === 0) return;
  selectedIndex.value = ((idx % n) + n) % n;
  void nextTick(() => {
    const row = listEl.value?.querySelector<HTMLElement>(`[data-cmd-idx="${selectedIndex.value}"]`);
    row?.scrollIntoView({ block: "nearest" });
  });
}

function runSelected(): void {
  const cmd = filtered.value[selectedIndex.value];
  if (!cmd) return;
  closePalette();
  // Defer execution so the close finishes (focus restore, dialog
  // teardown) before the command does anything UI-affecting.
  void nextTick(() => {
    try {
      const result = cmd.run();
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).catch((err) => {
          // Surfacing errors is the toastStore's job; commands that
          // care about success/failure should already be toasting. We
          // still log so failures aren't silent.
          console.error(`[command palette] ${cmd.id} failed`, err);
        });
      }
    } catch (err) {
      console.error(`[command palette] ${cmd.id} threw`, err);
    }
  });
}

function onInputKeydown(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectIndex(selectedIndex.value + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectIndex(selectedIndex.value - 1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    runSelected();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closePalette();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onHotkey, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onHotkey, true);
});

/// Group adjacent same-group commands so the list renders one header
/// per group. Items in the search result preserve the order Fuse
/// returned them in, but we still surface group context next to each
/// row label (since search results break the natural clustering).
const grouped = computed(() => {
  const result: Array<{ group: string | null; items: Command[] }> = [];
  for (const cmd of filtered.value) {
    const g = cmd.group ?? null;
    const last = result[result.length - 1];
    if (last && last.group === g) {
      last.items.push(cmd);
    } else {
      result.push({ group: g, items: [cmd] });
    }
  }
  return result;
});

function flatIndex(groupIdx: number, itemIdx: number): number {
  let n = 0;
  for (let i = 0; i < groupIdx; i++) n += grouped.value[i]?.items.length ?? 0;
  return n + itemIdx;
}
</script>

<template>
  <Dialog
    v-model:visible="open"
    :modal="true"
    :closable="false"
    :dismissable-mask="true"
    :draggable="false"
    :show-header="false"
    :pt="{ mask: { class: 'p-command-palette-mask' } }"
    class="command-palette"
    @hide="closePalette"
  >
    <div class="palette-shell">
      <div class="palette-input-row">
        <i class="pi pi-search palette-search-icon" aria-hidden="true" />
        <input
          ref="inputEl"
          v-model="query"
          class="palette-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Type a command…"
          aria-label="Command palette search"
          @keydown="onInputKeydown"
        />
        <span class="palette-hint">Esc</span>
      </div>
      <div
        ref="listEl"
        class="palette-list"
        role="listbox"
        aria-label="Commands"
      >
        <p v-if="filtered.length === 0" class="palette-empty">
          No matching commands.
        </p>
        <template v-else>
          <template v-for="(section, gi) in grouped" :key="section.group ?? `__nogroup_${gi}`">
            <div v-if="section.group" class="palette-section">{{ section.group }}</div>
            <button
              v-for="(cmd, ii) in section.items"
              :key="cmd.id"
              type="button"
              class="palette-row"
              :class="{ 'is-selected': flatIndex(gi, ii) === selectedIndex }"
              :data-cmd-idx="flatIndex(gi, ii)"
              role="option"
              :aria-selected="flatIndex(gi, ii) === selectedIndex"
              @mouseenter="selectedIndex = flatIndex(gi, ii)"
              @click="runSelected"
            >
              <i
                v-if="cmd.icon"
                class="palette-row-icon"
                :class="cmd.icon"
                aria-hidden="true"
              />
              <span v-else class="palette-row-icon palette-row-icon-empty" />
              <span class="palette-row-label">{{ cmd.label }}</span>
              <span v-if="cmd.hint" class="palette-row-hint">{{ cmd.hint }}</span>
            </button>
          </template>
        </template>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
/* Dialog content is the palette shell — kill the default Dialog
 * padding so the input row sits flush at the top. */
:deep(.p-dialog) {
  width: min(640px, 92vw);
  max-width: 92vw;
}
:deep(.p-dialog .p-dialog-content) {
  padding: 0;
  background: var(--p-content-background);
  border-radius: var(--p-border-radius-lg, 0.75rem);
  overflow: hidden;
}

.palette-shell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 70vh;
}

.palette-input-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.palette-search-icon {
  font-size: 0.95rem;
  color: var(--p-text-muted-color);
}

.palette-input {
  flex: 1 1 auto;
  background: transparent;
  border: none;
  outline: none;
  color: var(--p-text-color);
  font: inherit;
  font-size: 0.95rem;
}

.palette-hint {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.palette-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0.25rem 0;
}

.palette-empty {
  margin: 0;
  padding: 1.25rem 1rem;
  color: var(--p-text-muted-color);
  text-align: center;
  font-size: 0.9rem;
}

.palette-section {
  padding: 0.5rem 1rem 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

.palette-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 1rem;
  background: transparent;
  border: none;
  color: var(--p-text-color);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.palette-row.is-selected {
  background: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}

.palette-row-icon {
  width: 1rem;
  flex: 0 0 auto;
  font-size: 0.95rem;
  color: var(--p-text-muted-color);
  text-align: center;
}

.palette-row-icon-empty {
  display: inline-block;
}

.palette-row-label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.92rem;
}

.palette-row-hint {
  flex: 0 0 auto;
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
</style>
