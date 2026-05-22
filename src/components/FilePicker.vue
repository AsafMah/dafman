<script setup lang="ts">
/// Pure popup body for the composer's @file / paperclip picker.
///
/// Owns: search input (optional), filter toggle, results list,
/// native-dialog escape hatch, keyboard nav.
///
/// Doesn't own: positioning / anchoring (parent renders this inside
/// a Teleport or Popover). Doesn't know about Lexical (parent listens
/// for `select` + inserts the AttachmentNode).
///
/// Two surfaces consume this:
///   1. MentionPlugin (the @-trigger path) — `:showSearchInput="false"`,
///      query comes from props (the text after the @).
///   2. The paperclip button — `:showSearchInput="true"`, picker
///      owns its own focused input.
///
/// Single-pick per spec: select dismisses the popup. Multi-select can
/// be re-opened. Directories attach as `directory` pills (matches the
/// existing AttachmentNode kind + folder icon).

import { computed, onMounted, ref, watch } from "vue";
import { invokeCommand } from "../ipc/invoke";
import type { WorkspaceFileMatch, SendMessageAttachment } from "../ipc/types";

const props = withDefaults(
  defineProps<{
    sessionId: string;
    /// External query (from the @ trigger). Ignored when
    /// `showSearchInput` is true (then the internal input drives).
    externalQuery?: string;
    /// When true, render a search input inside the popup and use it.
    /// When false, the parent (TypeaheadMenuPlugin) drives the query
    /// via `externalQuery` and the user types in the editor.
    showSearchInput?: boolean;
    /// Initial focus: where to send focus on mount. The paperclip
    /// path wants `"input"`; the @-trigger path wants `"none"` (the
    /// editor keeps focus).
    initialFocus?: "input" | "none";
  }>(),
  {
    externalQuery: "",
    showSearchInput: false,
    initialFocus: "none",
  },
);

const emit = defineEmits<{
  (e: "select", attachment: SendMessageAttachment): void;
  (e: "dismiss"): void;
}>();

const internalQuery = ref("");
const includeHidden = ref(false);
const results = ref<WorkspaceFileMatch[]>([]);
const highlightedIndex = ref(0);
const searchInputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

const effectiveQuery = computed(() =>
  props.showSearchInput ? internalQuery.value : props.externalQuery,
);

/// Debounce-free; the bun-side index is cached so calls are sub-ms.
/// We do guard against stale responses by tagging each fetch.
let fetchTag = 0;
async function fetchResults(): Promise<void> {
  const tag = ++fetchTag;
  try {
    const r = await invokeCommand("searchWorkspaceFiles", {
      sessionId: props.sessionId,
      query: effectiveQuery.value,
      limit: 40,
      includeHidden: includeHidden.value,
    });
    if (tag !== fetchTag) return; // stale
    results.value = r;
    highlightedIndex.value = 0;
  } catch {
    if (tag !== fetchTag) return;
    results.value = [];
    highlightedIndex.value = 0;
  }
}

watch(effectiveQuery, fetchResults, { immediate: true });
watch(includeHidden, fetchResults);

onMounted(() => {
  if (props.initialFocus === "input") {
    // Defer to next tick so the input is mounted under teleport.
    setTimeout(() => searchInputRef.value?.focus(), 0);
  }
});

function toAttachment(match: WorkspaceFileMatch): SendMessageAttachment {
  return match.kind === "directory"
    ? { type: "directory", path: match.absolutePath, displayName: match.path }
    : { type: "file", path: match.absolutePath, displayName: match.path };
}

function selectAt(index: number): void {
  const match = results.value[index];
  if (!match) return;
  emit("select", toAttachment(match));
}

function onInputKey(e: KeyboardEvent): void {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    highlightedIndex.value = Math.min(
      results.value.length - 1,
      highlightedIndex.value + 1,
    );
    scrollHighlightIntoView();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightedIndex.value = Math.max(0, highlightedIndex.value - 1);
    scrollHighlightIntoView();
  } else if (e.key === "Enter") {
    e.preventDefault();
    selectAt(highlightedIndex.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    emit("dismiss");
  }
}

/// Exposed so the @-trigger surface can forward keystrokes from the
/// editor (where focus actually lives) without us re-implementing the
/// nav logic.
defineExpose({
  moveHighlight(direction: 1 | -1): void {
    if (results.value.length === 0) return;
    if (direction > 0) {
      highlightedIndex.value = Math.min(
        results.value.length - 1,
        highlightedIndex.value + 1,
      );
    } else {
      highlightedIndex.value = Math.max(0, highlightedIndex.value - 1);
    }
    scrollHighlightIntoView();
  },
  pickCurrent(): SendMessageAttachment | null {
    const match = results.value[highlightedIndex.value];
    return match ? toAttachment(match) : null;
  },
  hasResults(): boolean {
    return results.value.length > 0;
  },
});

