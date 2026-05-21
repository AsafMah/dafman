<script setup lang="ts">
/// Slash-command typeahead. Triggers on "/" in the composer, shows
/// the shared SESSION_COMMANDS list (also used by Ctrl+K), and on
/// select EXECUTES the command locally — no SDK round-trip, no "now
/// hit Enter to send" step. The typed `/foo` is removed from the
/// composer first so the user can keep drafting after a command
/// runs.
///
/// Unmatched slash text (anything not in SESSION_COMMANDS) falls
/// through: the user can still type `/agent` and the typeahead just
/// won't show — pressing Enter sends as a normal message, and the
/// SDK's built-in command resolver picks it up.

import { computed, onMounted, ref } from "vue";
import { TextNode, $isTextNode } from "lexical";
import {
  TypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "lexical-vue/LexicalTypeaheadMenuPlugin";
import { useLexicalComposer } from "lexical-vue/LexicalComposer";
import { SESSION_COMMANDS, type SessionCommand } from "../lib/sessionCommands";

class SlashOption extends MenuOption {
  cmd: SessionCommand;
  constructor(cmd: SessionCommand) {
    super(cmd.slash);
    this.cmd = cmd;
  }
}

const props = defineProps<{
  sessionId: string;
}>();

const editor = useLexicalComposer();
const query = ref("");

/// Force the typeahead anchor to mount inside <body> so it positions
/// page-absolute (not as a flex child of the composer row). Default
/// in lexical-vue is body, but we set it explicitly so future
/// composer layout changes can't accidentally re-parent it. Defer
/// to a ref so it's safe in SSR (body is undefined at module load).
const menuParent = ref<HTMLElement | null>(null);
onMounted(() => {
  if (typeof document !== "undefined") menuParent.value = document.body;
});

const allOptions = computed(() =>
  SESSION_COMMANDS.map((c) => new SlashOption(c)),
);

const filteredOptions = computed(() => {
  const lower = query.value.toLowerCase();
  if (lower.length === 0) return allOptions.value;
  return allOptions.value.filter(
    (o) =>
      o.cmd.slash.toLowerCase().includes(lower) ||
      o.cmd.label.toLowerCase().includes(lower) ||
      (o.cmd.keywords ?? []).some((k) => k.toLowerCase().includes(lower)),
  );
});

const triggerFn = useBasicTypeaheadTriggerMatch("/", {
  minLength: 0,
  allowWhitespace: false,
});

function onQueryChange(q: string | null) {
  query.value = q ?? "";
}

async function onSelectOption(payload: {
  option: SlashOption;
  textNodeContainingQuery: TextNode | null;
  closeMenu: () => void;
}) {
  const { option, textNodeContainingQuery, closeMenu } = payload;
  editor.update(() => {
    if (textNodeContainingQuery && $isTextNode(textNodeContainingQuery)) {
      textNodeContainingQuery.remove();
    }
  });
  closeMenu();
  try {
    await option.cmd.run(props.sessionId);
  } catch {
    // Each command surfaces its own toast on failure via the store
    // actions it calls; swallow here so a transient error doesn't
    // crash the composer.
  }
}
</script>

<template>
  <TypeaheadMenuPlugin
    v-if="menuParent"
    :options="filteredOptions"
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
          class="slash-menu"
          role="listbox"
        >
          <button
            v-for="(opt, i) in (itemProps.options as SlashOption[])"
            :key="opt.cmd.slash"
            type="button"
            class="slash-item"
            :class="{ 'is-selected': i === itemProps.selectedIndex }"
            role="option"
            :aria-selected="i === itemProps.selectedIndex"
            @mousedown.prevent
            @click="itemProps.selectOptionAndCleanUp(opt)"
            @mouseenter="itemProps.setHighlightedIndex(i)"
          >
            <i
              v-if="opt.cmd.icon"
              class="pi slash-item-icon"
              :class="opt.cmd.icon"
              aria-hidden="true"
            />
            <span class="slash-item-text">
              <span class="slash-item-name">{{ opt.cmd.slash }}</span>
              <span class="slash-item-desc">{{ opt.cmd.description }}</span>
            </span>
          </button>
        </div>
      </Teleport>
    </template>
  </TypeaheadMenuPlugin>
</template>

<style scoped>
/* CSS-only "pop above the caret" — the lexical-vue anchor positions
 * absolutely at the caret line; transform: translateY(-100%) lifts
 * the menu by its own height, then another line-height lifts it clear
 * of the typed trigger line. No
 * JS measurement, no race with first render. */
.slash-menu {
  display: flex;
  flex-direction: column;
  min-width: 22rem;
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

.slash-item {
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

.slash-item.is-selected,
.slash-item:hover {
  background: var(--p-content-hover-background);
}

.slash-item-icon {
  font-size: 0.9rem;
  color: var(--p-text-muted-color);
  width: 1.2em;
  text-align: center;
}

.slash-item-text {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.slash-item-name {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.85rem;
  color: var(--p-primary-500);
  font-weight: 500;
}

.slash-item-desc {
  font-size: 0.74rem;
  color: var(--p-text-muted-color);
}
</style>
