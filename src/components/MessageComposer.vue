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
import Popover from "primevue/popover";
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
import { $getRoot, $getSelection, $isElementNode, $isRangeSelection, $createParagraphNode, $createTextNode, type ElementNode } from "lexical";
import { markdownNodes } from "../lexical/nodes";
import { $createAttachmentNode } from "../lexical/AttachmentNode";
import { lexicalTheme } from "../lexical/theme";
import type { DefaultSendMode } from "../stores/sessionsStore";
import type { SendMessageAttachment } from "../ipc/types";
import { useToastStore } from "../stores/toastStore";
import { runLocalSlashCommand } from "../lib/sessionCommands";
import SlashCommandPlugin from "./SlashCommandPlugin.vue";
import MentionPlugin from "./MentionPlugin.vue";
import FilePicker from "./FilePicker.vue";
import ModeButtonGroup from "./ModeButtonGroup.vue";
import TerminalPanel from "./TerminalPanel.vue";
import { useTerminalStore } from "../stores/terminalStore";
import { useSessionsStore } from "../stores/sessionsStore";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    placeholder?: string;
    enableMarkdownShortcuts?: boolean;
    /// Per-session default for the primary send button + Ctrl+Enter.
    /// Defaults to "steer".
    defaultMode?: DefaultSendMode;
    /// When provided, mounts the slash-command typeahead bound to
    /// this session. Omit on synthetic / playground composers that
    /// shouldn't fire real session commands.
    sessionId?: string;
  }>(),
  {
    disabled: false,
    placeholder: "Ask anything — use @ to attach files, / for commands.",
    enableMarkdownShortcuts: true,
    defaultMode: "steer",
    sessionId: undefined,
  },
);

const isDev = import.meta.env.DEV;
const diagEnabled =
  isDev &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("diag");

/// Pending attachments are now stored INLINE in the editor itself —
/// each chip is an `AttachmentNode` (a token-mode TextNode subclass)
/// inserted at the cursor. We extract them in document order at submit
/// time via `collectAttachments(editor)`. This keeps "pill position in
/// text" === "attachment index in array" naturally without a parallel
/// ref array drifting from the editor state.
const toasts = useToastStore();
const terminalStore = useTerminalStore();
const sessionsStore = useSessionsStore();
const shellMode = ref(false);
const shellTerminalId = ref<string | null>(null);
const shellCommandDraft = ref("");
const shellCommandRunning = ref(false);

function addAttachment(a: SendMessageAttachment): void {
  const editor = editorRef.value as LexicalEditor | null;
  if (!editor) return;
  editor.update(
    () => {
      const node = $createAttachmentNode(a);
      const space = $createTextNode(" ");
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        sel.insertNodes([node, space]);
      } else {
        // No active selection (drag-drop before the editor has focus).
        // Ensure there's a paragraph to append to, then append both nodes.
        const root = $getRoot();
        let last = root.getLastChild();
        if (!$isElementNode(last)) {
          last = $createParagraphNode();
          root.append(last);
        }
        (last as ElementNode).append(node);
        (last as ElementNode).append(space);
      }
      // Place caret AFTER the trailing space so the next keystroke
      // continues plain typing.
      space.selectEnd();
    },
    {
      // Focus AFTER the reconcile so the contenteditable DOM exists
      // and the caret-from-space-selectEnd is mounted. Plain
      // `editor.focus()` outside the update can race with reconcile
      // (especially on drag-drop where the drag source had focus and
      // we need to claim it back).
      onUpdate: () => {
        editor.focus(undefined, { defaultSelection: "rootEnd" });
      },
    },
  );
}

const MAX_BLOB_BYTES = 8 * 1024 * 1024; // 8 MiB safety cap

