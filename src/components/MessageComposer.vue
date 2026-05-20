<script setup lang="ts">
// Lexical-backed chat composer.
//
// Plain-text input today; the EditorState model leaves room for future
// custom nodes (slash commands, @mentions, #hashtags, inline images)
// without changing the parent contract. The display side (assistant /
// reasoning / user messages) renders full markdown via `MessageContent`.
//
// Wire contract: emits `submit` with the trimmed plain-text content
// when Enter is pressed or the send button is clicked. Shift+Enter
// inserts a newline. Disabled state flows through `EditableSync` since
// `lexical-vue`'s composer only reads `editable` once on mount.
//
// Markdown keystroke shortcuts (`# ` -> heading, `**bold**`, fenced
// code, etc. auto-formatting AS YOU TYPE) are gated behind
// `enableMarkdownShortcuts` so we can ship typing reliably even if a
// plugin combo destabilises input under WebView2. When the gate is on
// we mount `RichTextPlugin` + the markdown plugin stack and register
// shortcuts; when off we use plain text. Either way the same Enter +
// SubmitButton path applies.

import { computed, defineComponent, h, ref } from "vue";
import SplitButton from "primevue/splitbutton";
import type { MenuItem } from "primevue/menuitem";
import { LexicalComposer, useLexicalComposer } from "lexical-vue/LexicalComposer";
import { ContentEditable } from "lexical-vue/LexicalContentEditable";
import { PlainTextPlugin } from "lexical-vue/LexicalPlainTextPlugin";
import { RichTextPlugin } from "lexical-vue/LexicalRichTextPlugin";
import { HistoryPlugin } from "lexical-vue/LexicalHistoryPlugin";
import { AutoFocusPlugin } from "lexical-vue/LexicalAutoFocusPlugin";
import { ListPlugin } from "lexical-vue/LexicalListPlugin";
import { LinkPlugin } from "lexical-vue/LexicalLinkPlugin";
import type { LexicalEditor } from "lexical";
import {
  EditableSync,
  RegisterMarkdownShortcuts,
  SubmitOnEnter,
  TypingDiagnostic,
  consumeComposerText,
  type ComposerSubmitMode,
  type ComposerSubmitPayload,
} from "../lexical/plugins";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { markdownNodes } from "../lexical/nodes";
import { lexicalTheme } from "../lexical/theme";
import type { DefaultSendMode } from "../stores/sessionsStore";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    placeholder?: string;
    enableMarkdownShortcuts?: boolean;
    /// Per-session default for the primary send button + Ctrl+Enter.
    /// Defaults to "steer".
    defaultMode?: DefaultSendMode;
  }>(),
  {
    disabled: false,
    placeholder: "Ask anything. Ctrl+Enter to send.",
    enableMarkdownShortcuts: true,
    defaultMode: "steer",
  },
);

const isDev = import.meta.env.DEV;
const diagEnabled =
  isDev &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("diag");

/// Emits a discriminated submit payload identifying which send mode
/// the user invoked. The parent (`ChatWindow`) maps it to the
/// session-store action.
const emit = defineEmits<{
  (e: "submit", payload: ComposerSubmitPayload): void;
  (e: "update:defaultMode", mode: DefaultSendMode): void;
}>();

/// Imperatively focus the editor. Used by ChatWindow when an external
/// surface (e.g. the Sessions sidebar) asks to bring the composer
/// into focus without going through normal click-to-focus.
function focusComposer(): void {
  const editor = editorRef.value as LexicalEditor | null;
  if (!editor) return;
  editor.focus();
}

/// Replace the composer's current text with `value`. Used by the
/// message action bar's Edit action (load message text into the
/// composer for amendment). Plain-text only — markdown features
/// (mentions, code fences) round-trip via SubmitOnEnter's
/// consumeComposerText pass that we don't shortcut here.
function setText(value: string): void {
  const editor = editorRef.value as LexicalEditor | null;
  if (!editor) return;
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const para = $createParagraphNode();
    if (value.length > 0) para.append($createTextNode(value));
    root.append(para);
  });
  // Move caret to the end so the user can keep typing.
  setTimeout(() => editor.focus(), 0);
}

/// Append text to the current composer contents on a new line.
/// Used by Quote (insert message text as a blockquote) and Retry-
/// style flows that build up multi-line prompts.
function appendText(value: string): void {
  const editor = editorRef.value as LexicalEditor | null;
  if (!editor) return;
  editor.update(() => {
    const root = $getRoot();
    const lines = value.split("\n");
    for (const line of lines) {
      const para = $createParagraphNode();
      if (line.length > 0) para.append($createTextNode(line));
      root.append(para);
    }
  });
  setTimeout(() => editor.focus(), 0);
}

defineExpose({ focus: focusComposer, setText, appendText });

const editable = computed(() => !props.disabled);
const richText = computed(() => props.enableMarkdownShortcuts);

const initialConfig = computed(() => ({
  namespace: "DafmanComposer",
  editable: true,
  nodes: markdownNodes,
  theme: lexicalTheme,
  onError(error: Error) {
    // `installRendererLogBridge` (`src/ipc/rendererLog.ts`) already
    // intercepts `console.error` and mirrors it to the bun JSON log,
    // so a single `console.error` reaches both surfaces. Don't also
    // call `rendererLog` here — that would double-log.
    console.error("[lexical composer]", error);
  },
}));

function onSubmit(payload: ComposerSubmitPayload) {
  emit("submit", payload);
}

