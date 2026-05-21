<script setup lang="ts">
/// @file mention typeahead for the composer.
///
/// Triggers on "@" + at least one character, queries the bun-side
/// workspace file index via `searchWorkspaceFiles`, and on select
/// (a) inserts the relative path as a text token in the editor (so
/// it ships with the message), and (b) emits `attach` so the parent
/// composer appends the file as an SDK `attachment`. The two
/// approaches together give the LLM both the textual hint and the
/// structured attachment — empirically the best signal.

import { computed, onMounted, ref, watch } from "vue";
import { TextNode, $createTextNode, $isTextNode } from "lexical";
import {
  TypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "lexical-vue/LexicalTypeaheadMenuPlugin";
import { useLexicalComposer } from "lexical-vue/LexicalComposer";
import { invokeCommand } from "../ipc/invoke";
import { $createAttachmentNode } from "../lexical/AttachmentNode";
import type {
  WorkspaceFileMatch,
  SendMessageAttachment,
} from "../ipc/types";

class FileOption extends MenuOption {
  match: WorkspaceFileMatch;
  constructor(match: WorkspaceFileMatch) {
    super(match.absolutePath);
    this.match = match;
  }
}

const props = defineProps<{
  sessionId: string;
}>();

const editor = useLexicalComposer();
const query = ref("");
const results = ref<WorkspaceFileMatch[]>([]);
const menuParent = ref<HTMLElement | null>(null);

onMounted(() => {
  if (typeof document !== "undefined") menuParent.value = document.body;
});

/// Re-fetch on query change. Debounce-free for now — the bun index
/// is cached, so subsequent calls are sub-millisecond.
watch(query, async (q) => {
  if (q.length === 0) {
    // Show the top-of-tree files even on a bare "@".
    try {
      results.value = await invokeCommand("searchWorkspaceFiles", {
        sessionId: props.sessionId,
        query: "",
        limit: 30,
      });
    } catch {
      results.value = [];
    }
    return;
  }
  try {
    results.value = await invokeCommand("searchWorkspaceFiles", {
      sessionId: props.sessionId,
      query: q,
      limit: 40,
    });
  } catch {
    results.value = [];
  }
});

const options = computed(() =>
  results.value.map((r) => new FileOption(r)),
);

/// Trigger on "@". `minLength: 0` so we show the menu immediately on
/// "@" and refine as the user types. `allowWhitespace: false` keeps
/// "@ " from spuriously activating mid-sentence.
const triggerFn = useBasicTypeaheadTriggerMatch("@", {
  minLength: 0,
  allowWhitespace: false,
});

function onQueryChange(q: string | null) {
  query.value = q ?? "";
}

function onSelectOption(payload: {
  option: FileOption;
  textNodeContainingQuery: TextNode | null;
  closeMenu: () => void;
}) {
  const { option, textNodeContainingQuery, closeMenu } = payload;
  // Replace the typed "@que" with an inline AttachmentNode pill so the
  // file reference reads as `text text (path/to/file) text` instead of
  // raw `@path/to/file `. The pill carries the structured attachment
  // payload, and its text content (`(filename)`) flows through the
  // standard markdown serializer.
  const attachment: SendMessageAttachment = {
    type: "file",
    path: option.match.absolutePath,
    displayName: option.match.path,
  };
  editor.update(() => {
    if (textNodeContainingQuery && $isTextNode(textNodeContainingQuery)) {
      const pill = $createAttachmentNode(attachment);
      textNodeContainingQuery.replace(pill);
      // Trailing space so the caret lands after the pill ready for more text.
      const space = $createTextNode(" ");
      pill.insertAfter(space);
      space.selectEnd();
    }
  });
  closeMenu();
}
</script>

<template>
  <TypeaheadMenuPlugin
    v-if="menuParent"
    :options="options"
    :trigger-fn="triggerFn"
    :parent="menuParent"
    @query-change="onQueryChange"
    @select-option="onSelectOption"
  >
    <template #default="{ anchorElementRef, itemProps }">
      <Teleport
        v-if="itemProps.options.length > 0 && anchorElementRef"
        :to="anchorElementRef"
      >
        <div
          class="mention-menu"
          role="listbox"
        >
          <button
            v-for="(opt, i) in (itemProps.options as FileOption[])"
            :key="opt.match.absolutePath"
            type="button"
            class="mention-item"
            :class="{ 'is-selected': i === itemProps.selectedIndex }"
            role="option"
            :aria-selected="i === itemProps.selectedIndex"
            @mousedown.prevent
            @click="itemProps.selectOptionAndCleanUp(opt)"
            @mouseenter="itemProps.setHighlightedIndex(i)"
          >
            <i class="pi pi-file mention-item-icon" aria-hidden="true" />
            <span class="mention-item-text">
              <span class="mention-item-name">{{ opt.match.name }}</span>
              <span class="mention-item-path">{{ opt.match.path }}</span>
            </span>
          </button>
        </div>
      </Teleport>
    </template>
  </TypeaheadMenuPlugin>
</template>

<style scoped>
.mention-menu {
  display: flex;
  flex-direction: column;
  min-width: 24rem;
  max-height: 18rem;
  overflow-y: auto;
  padding: 0.25rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.28);
  transform: translateY(calc(-100% - 2rem));
  z-index: 100;
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  background: transparent;
  border: 0;
  border-radius: var(--p-border-radius-sm);
  font: inherit;
  color: var(--p-text-color);
  text-align: left;
  cursor: pointer;
  width: 100%;
}

.mention-item.is-selected,
.mention-item:hover {
  background: var(--p-content-hover-background);
}

.mention-item-icon {
  font-size: 0.9rem;
  color: var(--p-text-muted-color);
  width: 1.2em;
  text-align: center;
}

.mention-item-text {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
  flex: 1;
}

.mention-item-name {
  font-size: 0.85rem;
  color: var(--p-text-color);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mention-item-path {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
