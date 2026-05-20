<script setup lang="ts">
/// Slash-command typeahead for the composer. Triggers on "/" at any
/// word boundary, surfaces the SDK-reported command list, and on
/// select replaces the typeahead match with the full command name.
/// The user then hits Enter (or adds args) and the SDK handles
/// execution — the renderer doesn't dispatch anything special.
///
/// The command list is the per-session `record.commands` populated
/// by the `commands.changed` event handler in sessionsStore.

import { computed } from "vue";
import { TextNode } from "lexical";
import {
  TypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "lexical-vue/LexicalTypeaheadMenuPlugin";

interface SlashCommand {
  name: string;
  description?: string;
}

const props = defineProps<{
  commands: SlashCommand[];
}>();

class SlashOption extends MenuOption {
  cmd: SlashCommand;
  constructor(cmd: SlashCommand) {
    super(cmd.name);
    this.cmd = cmd;
  }
}

const allOptions = computed(() =>
  (props.commands ?? []).map((c) => new SlashOption(c)),
);

const triggerFn = useBasicTypeaheadTriggerMatch("/", {
  minLength: 0,
  allowWhitespace: false,
});

// Filter options against the current query (the chars typed after "/").
function filterOptions(query: string): SlashOption[] {
  const lower = query.toLowerCase();
  if (lower.length === 0) return allOptions.value;
  return allOptions.value.filter((o) =>
    o.cmd.name.toLowerCase().includes(lower),
  );
}

let queryRef = "";

function onQueryChange(q: string | null) {
  queryRef = q ?? "";
}

function onSelectOption(payload: {
  option: SlashOption;
  textNodeContainingQuery: TextNode | null;
  closeMenu: () => void;
  matchingString: string;
}) {
  const { option, textNodeContainingQuery, closeMenu } = payload;
  // Replace the typed "/que" with "/queue " (full command name + trailing
  // space so the user can keep typing arguments).
  if (textNodeContainingQuery) {
    textNodeContainingQuery.setTextContent(`${option.cmd.name} `);
    textNodeContainingQuery.selectEnd();
  }
  closeMenu();
}
</script>

<template>
  <TypeaheadMenuPlugin
    :options="filterOptions(queryRef)"
    :trigger-fn="triggerFn"
    @query-change="onQueryChange"
    @select-option="onSelectOption"
  >
    <template
      #default="{ anchorElementRef, itemProps }"
    >
      <div
        v-if="itemProps.options.length > 0 && anchorElementRef"
        class="slash-menu"
        role="listbox"
      >
        <button
          v-for="(opt, i) in (itemProps.options as SlashOption[])"
          :key="opt.cmd.name"
          type="button"
          class="slash-item"
          :class="{ 'is-selected': i === itemProps.selectedIndex }"
          role="option"
          :aria-selected="i === itemProps.selectedIndex"
          @mousedown.prevent
          @click="itemProps.selectOptionAndCleanUp(opt)"
          @mouseenter="itemProps.setHighlightedIndex(i)"
        >
          <span class="slash-item-name">{{ opt.cmd.name }}</span>
          <span v-if="opt.cmd.description" class="slash-item-desc">
            {{ opt.cmd.description }}
          </span>
        </button>
      </div>
    </template>
  </TypeaheadMenuPlugin>
</template>

<style scoped>
.slash-menu {
  /* The plugin positions the anchor div at the typing caret. Pull
   * the menu visually upward via translateY(-100%) so it pops ABOVE
   * the trigger character rather than below — matches user
   * expectation for a composer pinned to the bottom of the chat
   * tile. The -0.5rem nudge lifts it just clear of the caret. */
  position: absolute;
  bottom: 1.5em;
  left: 0;
  transform: translateY(0);
  display: flex;
  flex-direction: column;
  min-width: 22rem;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0.3rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-md);
  box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.25);
  z-index: 100;
}

.slash-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  padding: 0.35rem 0.55rem;
  background: transparent;
  border: 0;
  border-radius: var(--p-border-radius-sm);
  font: inherit;
  color: var(--p-text-color);
  text-align: left;
  cursor: pointer;
}

.slash-item.is-selected,
.slash-item:hover {
  background: var(--p-content-hover-background);
}

.slash-item-name {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.85rem;
  color: var(--p-primary-500);
}

.slash-item-desc {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}
</style>
