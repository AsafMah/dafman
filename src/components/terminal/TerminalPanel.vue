<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebFontsAddon } from '@xterm/addon-web-fonts';
import { ProgressAddon, type IProgressState } from '@xterm/addon-progress';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { ImageAddon } from '@xterm/addon-image';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import Button from 'primevue/button';
import { useTerminalStore } from '@/stores/terminal/terminalStore';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { invokeCommand } from '@/ipc/invoke';
import { emit as busEmit, on as busOn } from '@/lib/bus';
import { parseTerminalOsc, type TerminalShellEvent } from '@/lib/terminalShellIntegration';

type UserParams = { terminalId?: string; compact?: boolean };
type WrappedParams = { params?: UserParams };
const props = defineProps<{ params: UserParams & WrappedParams }>();
const compact = computed(
  () =>
    props.params?.params?.compact === true ||
    (props.params as { compact?: boolean })?.compact === true,
);

const terminalStore = useTerminalStore();
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const host = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const searchOpen = ref(false);
const searchQuery = ref('');
const searchResultLabel = ref('');
const progress = ref<IProgressState>({ state: 0, value: 0 });
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let search: SearchAddon | null = null;
let webFonts: WebFontsAddon | null = null;
let webgl: WebglAddon | null = null;
const addonDisposables: Array<{ dispose(): void }> = [];
let resizeObserver: ResizeObserver | null = null;
let pendingSearchFrame: number | null = null;
let commandCaptureActive = false;
let commandCaptureBuffer = '';
let replayingBuffer = false;

const propTerminalId = computed(
  () => props.params?.params?.terminalId ?? props.params?.terminalId ?? '',
);
const overrideTerminalId = ref<string | null>(null);
const terminalId = computed(() => overrideTerminalId.value ?? propTerminalId.value);
const rendererRole = computed<'compact' | 'full'>(() => (compact.value ? 'compact' : 'full'));
const isOwnedByOther = computed(() => {
  const owner = terminalStore.activeRendererOwner[terminalId.value];

  return owner !== undefined && owner !== rendererRole.value;
});
const summary = computed(() => terminalStore.terminals.find((t) => t.id === terminalId.value));
const buffer = computed(() => terminalStore.buffers[terminalId.value] ?? '');
const terminalPrefs = computed(() => settingsStore.settings.terminal);
const integrationNonce = computed(() => summary.value?.integrationNonce ?? '');

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
    console.warn('[terminal addon] failed to load', err);

    try {
      addon.dispose();
    } catch {
      /* ignore dispose failures from partially activated addons */
    }
  }
}

function applyShellEvent(event: TerminalShellEvent): void {
  if (!terminalId.value) return;

  if (event.kind === 'commandStart') {
    commandCaptureActive = true;
    commandCaptureBuffer = '';

    if (!terminalStore.activeCommands[terminalId.value]) {
      terminalStore.startCommand(terminalId.value, {
        cwd: terminalStore.currentCwd[terminalId.value] ?? summary.value?.cwd,
        protocol: event.protocol,
        trusted: false,
      });
    }

    return;
  }

  if (event.kind === 'commandFinish') {
    const output = commandCaptureBuffer;

    commandCaptureActive = false;
    commandCaptureBuffer = '';
    terminalStore.finishCommand(terminalId.value, event.exitCode, output);

    return;
  }

  if (event.kind === 'commandLine') {
    const patch = {
      command: event.command,
      cwd: terminalStore.currentCwd[terminalId.value] ?? summary.value?.cwd,
      protocol: event.protocol,
      trusted: event.trusted,
    };

    if (terminalStore.activeCommands[terminalId.value])
      terminalStore.updateActiveCommand(terminalId.value, patch);
    else terminalStore.startCommand(terminalId.value, patch);

    return;
  }

  if (event.kind === 'cwd') {
    terminalStore.updateTerminalCwd(terminalId.value, event.cwd);
  }
}

function handleOsc(ident: 7 | 9 | 133 | 633 | 1337, data: string): boolean {
  const parsed = parseTerminalOsc(ident, data, integrationNonce.value);

  if (replayingBuffer) return parsed.handled;

  parsed.events.forEach(applyShellEvent);

  return parsed.handled;
}

function registerShellIntegrationHandlers(): void {
  if (!term) return;

  addonDisposables.push(
    term.parser.registerOscHandler(633, (data) => handleOsc(633, data)),
    term.parser.registerOscHandler(133, (data) => handleOsc(133, data)),
    term.parser.registerOscHandler(7, (data) => handleOsc(7, data)),
    term.parser.registerOscHandler(9, (data) => handleOsc(9, data)),
    term.parser.registerOscHandler(1337, (data) => handleOsc(1337, data)),
  );
}

function searchDecorations() {
  return {
    matchBackground: '#1f2937',
    activeMatchBackground: '#0ea5e9',
    matchOverviewRuler: '#64748b',
    activeMatchColorOverviewRuler: '#38bdf8',
  };
}

