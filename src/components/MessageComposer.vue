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
import type { SendMessageAttachment } from "../ipc/types";
import { invokeCommand } from "../ipc/invoke";
import { useToastStore } from "../stores/toastStore";
import { runLocalSlashCommand } from "../lib/sessionCommands";
import SlashCommandPlugin from "./SlashCommandPlugin.vue";
import MentionPlugin from "./MentionPlugin.vue";
import AttachmentStrip from "./AttachmentStrip.vue";
import ModeButtonGroup from "./ModeButtonGroup.vue";

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

/// Pending attachments queued by the @file typeahead, drag/drop, and
/// paste. Cleared on submit. Each entry is an SDK-shaped attachment
/// the parent will pass through `sendMessage`.
const attachments = ref<SendMessageAttachment[]>([]);
const toasts = useToastStore();

function addAttachment(a: SendMessageAttachment): void {
  // Dedup: file attachments by path, blobs/selections by displayName
  // (good enough — exact-duplicate detection isn't worth a hash).
  if (a.type === "file") {
    if (attachments.value.some((x) => x.type === "file" && x.path === a.path)) {
      return;
    }
  } else if (a.type === "blob") {
    if (
      attachments.value.some(
        (x) =>
          x.type === "blob" &&
          x.displayName === a.displayName &&
          x.data === a.data,
      )
    ) {
      return;
    }
  }
  attachments.value.push(a);
}

function removeAttachment(idx: number): void {
  attachments.value.splice(idx, 1);
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

/// Imperative file-picker trigger for the attach button. The hidden
/// `<input type="file" multiple>` is the standard cross-browser way
/// to open a native file chooser; we forward the chosen File objects
/// to the same `blobFromFile` path that drag-drop + paste use. For
/// `<input type="file">` (no path access in WebView2 / browsers) we
/// can only ship the file as a blob — the SDK's `file` attachment
/// kind needs an absolute filesystem path, which isn't exposed here.
const fileInput = ref<HTMLInputElement | null>(null);

function pickFiles() {
  fileInput.value?.click();
}

async function onPickedFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files) return;
  for (const f of Array.from(files)) {
    const a = await blobFromFile(f);
    if (a) addAttachment(a);
  }
  // Reset so the same file can be re-picked after removal.
  input.value = "";
}

/// Open an attachment for inspection. File attachments reveal in
/// the OS file explorer; blob attachments (pasted screenshots etc.)
/// pop a viewer window via an object URL.
function onOpenAttachment(idx: number): void {
  const a = attachments.value[idx];
  if (!a) return;
  if (a.type === "file" || a.type === "directory") {
    // Bun-side `revealPath` handles both files and directories.
    void invokeCommand("revealPath", { path: a.path }).catch(() => {
      toasts.warn("Couldn't open", a.path);
    });
  } else if (a.type === "blob") {
    try {
      const bin = atob(a.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: a.mimeType });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      // Revoke shortly so the popup has time to claim it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toasts.warn("Couldn't preview attachment");
    }
  }
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

async function onSubmit(payload: ComposerSubmitPayload) {
  if (props.sessionId && await runLocalSlashCommand(props.sessionId, payload.text)) {
    return;
  }
  const merged: ComposerSubmitPayload & {
    attachments?: SendMessageAttachment[];
  } = {
    ...payload,
    ...(attachments.value.length > 0
      ? { attachments: [...attachments.value] }
      : {}),
  };
  attachments.value = [];
  emit("submit", merged);
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
    <input
      ref="fileInput"
      type="file"
      class="lex-file-input"
      multiple
      @change="onPickedFiles"
    />
    <div class="lex-composer-frame">
      <AttachmentStrip
        v-if="attachments.length > 0"
        :attachments="attachments"
        @remove="removeAttachment"
        @open="onOpenAttachment"
      />
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
          @attach="addAttachment"
        />
        <div class="lex-composer-shell" @paste="onPaste">
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
            title="Attach files"
            aria-label="Attach files"
            :disabled="props.disabled"
            @click="pickFiles"
          >
            <i class="pi pi-paperclip" aria-hidden="true" />
          </button>
          <ModeButtonGroup
            v-if="props.sessionId"
            :session-id="props.sessionId"
          />
          <!-- Slot for per-session controls (model picker, reasoning
               effort, options gear). ChatWindow plugs SessionHeaderControls
               here so the chat tile no longer needs its own header strip. -->
          <slot name="session-controls" />
          <div class="lex-toolbar-spacer" />
        </footer>
        <EditorRefCapture />
      </LexicalComposer>
    </div>
  </div>
</template>


<style scoped>
.lex-file-input {
  display: none;
}

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

.lex-toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.lex-toolbar-btn .pi {
  font-size: 0.95rem;
}

/* SplitButton sizing override — the default PrimeVue "small" preset is
 * still taller than our 1.75rem toolbar row. Force the inner Buttons
 * to match. */
.lex-submit-button :deep(.p-button) {
  height: 1.75rem;
  min-height: 1.75rem;
  padding: 0 0.55rem;
  font-size: 0.8rem;
}

.lex-submit-button :deep(.p-button .pi) {
  font-size: 0.85rem;
}

.lex-submit-button :deep(.p-splitbutton-dropdown) {
  padding: 0 0.3rem;
}

/* Flatten the SessionHeaderControls inside the composer footer — drop
 * the workspace chip + inline reasoning visibility (already lives in
 * the gear popover) and remove visible select borders so picker labels
 * read as chevron-text buttons à la Copilot's composer. */
.lex-composer-toolbar :deep(.session-header-controls) {
  gap: 0.2rem;
  padding: 0;
  height: 1.75rem;
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
</style>