/// Read a File/Blob into a base64 SDK blob attachment. Wraps the
/// FileReader API in a promise so drag-drop / paste handlers stay
/// flat.
async function blobFromFile(file: File): Promise<SendMessageAttachment | null> {
  if (file.size > MAX_BLOB_BYTES) {
    toasts.warn(
      "File too large",
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MiB. Max is 8 MiB.`,
    );
    return null;
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunk to avoid stack overflows on String.fromCharCode(...big-array).
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const data = btoa(bin);
  return {
    type: "blob",
    data,
    mimeType: file.type || "application/octet-stream",
    displayName: file.name,
  };
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  for (const f of Array.from(files)) {
    const a = await blobFromFile(f);
    if (a) addAttachment(a);
  }
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const f = item.getAsFile();
    if (!f) continue;
    event.preventDefault();
    const a = await blobFromFile(f);
    if (a) addAttachment(a);
  }
}

/// Emits a discriminated submit payload identifying which send mode
/// the user invoked. The parent (`ChatWindow`) maps it to the
/// session-store action.
const emit = defineEmits<{
  (e: "submit", payload: ComposerSubmitPayload & { attachments?: SendMessageAttachment[] }): void;
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

/// Toggle the file picker popover anchored on the paperclip button.
/// The popover hosts the same FilePicker the @-trigger uses, with
/// its own search input (since the editor isn't the source of the
/// query here) and the native Browse… escape hatch.
const filePickerPopover = ref<InstanceType<typeof Popover> | null>(null);

function openFilePicker(event: Event): void {
  filePickerPopover.value?.toggle(event);
}

function onPickerSelect(att: SendMessageAttachment): void {
  addAttachment(att);
  filePickerPopover.value?.hide();
}

function insertMarkdown(before: string, after = "", placeholder = "text"): void {
  const editor = editorRef.value as LexicalEditor | null;
  if (!editor || props.disabled) return;
  editor.update(() => {
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      const text = sel.getTextContent();
      sel.insertText(`${before}${text || placeholder}${after}`);
      return;
    }
    const root = $getRoot();
    let last = root.getLastChild();
    if (!$isElementNode(last)) {
      last = $createParagraphNode();
      root.append(last);
    }
    (last as ElementNode).append($createTextNode(`${before}${placeholder}${after}`));
  });
  setTimeout(() => editor.focus(), 0);
}

const markdownActions = [
  { label: "Bold", icon: "pi pi-bold", title: "Bold", before: "**", after: "**" },
  { label: "Italic", icon: "pi pi-italic", title: "Italic", before: "*", after: "*" },
  { label: "Code", icon: "pi pi-code", title: "Inline code", before: "`", after: "`" },
  { label: "Quote", icon: "pi pi-align-left", title: "Quote", before: "> ", after: "" },
  { label: "List", icon: "pi pi-list", title: "Bullet list", before: "- ", after: "" },
] as const;

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

async function onSubmit(payload: ComposerSubmitPayload) {
  if (payload.text.trim() === "!" && props.sessionId) {
    await toggleShellMode();
    return;
  }
  if (props.sessionId && await runLocalSlashCommand(props.sessionId, payload.text)) {
    return;
  }
  emit("submit", payload);
}

async function toggleShellMode(): Promise<void> {
  if (!props.sessionId) return;
  if (shellMode.value) {
    shellMode.value = false;
    return;
  }
  try {
    const summary = await terminalStore.getOrCreateSessionTerminal(props.sessionId);
    shellTerminalId.value = summary.id;
    shellMode.value = true;
  } catch (err) {
    toasts.error("Failed to open shell", err instanceof Error ? err.message : String(err));
  }
}

async function runShellCommand(): Promise<void> {
  if (!props.sessionId || !shellCommandDraft.value.trim() || shellCommandRunning.value) {
    return;
  }
  const command = shellCommandDraft.value.trim();
  shellCommandRunning.value = true;
  try {
    const { output } = await terminalStore.runCapturedCommand(props.sessionId, command);
    const record = sessionsStore.sessions.find((s) => s.id === props.sessionId);
    if (record) {
      sessionsStore.appendEvent(record, {
        sessionId: props.sessionId,
        eventType: "system.notification",
        data: {
          content: `Shell command completed:\n\n$ ${command}\n\n${output.trim()}`,
        },
      });
    }
    shellCommandDraft.value = "";
  } catch (err) {
    toasts.warn(
      "Command still running",
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    shellCommandRunning.value = false;
  }
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
  const result = consumeComposerText(editor);
  if (result === null) return;
  emit("submit", {
    text: result.text,
    mode,
    ...(result.attachments.length > 0
      ? { attachments: result.attachments }
      : {}),
  });
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

const primaryLabel = computed(() => "");
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
      const result = consumeComposerText(editor);
      if (result !== null) {
        const payload: ComposerSubmitPayload = {
          text: result.text,
          mode: "default",
          ...(result.attachments.length > 0
            ? { attachments: result.attachments }
            : {}),
        };
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
        size: "small",
        class: "lex-submit-button",
        onClick: fire,
        // Keep focus in the editor after primary-button click so the
        // next keystroke after a send still routes to it.
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      });
  },
});
</script>

<template>
  <div class="lex-composer" @dragover.prevent @drop="onDrop">
    <div class="lex-composer-frame">
      <LexicalComposer :initial-config="initialConfig">
        <EditableSync :editable="editable" />
        <SubmitOnEnter @submit="onSubmit" />
        <TypingDiagnostic v-if="diagEnabled" />
        <SlashCommandPlugin
          v-if="props.sessionId"
          :session-id="props.sessionId"
        />
        <MentionPlugin
          v-if="props.sessionId"
          :session-id="props.sessionId"
        />
          <div v-if="shellMode && shellTerminalId" class="lex-shell-mode">
            <div class="lex-shell-toolbar">
              <span>Session shell</span>
              <form class="lex-shell-command-form" @submit.prevent="runShellCommand">
                <input
                  v-model="shellCommandDraft"
                  class="lex-shell-command"
                  placeholder="Run command and capture result..."
                  :disabled="shellCommandRunning"
                />
                <button
                  type="submit"
                  :disabled="shellCommandRunning || !shellCommandDraft.trim()"
                >
                  Run
                </button>
              </form>
              <button type="button" class="lex-shell-close" @click="toggleShellMode">
                Back to message
              </button>
            </div>
            <TerminalPanel :params="{ terminalId: shellTerminalId, compact: true }" />
          </div>
          <div v-else class="lex-composer-shell" @paste="onPaste">
          <div class="lex-composer-editor">
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
          <div class="lex-composer-send">
            <SubmitButton
              :disabled="props.disabled"
              :label="primaryLabel"
              :icon="primaryIcon"
              :tooltip="primaryTooltip"
              :model="defaultModeItems"
              @submit="onSubmit"
            />
          </div>
        </div>
        <footer class="lex-composer-toolbar">
          <button
            type="button"
            class="lex-toolbar-btn"
            title="Attach files or folders"
            aria-label="Attach files or folders"
            :disabled="props.disabled"
            @click="openFilePicker"
          >
            <i class="pi pi-paperclip" aria-hidden="true" />
          </button>
          <Popover ref="filePickerPopover" class="lex-attach-popover" :pt="{ content: { style: 'padding: 0' } }">
            <FilePicker
              v-if="props.sessionId"
              :session-id="props.sessionId"
              :show-search-input="true"
              initial-focus="input"
              @select="onPickerSelect"
              @dismiss="filePickerPopover?.hide()"
            />
          </Popover>
          <button
            v-if="props.sessionId"
            type="button"
            class="lex-toolbar-btn"
            :class="{ 'is-active': shellMode }"
            title="Toggle session shell"
            aria-label="Toggle session shell"
            :disabled="props.disabled"
            @click="toggleShellMode"
          >
            <i class="pi pi-terminal" aria-hidden="true" />
          </button>
          <ModeButtonGroup
            v-if="props.sessionId"
            :session-id="props.sessionId"
          />
          <div class="lex-markdown-tools" aria-label="Markdown shortcuts">
            <button
              v-for="action in markdownActions"
              :key="action.label"
              type="button"
              class="lex-toolbar-btn"
              :title="action.title"
              :aria-label="action.title"
              :disabled="props.disabled"
              @click="insertMarkdown(action.before, action.after)"
            >
              <i class="pi" :class="action.icon" aria-hidden="true" />
            </button>
          </div>
          <!-- Slot for per-session controls (model picker, reasoning
               effort, options gear). This flexes across remaining
               width so the workspace chip anchors left while model /
               settings stay right. -->
          <slot name="session-controls" />
        </footer>
        <EditorRefCapture />
      </LexicalComposer>
    </div>
  </div>
</template>


<style scoped>
.lex-composer-frame {
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--accent, var(--p-content-border-color)) 50%, var(--p-content-border-color));
  border-radius: var(--p-border-radius-md, 8px);
  background: var(--p-content-background);
  overflow: hidden;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
  margin: 0.5rem;
}

.lex-composer-frame:focus-within {
  border-color: var(--accent, var(--p-primary-color));
  box-shadow: 0 0 0 1px var(--accent, var(--p-primary-color));
}

.lex-shell-mode {
  height: min(14rem, calc(var(--tile-height, 500px) * 0.38));
  min-height: 9rem;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #111827;
}

.lex-shell-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.25rem 0.45rem;
  color: #d1d5db;
  font-size: 0.75rem;
  border-bottom: 1px solid color-mix(in srgb, white 12%, transparent);
}

.lex-shell-command-form {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1 1 auto;
  min-width: 0;
}

.lex-shell-command {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid color-mix(in srgb, white 16%, transparent);
  border-radius: var(--p-border-radius-sm);
  background: color-mix(in srgb, black 24%, transparent);
  color: #d1d5db;
  padding: 0.2rem 0.35rem;
  font: inherit;
}

.lex-shell-close {
  border: 0;
  background: transparent;
  color: var(--p-primary-color);
  cursor: pointer;
  font: inherit;
}

.lex-composer-toolbar {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.4rem;
  min-height: 2.3rem;
  border-top: 1px solid color-mix(in srgb, var(--p-content-border-color) 60%, transparent);
  background: color-mix(in srgb, var(--p-content-background) 95%, var(--p-text-color));
  /* SessionHeaderControls uses container queries to shrink its
   * children. Give it a container context here so it reacts to the
   * toolbar's width, not the page width. */
  container-type: inline-size;
  /* No wrap — keep everything on one row. Inner elements use overflow
   * + ellipsis on their own labels (model picker etc.) to absorb tight
   * widths instead of pushing controls onto a second line. */
  flex-wrap: nowrap;
  overflow: hidden;
}

.lex-toolbar-spacer {
  flex: 1 1 auto;
  min-width: 0.5rem;
}

.lex-markdown-tools {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  flex: 0 0 auto;
  padding: 0 0.2rem;
  border-left: 1px solid color-mix(in srgb, var(--p-content-border-color) 70%, transparent);
  border-right: 1px solid color-mix(in srgb, var(--p-content-border-color) 70%, transparent);
}

.lex-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--p-border-radius-sm, 4px);
  border: 0;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
  flex: 0 0 auto;
  transition: background 0.12s ease, color 0.12s ease;
}

.lex-toolbar-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: var(--p-text-color);
}

.lex-toolbar-btn.is-active {
  background: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
  color: var(--p-primary-color);
}

.lex-toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.lex-toolbar-btn .pi {
  font-size: 0.95rem;
}

/* Send button inside the editor row: icon-only, taller + narrower
 * pill that vertically centers in the input shell. */
.lex-submit-button :deep(.p-button) {
  height: 2.4rem;
  min-height: 2.4rem;
  padding: 0 0.45rem;
  font-size: 0.85rem;
}

.lex-submit-button :deep(.p-button .pi) {
  font-size: 1rem;
}

.lex-submit-button :deep(.p-splitbutton-dropdown) {
  padding: 0 0.25rem;
  min-width: 1.4rem;
}

/* Flatten the SessionHeaderControls inside the composer footer — drop
 * the workspace chip + inline reasoning visibility (already lives in
 * the gear popover) and remove visible select borders so picker labels
 * read as chevron-text buttons à la Copilot's composer. */
.lex-composer-toolbar :deep(.session-header-controls) {
  gap: 0.2rem;
  padding: 0;
  height: 1.75rem;
  flex: 1 1 auto;
  min-width: 0;
}

.lex-composer-toolbar :deep(.session-header-controls .workspace-chip) {
  /* keep it, but tighten — composer toolbar is shorter than the old tab strip */
  height: 1.5rem;
  font-size: 0.72rem;
  padding: 0 0.45rem;
}

.lex-composer-toolbar :deep(.compact-select-reasoning) {
  display: none;
}

.lex-composer-toolbar :deep(.compact-select .p-select),
.lex-composer-toolbar :deep(.compact-select .p-treeselect) {
  height: 1.75rem;
  min-height: 1.75rem;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.lex-composer-toolbar :deep(.compact-select .p-select:hover),
.lex-composer-toolbar :deep(.compact-select .p-treeselect:hover) {
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
}

.lex-composer-toolbar :deep(.compact-select .p-select-label),
.lex-composer-toolbar :deep(.compact-select .p-treeselect-label) {
  padding: 0 0.45rem;
  font-size: 0.78rem;
  color: var(--p-text-color);
}

.lex-composer-toolbar :deep(.compact-select .p-select-dropdown),
.lex-composer-toolbar :deep(.compact-select .p-treeselect-dropdown) {
  width: 1.1rem;
  color: var(--p-text-muted-color);
}

@container (max-width: 42rem) {
  .lex-markdown-tools {
    display: none;
  }
}
</style>