function scrollHighlightIntoView(): void {
  const list = listRef.value;
  if (!list) return;
  const child = list.querySelector<HTMLElement>(
    `[data-index="${highlightedIndex.value}"]`,
  );
  child?.scrollIntoView({ block: "nearest" });
}

async function browse(): Promise<void> {
  const picked = await invokeCommand("pickAttachment", {});
  if (!picked) return;
  emit(
    "select",
    picked.kind === "directory"
      ? { type: "directory", path: picked.path, displayName: picked.path }
      : { type: "file", path: picked.path, displayName: picked.path },
  );
}
</script>

<template>
  <div class="file-picker" role="dialog" aria-label="Attach file or folder">
    <div v-if="props.showSearchInput" class="file-picker-search">
      <i class="pi pi-search file-picker-search-icon" aria-hidden="true" />
      <input
        ref="searchInputRef"
        v-model="internalQuery"
        class="file-picker-search-input"
        type="text"
        placeholder="Search files / dirs, or type ~ /abs ./rel"
        aria-label="Search workspace"
        @keydown="onInputKey"
      />
    </div>
    <div class="file-picker-toolbar">
      <label class="file-picker-toggle">
        <input
          v-model="includeHidden"
          type="checkbox"
          aria-label="Include hidden files and ignored directories"
        />
        <span>Show hidden / ignored</span>
      </label>
      <button
        type="button"
        class="file-picker-browse"
        title="Open native file or folder picker"
        @click="browse"
      >
        <i class="pi pi-folder-open" aria-hidden="true" />
        Browse…
      </button>
    </div>
    <div
      ref="listRef"
      class="file-picker-list"
      role="listbox"
      aria-label="Matching files and directories"
    >
      <template v-if="results.length === 0">
        <div class="file-picker-empty">No matches.</div>
      </template>
      <template v-else>
        <button
          v-for="(r, i) in results"
          :key="`${r.absolutePath}::${r.kind}`"
          type="button"
          class="file-picker-item"
          :class="{ 'is-highlighted': i === highlightedIndex }"
          :data-index="i"
          role="option"
          :aria-selected="i === highlightedIndex"
          @mousedown.prevent
          @click="selectAt(i)"
          @mouseenter="highlightedIndex = i"
        >
          <i
            class="pi file-picker-item-icon"
            :class="r.kind === 'directory' ? 'pi-folder' : 'pi-file'"
            aria-hidden="true"
          />
          <span class="file-picker-item-text">
            <span class="file-picker-item-name">{{ r.name }}</span>
            <span class="file-picker-item-path">{{ r.path }}</span>
          </span>
          <span class="file-picker-item-kind">{{ r.kind === "directory" ? "dir" : "file" }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.file-picker {
  display: flex;
  flex-direction: column;
  min-width: 26rem;
  max-width: 36rem;
  max-height: 22rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  z-index: 100;
}

.file-picker-search {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--p-surface-border);
}

.file-picker-search-icon {
  font-size: 0.85rem;
  color: var(--p-text-muted-color);
}

.file-picker-search-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--p-text-color);
  font: inherit;
  font-size: 0.9rem;
}

.file-picker-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.35rem 0.6rem;
  border-bottom: 1px solid var(--p-surface-border);
  background: var(--p-surface-50, transparent);
}

.file-picker-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  cursor: pointer;
  user-select: none;
}

.file-picker-toggle input {
  accent-color: var(--p-primary-color);
}

.file-picker-browse {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  color: var(--p-text-color);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.file-picker-browse:hover {
  background: var(--p-content-hover-background);
}

.file-picker-list {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 0.25rem;
  max-height: 16rem;
  flex: 1;
}

.file-picker-empty {
  padding: 0.6rem 0.7rem;
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
}

.file-picker-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.35rem 0.55rem;
  background: transparent;
  border: 0;
  border-radius: var(--p-border-radius-sm);
  font: inherit;
  color: var(--p-text-color);
  text-align: left;
  cursor: pointer;
  width: 100%;
}

.file-picker-item.is-highlighted,
.file-picker-item:hover {
  background: var(--p-content-hover-background);
}

.file-picker-item-icon {
  font-size: 0.9rem;
  color: var(--p-text-muted-color);
  width: 1.2em;
  text-align: center;
  flex-shrink: 0;
}

.file-picker-item-text {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
  flex: 1;
}

.file-picker-item-name {
  font-size: 0.85rem;
  color: var(--p-text-color);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-picker-item-path {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-picker-item-kind {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}
</style>