/// Dropdown items for the SplitButton — let the user change the
/// session's default send mode (the action attached to the primary
/// button + plain Ctrl+Enter). Interrupt is intentionally NOT eligible
/// as a default — it always aborts the current turn, which is a
/// destructive choice that should require an explicit modifier.
const defaultModeItems = computed<MenuItem[]>(() => [
  {
    label: "Steer (immediate)",
    icon: props.defaultMode === "steer" ? "pi pi-check" : "pi pi-bolt",
    command: () => emit("update:defaultMode", "steer"),
  },
  {
    label: "Queue (wait for current turn)",
    icon: props.defaultMode === "queue" ? "pi pi-check" : "pi pi-clock",
    command: () => emit("update:defaultMode", "queue"),
  },
  { separator: true },
  {
    label: "Send & interrupt current turn",
    icon: "pi pi-stop-circle",
    command: () => triggerSubmit("interrupt"),
  },
]);

/// Imperative send trigger used by the SplitButton's "interrupt" menu
/// entry. Reaches into the editor via the editor-ref established by
/// `EditorRefCapture` below.
const editorRef = ref<unknown>(null);
function triggerSubmit(mode: ComposerSubmitMode) {
  const editor = editorRef.value as LexicalEditor | null;
  if (!editor || props.disabled) return;
  const text = consumeComposerText(editor);
  if (text === null) return;
  emit("submit", { text, mode });
}

/// Captures the active editor instance so external menu items
/// (e.g. the SplitButton's interrupt entry) can submit through the
/// same code path as the in-editor button. Stored as `unknown` because
/// `lexical-vue`'s `useLexicalComposer()` is typed against a slightly
/// older `LexicalEditor` shape than the one exported by `lexical`;
/// we cast at the call site where we actually use it.
const EditorRefCapture = defineComponent({
  name: "EditorRefCapture",
  setup() {
    editorRef.value = useLexicalComposer();
    return () => null;
  },
});

const primaryLabel = computed(() =>
  props.defaultMode === "queue" ? "Queue" : "Send",
);
const primaryIcon = computed(() =>
  props.defaultMode === "queue" ? "pi pi-clock" : "pi pi-send",
);
const primaryTooltip = computed(() =>
  props.defaultMode === "queue"
    ? "Queue (Ctrl+Enter) — wait behind current turn. Alt+Enter forces queue; Ctrl+Shift+Enter interrupts."
    : "Steer (Ctrl+Enter) — send immediately into current turn. Alt+Enter queues; Ctrl+Shift+Enter interrupts.",
);

/// SplitButton-style submit. Primary action runs the session's
/// `defaultSendMode` (Steer by default). The dropdown lets the user
/// pick a different default or trigger an explicit interrupt. The
/// shortcut hints in the dropdown labels match the bindings registered
/// by `SubmitOnEnter`.
const SubmitButton = defineComponent({
  name: "SubmitButton",
  props: {
    disabled: { type: Boolean, default: false },
    label: { type: String, required: true },
    icon: { type: String, required: true },
    tooltip: { type: String, required: true },
    model: { type: Array as () => MenuItem[], required: true },
  },
  emits: ["submit"],
  setup(p, { emit: emitInner }) {
    const editor = useLexicalComposer();
    function fire() {
      if (p.disabled) return;
      const text = consumeComposerText(editor);
      if (text !== null) {
        const payload: ComposerSubmitPayload = { text, mode: "default" };
        emitInner("submit", payload);
      }
    }
    return () =>
      h(SplitButton, {
        label: p.label,
        icon: p.icon,
        title: p.tooltip,
        "aria-label": p.tooltip,
        disabled: p.disabled,
        model: p.model,
        onClick: fire,
        // Keep focus in the editor after primary-button click so the
        // next keystroke after a send still routes to it.
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      });
  },
});
</script>

<template>
  <div class="lex-composer">
    <LexicalComposer :initial-config="initialConfig">
      <EditableSync :editable="editable" />
      <SubmitOnEnter @submit="onSubmit" />
      <TypingDiagnostic v-if="diagEnabled" />
      <!-- Optional leading content rendered inside the composer's flex
           row, before the input shell. Chat surfaces use this to host
           the run-mode segmented control so it shares the composer's
           border-top, padding, and height alignment. -->
      <slot name="leading" />
      <div class="lex-composer-shell">
        <template v-if="richText">
          <RichTextPlugin>
            <template #contentEditable>
              <ContentEditable
                class="lex-content lex-composer-input"
                role="textbox"
                :aria-multiline="true"
                :aria-disabled="props.disabled"
                :aria-label="placeholder"
              />
            </template>
            <template #placeholder>
              <div class="lex-composer-placeholder">{{ placeholder }}</div>
            </template>
          </RichTextPlugin>
          <ListPlugin />
          <LinkPlugin />
          <RegisterMarkdownShortcuts />
        </template>
        <template v-else>
          <PlainTextPlugin>
            <template #contentEditable>
              <ContentEditable
                class="lex-content lex-composer-input"
                role="textbox"
                :aria-multiline="true"
                :aria-disabled="props.disabled"
                :aria-label="placeholder"
              />
            </template>
            <template #placeholder>
              <div class="lex-composer-placeholder">{{ placeholder }}</div>
            </template>
          </PlainTextPlugin>
        </template>
        <HistoryPlugin />
        <AutoFocusPlugin />
      </div>
      <SubmitButton
        :disabled="props.disabled"
        :label="primaryLabel"
        :icon="primaryIcon"
        :tooltip="primaryTooltip"
        :model="defaultModeItems"
        @submit="onSubmit"
      />
      <EditorRefCapture />
    </LexicalComposer>
  </div>
</template>