function runSearch(
  direction: 'next' | 'previous',
  incremental = false,
  queryOverride?: string,
): void {
  const query = (queryOverride ?? searchQuery.value).trim();

  if (!query) {
    search?.clearDecorations();
    searchResultLabel.value = '';

    return;
  }

  if (!search) {
    searchResultLabel.value = 'Search unavailable';

    return;
  }

  const options = {
    incremental,
    decorations: searchDecorations(),
  };
  const found =
    direction === 'next' ? search.findNext(query, options) : search.findPrevious(query, options);

  if (!found) searchResultLabel.value = 'No matches';
}

function scheduleSearch(incremental = true): void {
  if (!searchOpen.value || !searchQuery.value.trim()) return;

  if (pendingSearchFrame !== null) cancelAnimationFrame(pendingSearchFrame);

  pendingSearchFrame = requestAnimationFrame(() => {
    pendingSearchFrame = null;
    runSearch('next', incremental);
  });
}

function findNext(): void {
  runSearch('next');
}

function findPrevious(): void {
  runSearch('previous');
}

function onSearchInput(event: Event): void {
  const next = (event.target as HTMLInputElement).value;

  searchQuery.value = next;
  runSearch('next', true, next);
}

async function copySelection(): Promise<void> {
  const selected = term?.getSelection();

  if (selected) await navigator.clipboard.writeText(selected);
}

function registerCopyShortcuts(): void {
  term?.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;

    const isCopyShortcut =
      (event.ctrlKey && event.shiftKey && event.code === 'KeyC') ||
      (event.altKey && event.code === 'Insert');

    if (!isCopyShortcut) return true;

    const selected = term?.getSelection();

    if (!selected) return true;

    void navigator.clipboard.writeText(selected);

    return false;
  });
}

function focusSession(): void {
  const sessionId = summary.value?.sessionId;

  if (!sessionId) return;

  layoutStore.addPanel(sessionId);
  layoutStore.activatePanel(sessionId);
  setTimeout(() => {
    busEmit('focus-composer', { sessionId });
  }, 0);
}

