<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { ProgressAddon, type IProgressState } from "@xterm/addon-progress";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ImageAddon } from "@xterm/addon-image";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebglAddon } from "@xterm/addon-webgl";
import { SerializeAddon } from "@xterm/addon-serialize";
import "@xterm/xterm/css/xterm.css";
import Button from "primevue/button";
import { useTerminalStore } from "../stores/terminalStore";
import { useSettingsStore } from "../stores/settingsStore";
import { invokeCommand } from "../ipc/invoke";

type UserParams = { terminalId?: string; compact?: boolean };
type WrappedParams = { params?: UserParams };
const props = defineProps<{ params: UserParams & WrappedParams }>();
const compact = computed(() => props.params?.params?.compact === true || (props.params as { compact?: boolean })?.compact === true);

const terminalStore = useTerminalStore();
const settingsStore = useSettingsStore();
const host = ref<HTMLElement | null>(null);
const searchOpen = ref(false);
const searchQuery = ref("");
const progress = ref<IProgressState>({ state: 0, value: 0 });
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let search: SearchAddon | null = null;
let serialize: SerializeAddon | null = null;
let webFonts: WebFontsAddon | null = null;
let webgl: WebglAddon | null = null;
const addonDisposables: Array<{ dispose(): void }> = [];
let resizeObserver: ResizeObserver | null = null;

const terminalId = computed(() => props.params?.params?.terminalId ?? props.params?.terminalId ?? "");
const summary = computed(() =>
  terminalStore.terminals.find((t) => t.id === terminalId.value),
);
const buffer = computed(() => terminalStore.buffers[terminalId.value] ?? "");
const terminalPrefs = computed(() => settingsStore.settings.terminal);
const integrationNonce = computed(() => summary.value?.integrationNonce ?? "");

function fitAndNotify(): void {
  if (!fit || !term || !terminalId.value) return;
  try {
    fit.fit();
    void terminalStore.resizeTerminal(terminalId.value, term.cols, term.rows);
  } catch {
    /* xterm can throw before first layout; next resize will recover */
  }
}

function loadAddon(addon: { dispose(): void }, activate: () => void): void {
  try {
    activate();
    addonDisposables.push(addon);
  } catch (err) {
    console.warn("[terminal addon] failed to load", err);
    try {
      addon.dispose();
    } catch {
      /* ignore dispose failures from partially activated addons */
    }
  }
}

function tryDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseExitCode(value: string): number | undefined {
  const match = value.match(/(?:^|;)(-?\d+)(?:;|$)/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOsc633(command: string): void {
  if (!terminalId.value) return;
  const [kind = "", ...parts] = command.split(";");
  if (kind === "C") {
    if (!terminalStore.activeCommands[terminalId.value]) {
      terminalStore.startCommand(terminalId.value, {
        cwd: terminalStore.currentCwd[terminalId.value] ?? summary.value?.cwd,
        protocol: "osc633",
        trusted: false,
      });
    }
    return;
  }
  if (kind === "D") {
    terminalStore.finishCommand(terminalId.value, parseExitCode(parts.join(";")));
    return;
  }
  if (kind === "E") {
    const nonce = parts[parts.length - 1];
    const trusted = Boolean(integrationNonce.value && nonce === integrationNonce.value);
    const commandLine = tryDecodeUriComponent(parts.slice(0, -1).join(";"));
    const patch = {
      command: commandLine,
      cwd: terminalStore.currentCwd[terminalId.value] ?? summary.value?.cwd,
      protocol: "osc633" as const,
      trusted,
    };
    if (terminalStore.activeCommands[terminalId.value]) terminalStore.updateActiveCommand(terminalId.value, patch);
    else terminalStore.startCommand(terminalId.value, patch);
    return;
  }
  if (kind === "P") {
    const cwdPart = parts.find((part) => part.startsWith("Cwd="));
    if (cwdPart) terminalStore.updateTerminalCwd(terminalId.value, tryDecodeUriComponent(cwdPart.slice(4)));
  }
}

function parseOsc133(command: string): void {
  if (!terminalId.value) return;
  const [kind = "", ...parts] = command.split(";");
  if (kind === "C") {
    if (!terminalStore.activeCommands[terminalId.value]) {
      terminalStore.startCommand(terminalId.value, {
        cwd: terminalStore.currentCwd[terminalId.value] ?? summary.value?.cwd,
        protocol: "osc133",
        trusted: false,
      });
    }
  } else if (kind === "D") {
    terminalStore.finishCommand(terminalId.value, parseExitCode(parts.join(";")));
  }
}

function parseOsc7(uri: string): void {
  if (!terminalId.value || !uri.startsWith("file://")) return;
  const pathname = uri
    .slice("file://".length)
    .replace(/^[^/]*(\/.*)$/, "$1")
    .replace(/^\/([A-Za-z]:\/)/, "$1");
  terminalStore.updateTerminalCwd(terminalId.value, tryDecodeUriComponent(pathname));
}

function registerShellIntegrationHandlers(): void {
  if (!term) return;
  addonDisposables.push(
    term.parser.registerOscHandler(633, (data) => {
      parseOsc633(data);
      return true;
    }),
    term.parser.registerOscHandler(133, (data) => {
      parseOsc133(data);
      return true;
    }),
    term.parser.registerOscHandler(7, (data) => {
      parseOsc7(data);
      return true;
    }),
    term.parser.registerOscHandler(9, (data) => {
      if (terminalId.value && data.startsWith("9;")) {
        terminalStore.updateTerminalCwd(terminalId.value, data.slice(2));
        return true;
      }
      return false;
    }),
    term.parser.registerOscHandler(1337, (data) => {
      if (terminalId.value && data.startsWith("CurrentDir=")) {
        terminalStore.updateTerminalCwd(terminalId.value, tryDecodeUriComponent(data.slice("CurrentDir=".length)));
        return true;
      }
      return false;
    }),
  );
}

function findNext(): void {
  if (!searchQuery.value.trim()) return;
  search?.findNext(searchQuery.value, {
    decorations: {
      matchOverviewRuler: "#64748b",
      activeMatchColorOverviewRuler: "#38bdf8",
    },
  });
}

function findPrevious(): void {
  if (!searchQuery.value.trim()) return;
  search?.findPrevious(searchQuery.value, {
    decorations: {
      matchOverviewRuler: "#64748b",
      activeMatchColorOverviewRuler: "#38bdf8",
    },
  });
}

async function copySelection(): Promise<void> {
  const selected = term?.getSelection();
  if (selected) await navigator.clipboard.writeText(selected);
}

async function pasteClipboard(): Promise<void> {
  if (!terminalId.value) return;
  const text = await navigator.clipboard.readText();
  if (text) void terminalStore.writeTerminal(terminalId.value, text);
}

async function copyBuffer(): Promise<void> {
  const text = serialize?.serialize({ scrollback: 10_000 });
  if (text) await navigator.clipboard.writeText(text);
}

onMounted(async () => {
  await nextTick();
  if (!host.value) return;
  term = new Terminal({
    convertEol: true,
    cursorBlink: true,
    scrollback: terminalPrefs.value.scrollback,
    fontFamily: terminalPrefs.value.fontFamily,
    fontSize: terminalPrefs.value.fontSize,
    theme: terminalPrefs.value.theme,
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  addonDisposables.push(fit);
  const addons = terminalPrefs.value.addons;
  if (addons.search) {
    search = new SearchAddon();
    loadAddon(search, () => term?.loadAddon(search!));
  }
  if (addons.serialize) {
    serialize = new SerializeAddon();
    loadAddon(serialize, () => term?.loadAddon(serialize!));
  }
  if (addons.unicode11) {
    const unicode11 = new Unicode11Addon();
    loadAddon(unicode11, () => {
      term?.loadAddon(unicode11);
      if (term) term.unicode.activeVersion = "11";
    });
  }
  if (addons.unicodeGraphemes) {
    const unicodeGraphemes = new UnicodeGraphemesAddon();
    loadAddon(unicodeGraphemes, () => term?.loadAddon(unicodeGraphemes));
  }
  if (addons.webLinks) {
    const links = new WebLinksAddon((_event, uri) => {
      void invokeCommand("openUrl", { url: uri });
    });
    loadAddon(links, () => term?.loadAddon(links));
  }
  if (addons.clipboard) {
    const clipboard = new ClipboardAddon();
    loadAddon(clipboard, () => term?.loadAddon(clipboard));
  }
  if (addons.webFonts) {
    webFonts = new WebFontsAddon(true);
    loadAddon(webFonts, () => {
      term?.loadAddon(webFonts!);
      void webFonts?.loadFonts().then(() => fitAndNotify()).catch(() => {});
    });
  }
  if (addons.progress) {
    const progressAddon = new ProgressAddon();
    loadAddon(progressAddon, () => {
      term?.loadAddon(progressAddon);
      addonDisposables.push(progressAddon.onChange((state) => {
        progress.value = state;
      }));
    });
  }
  if (addons.ligatures) {
    const ligatures = new LigaturesAddon();
    loadAddon(ligatures, () => term?.loadAddon(ligatures));
  }
  if (addons.image) {
    const image = new ImageAddon({ storageLimit: 64 });
    loadAddon(image, () => term?.loadAddon(image));
  }
  if (addons.webgl) {
    webgl = new WebglAddon();
    loadAddon(webgl, () => {
      term?.loadAddon(webgl!);
      addonDisposables.push(webgl!.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
      }));
    });
  }
  term.open(host.value);
  if (buffer.value) term.write(buffer.value);
  registerShellIntegrationHandlers();
  term.onData((data) => {
    if (terminalId.value) void terminalStore.writeTerminal(terminalId.value, data);
  });
  resizeObserver = new ResizeObserver(() => fitAndNotify());
  resizeObserver.observe(host.value);
  setTimeout(fitAndNotify, 0);
});

watch(buffer, (next, prev) => {
  if (!term) return;
  if (next.length < prev.length) {
    term.reset();
    term.write(next);
  } else if (next.length > prev.length) {
    term.write(next.slice(prev.length));
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  while (addonDisposables.length) {
    try {
      addonDisposables.pop()?.dispose();
    } catch {
      /* ignore addon dispose failures */
    }
  }
  term?.dispose();
  term = null;
  fit = null;
});
</script>

<template>
  <section class="terminal-panel" :class="{ compact }">
    <header v-if="!compact" class="terminal-header">
      <div class="terminal-title">
        <strong>{{ summary?.title ?? "Terminal" }}</strong>
        <small>{{ summary?.cwd }}</small>
      </div>
      <div
        v-if="progress.state !== 0"
        class="terminal-progress"
        :class="`state-${progress.state}`"
        :title="`Progress ${progress.value}%`"
      >
        <span class="terminal-progress-bar" :style="{ width: `${progress.value}%` }" />
      </div>
      <div class="terminal-actions">
        <Button
          icon="pi pi-search"
          text
          rounded
          size="small"
          aria-label="Search terminal"
          :aria-pressed="searchOpen"
          @click="searchOpen = !searchOpen"
        />
        <Button
          icon="pi pi-copy"
          text
          rounded
          size="small"
          aria-label="Copy selected terminal text"
          @click="copySelection"
        />
        <Button
          icon="pi pi-clone"
          text
          rounded
          size="small"
          aria-label="Copy terminal buffer"
          @click="copyBuffer"
        />
        <Button
          icon="pi pi-clipboard"
          text
          rounded
          size="small"
          aria-label="Paste into terminal"
          @click="pasteClipboard"
        />
      </div>
      <Button
        v-if="summary?.status === 'running'"
        label="Kill"
        size="small"
        severity="secondary"
        @click="terminalStore.killTerminal(terminalId)"
      />
      <span v-else class="terminal-status">{{ summary?.status ?? "missing" }}</span>
    </header>
    <form
      v-if="!compact && searchOpen"
      class="terminal-search"
      @submit.prevent="findNext"
    >
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Search terminal"
        aria-label="Search terminal"
      />
      <Button icon="pi pi-arrow-up" text size="small" aria-label="Previous result" @click="findPrevious" />
      <Button icon="pi pi-arrow-down" text size="small" aria-label="Next result" type="submit" />
    </form>
    <div ref="host" class="terminal-host" />
  </section>
</template>

<style scoped>
.terminal-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #111827;
}

.terminal-panel.compact {
  border-radius: var(--p-border-radius-sm);
}

.terminal-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid color-mix(in srgb, white 12%, transparent);
  color: #d1d5db;
}

.terminal-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  flex: 0 0 auto;
}

.terminal-progress {
  position: relative;
  width: 4rem;
  height: 0.35rem;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, white 14%, transparent);
  flex: 0 0 auto;
}

.terminal-progress-bar {
  display: block;
  height: 100%;
  min-width: 0.2rem;
  background: var(--p-primary-color);
}

.terminal-progress.state-2 .terminal-progress-bar {
  background: var(--p-red-500);
}

.terminal-progress.state-4 .terminal-progress-bar {
  background: var(--p-yellow-500);
}

.terminal-search {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.55rem;
  border-bottom: 1px solid color-mix(in srgb, white 12%, transparent);
  background: color-mix(in srgb, black 18%, transparent);
}

.terminal-search input {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid color-mix(in srgb, white 16%, transparent);
  border-radius: var(--p-border-radius-sm);
  background: color-mix(in srgb, black 20%, transparent);
  color: #d1d5db;
  padding: 0.25rem 0.4rem;
  font: inherit;
  font-size: 0.8rem;
}

.terminal-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.terminal-title strong,
.terminal-title small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-title small,
.terminal-status {
  color: #9ca3af;
  font-size: 0.72rem;
}

.terminal-host {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  padding: 0.35rem;
}

.terminal-host :deep(.xterm) {
  height: 100%;
}
</style>
