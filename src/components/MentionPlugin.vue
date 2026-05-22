<script setup lang="ts">
/// @-trigger file/dir picker for the composer.
///
/// Detects `@` in the editor via Lexical's `TypeaheadMenuPlugin`,
/// then mounts FilePicker as the menu UI. On select we replace the
/// typed `@query` TextNode with an AttachmentNode pill carrying
/// either `type: "file"` or `type: "directory"`.
///
/// Wire-up:
///   1. TypeaheadMenuPlugin watches the editor for `@`. When it
///      matches, it provides an anchorElement + a `selectOptionAndCleanUp`
///      callback that closes the menu and gives us the textNode
///      containing the query.
///   2. We render FilePicker into the anchor with `externalQuery`
///      driven by the plugin's query-change events.
///   3. ArrowUp/Down keystrokes from the editor are captured at the
///      window level (since editor keeps focus, not the picker) and
///      forwarded to FilePicker's imperative `moveHighlight`.
///   4. Enter from the editor fires the plugin's `select-option` —
///      we pick the picker's currently highlighted match.
///   5. Mouse-click on a picker item OR clicking "Browse…" routes
///      via `selectOptionAndCleanUp(sentinel)` so the plugin gives
///      us the textNode, then we insert the pill using the
///      attachment cached in `pendingAttachment`.

import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { TextNode, $createTextNode, $isTextNode } from "lexical";
import {
  TypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "lexical-vue/LexicalTypeaheadMenuPlugin";
import { useLexicalComposer } from "lexical-vue/LexicalComposer";
import { $createAttachmentNode } from "../lexical/AttachmentNode";
import type { SendMessageAttachment } from "../ipc/types";
import FilePicker from "./FilePicker.vue";

class SentinelOption extends MenuOption {
  constructor() {
    super("file-picker-sentinel");
  }
}

const props = defineProps<{
  sessionId: string;
}>();

const editor = useLexicalComposer();
const query = ref("");
const menuParent = ref<HTMLElement | null>(null);
const pickerRef = ref<InstanceType<typeof FilePicker> | null>(null);
/// Tunnel: set by click handlers, consumed by onSelectOption.
const pendingAttachment = ref<SendMessageAttachment | null>(null);

onMounted(() => {
  if (typeof document !== "undefined") menuParent.value = document.body;
});

const sentinelOptions = computed(() => [new SentinelOption()]);

const triggerFn = useBasicTypeaheadTriggerMatch("@", {
  minLength: 0,
  allowWhitespace: false,
});

function onQueryChange(q: string | null) {
  query.value = q ?? "";
}

function replaceTriggerWith(
  textNodeContainingQuery: TextNode | null,
  attachment: SendMessageAttachment,
): void {
  if (!textNodeContainingQuery) return;
  editor.update(() => {
    if ($isTextNode(textNodeContainingQuery)) {
      const pill = $createAttachmentNode(attachment);
      textNodeContainingQuery.replace(pill);
      const space = $createTextNode(" ");
      pill.insertAfter(space);
      space.selectEnd();
    }
  });
}

function onSelectOption(payload: {
  option: SentinelOption;
  textNodeContainingQuery: TextNode | null;
  closeMenu: () => void;
}) {
  const { textNodeContainingQuery, closeMenu } = payload;
  // Click path: pendingAttachment is set. Enter-from-editor path:
  // pendingAttachment is null, pull from the picker's highlight.
  const attachment =
    pendingAttachment.value ?? pickerRef.value?.pickCurrent?.() ?? null;
  pendingAttachment.value = null;
  if (attachment) {
    replaceTriggerWith(textNodeContainingQuery, attachment);
  }
  closeMenu();
}

function onWindowKey(e: KeyboardEvent): void {
  if (!pickerRef.value?.hasResults?.()) return;
  if (e.key === "ArrowDown") {
    pickerRef.value.moveHighlight(1);
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    pickerRef.value.moveHighlight(-1);
    e.preventDefault();
  }
}

onMounted(() => window.addEventListener("keydown", onWindowKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKey, true));
</script>

<template>
  <TypeaheadMenuPlugin
    v-if="menuParent"
    :options="sentinelOptions"
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
        <div class="mention-menu-anchor">
          <FilePicker
            ref="pickerRef"
            :session-id="props.sessionId"
            :external-query="query"
            :show-search-input="false"
            initial-focus="none"
            @select="(att: SendMessageAttachment) => {
              pendingAttachment = att;
              itemProps.selectOptionAndCleanUp(itemProps.options[0]);
            }"
            @dismiss="() => {}"
          />
        </div>
      </Teleport>
    </template>
  </TypeaheadMenuPlugin>
</template>

<style scoped>
.mention-menu-anchor {
  /* Lexical positions anchorElementRef at the caret's BOTTOM. To put
   * the menu above the caret line we translate up by its own height
   * plus a small gap. Matches the original MentionPlugin's idiom. */
  position: absolute;
  transform: translateY(calc(-100% - 2rem));
}
</style>