function initXterm(): void {
  if (term || !host.value || isOwnedByOther.value) return;

  terminalStore.claimRenderer(terminalId.value, rendererRole.value);
  term = new Terminal({
    allowProposedApi: true,
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
    loadAddon(search, () => {
      term?.loadAddon(search!);
      addonDisposables.push(
        search!.onDidChangeResults(({ resultIndex, resultCount }) => {
          searchResultLabel.value =
            resultCount > 0 ? `${resultIndex + 1} / ${resultCount}` : 'No matches';
        }),
      );
    });
  }

  if (addons.serialize) {
    const serializeAddon = new SerializeAddon();

    loadAddon(serializeAddon, () => term?.loadAddon(serializeAddon));
  }

  if (addons.unicode11) {
    const unicode11 = new Unicode11Addon();

    loadAddon(unicode11, () => {
      term?.loadAddon(unicode11);

      if (term) term.unicode.activeVersion = '11';
    });
  }

  if (addons.unicodeGraphemes) {
    const unicodeGraphemes = new UnicodeGraphemesAddon();

    loadAddon(unicodeGraphemes, () => term?.loadAddon(unicodeGraphemes));
  }

  if (addons.webLinks) {
    const links = new WebLinksAddon((_event, uri) => {
      void invokeCommand('openUrl', { url: uri }).catch(() => {
        /* best-effort link open */
      });
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
      void webFonts
        ?.loadFonts()
        .then(() => fitAndNotify())
        .catch(() => {});
    });
  }

  if (addons.progress) {
    const progressAddon = new ProgressAddon();

    loadAddon(progressAddon, () => {
      term?.loadAddon(progressAddon);
      addonDisposables.push(
        progressAddon.onChange((state) => {
          progress.value = state;
        }),
      );
    });
  }

  if (addons.image) {
    const image = new ImageAddon({ storageLimit: 64 });

    loadAddon(image, () => term?.loadAddon(image));
  }

  if (addons.webgl) {
    webgl = new WebglAddon();
    loadAddon(webgl, () => {
      term?.loadAddon(webgl!);
      addonDisposables.push(
        webgl!.onContextLoss(() => {
          webgl?.dispose();
          webgl = null;
        }),
      );
    });
  }

  term.open(host.value);

  if (addons.ligatures) {
    const ligatures = new LigaturesAddon();

    loadAddon(ligatures, () => term?.loadAddon(ligatures));
  }

  if (buffer.value) {
    replayingBuffer = true;
    term.write(buffer.value, () => {
      replayingBuffer = false;
      scheduleSearch(false);
    });
  }

  registerShellIntegrationHandlers();
  registerCopyShortcuts();
  term.onData((data) => {
    if (terminalId.value) void terminalStore.writeTerminal(terminalId.value, data);
  });
  resizeObserver = new ResizeObserver(() => fitAndNotify());
  resizeObserver.observe(host.value);
  setTimeout(fitAndNotify, 0);
  setTimeout(() => term?.focus(), 0);
}

onMounted(async () => {
  await nextTick();

  if (!host.value) return;

  // Recovery: if this terminal doesn't exist on the backend (e.g. after restart),
  // find the session that owned it and create a new terminal
  if (terminalId.value && !terminalStore.terminals.find((t) => t.id === terminalId.value)) {
    const sessionId = Object.entries(terminalStore.sessionTerminalIds).find(
      ([, tid]) => tid === propTerminalId.value,
    )?.[0];

    if (sessionId) {
      try {
        const newTerminal = await terminalStore.getOrCreateSessionTerminal(sessionId);

        overrideTerminalId.value = newTerminal.id;
        await nextTick();
      } catch {
        /* recovery failed, proceed with stale id */
      }
    }
  }

  initXterm();
  offFocusTerminal = busOn('focus-terminal', ({ terminalId: id }) => {
    if (id !== terminalId.value) return;
    term?.focus();
  });
});

// When ownership is released by another renderer, initialize xterm
watch(isOwnedByOther, (blocked) => {
  if (!blocked && !term && host.value) {
    initXterm();
  }
});

watch(buffer, (next, prev) => {
  if (!term) return;

  if (next.length < prev.length) {
    term.reset();
    term.write(next, () => scheduleSearch(false));
  } else if (next.length > prev.length) {
    const delta = next.slice(prev.length);

    if (commandCaptureActive) commandCaptureBuffer += delta;

    term.write(delta, () => scheduleSearch(false));
  }
});

watch(searchOpen, async (open) => {
  if (!open) {
    search?.clearDecorations();
    searchResultLabel.value = '';
    term?.focus();

    return;
  }

  await nextTick();
  searchInput.value?.focus();
  searchInput.value?.select();
});

watch(searchQuery, () => scheduleSearch(true), { flush: 'post' });

onBeforeUnmount(() => {
  terminalStore.releaseRenderer(terminalId.value, rendererRole.value);
  offFocusTerminal?.();
  offFocusTerminal = null;
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (pendingSearchFrame !== null) {
    cancelAnimationFrame(pendingSearchFrame);
    pendingSearchFrame = null;
  }

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

let offFocusTerminal: (() => void) | null = null;
</script>

<template>
  <section
    class="terminal-panel"
    :class="{ compact }"
  >
    <header
      v-if="!compact"
      class="terminal-header"
    >
      <div class="terminal-title">
        <strong>{{ summary?.title ?? 'Terminal' }}</strong>
        <small>{{ summary?.cwd }}</small>
      </div>
      <div
        v-if="progress.state !== 0"
        class="terminal-progress"
        :class="`state-${progress.state}`"
        :title="`Progress ${progress.value}%`"
      >
        <span
          class="terminal-progress-bar"
          :style="{ width: `${progress.value}%` }"
        />
      </div>
      <div class="terminal-actions">
        <Button
          v-if="summary?.sessionId"
          icon="pi pi-comments"
          label="Session"
          text
          size="small"
          aria-label="Open owning session"
          title="Open owning session"
          @click="focusSession"
        />
        <Button
          icon="pi pi-search"
          label="Find"
          text
          size="small"
          aria-label="Search terminal"
          title="Search terminal"
          :aria-pressed="searchOpen"
          @click="searchOpen = !searchOpen"
        />
        <Button
          icon="pi pi-copy"
          label="Copy"
          text
          size="small"
          aria-label="Copy selected terminal text"
          title="Copy selected text"
          @click="copySelection"
        />
      </div>
      <Button
        v-if="summary?.status === 'running'"
        label="Kill"
        size="small"
        severity="secondary"
        @click="terminalStore.killTerminal(terminalId)"
      />
      <span
        v-else
        class="terminal-status"
        >{{ summary?.status ?? 'missing' }}</span
      >
    </header>
    <form
      v-if="!compact && searchOpen"
      class="terminal-search"
      @submit.prevent="findNext"
    >
      <input
        ref="searchInput"
        :value="searchQuery"
        type="search"
        placeholder="Search terminal"
        aria-label="Search terminal"
        @input="onSearchInput"
      />
      <span
        class="terminal-search-status"
        role="status"
        aria-live="polite"
        >{{ searchResultLabel }}</span
      >
      <Button
        icon="pi pi-arrow-up"
        label="Previous"
        text
        size="small"
        aria-label="Previous result"
        type="button"
        @click="findPrevious"
      />
      <Button
        icon="pi pi-arrow-down"
        label="Next"
        text
        size="small"
        aria-label="Next result"
        type="submit"
      />
    </form>
    <div
      ref="host"
      class="terminal-host"
    />
    <div
      v-if="isOwnedByOther"
      class="terminal-frozen-placeholder"
    >
      <span
        >Terminal in use by
        {{ isOwnedByOther ? (rendererRole === 'full' ? 'editor' : 'terminal tab') : '' }}</span
      >
    </div>
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
  position: relative;
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
  flex-wrap: wrap;
  justify-content: flex-end;
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

.terminal-search-status {
  flex: 0 0 auto;
  min-width: 4.5rem;
  color: #9ca3af;
  font-size: 0.72rem;
  text-align: center;
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

.terminal-frozen-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.9);
  color: #9ca3af;
  font-size: 0.85rem;
  z-index: 10;
}
</style>
