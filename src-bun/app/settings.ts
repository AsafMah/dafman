// Versioned on-disk settings store.
//
// Mirrors the old Rust `SettingsService` (see prior `src-tauri/src/app/settings.rs`).
// JSON file at `<userData>/settings.json`. Load synchronously at startup,
// persist async via `Bun.write`. Parse failures fall back to defaults so
// the user can always open the Settings dialog to recover.
//
// Framework-agnostic: this module never imports from `electrobun/bun`.
// The caller (in `src-bun/index.ts`) resolves the path via
// `Utils.paths.userData` and hands it to `SettingsService.loadOrDefault`.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import type {
  Appearance,
  Layout,
  NotificationPrefs,
  PermissionsPrefs,
  ReasoningVisibility,
  Settings,
  TerminalPrefs,
  ThemeChoice,
  ToolsPrefs,
  Workspaces,
} from '../rpc';
import { AppError } from './errors';
import { log } from './logging';
import { toErrorMessage } from './errorMessage';

export const SETTINGS_VERSION = 14;

/// One-time backfill: returns `<homedir>/dafman` (created on demand),
/// or `""` on failure. Used by `src-bun/index.ts` to populate the
/// default workspace when the user has never set one. Restored after
/// 20b's knip-driven sweep wrongly removed it (knip's reachability
/// graph didn't trace through electrobun's bun build entry, so it
/// reported this as unused; the consumer in index.ts was the only
/// caller).
export async function ensureDefaultWorkspace(): Promise<string> {
  try {
    const home = homedir();
    if (!home) return '';
    const target = join(home, 'dafman');
    await mkdir(target, { recursive: true });
    return target;
  } catch (err) {
    log.warn('ensureDefaultWorkspace failed', {
      error: toErrorMessage(err),
    });
    return '';
  }
}
/// Hard upper bound on the size of the workspace MRU. Anything beyond
/// this trims off the tail so the on-disk settings file doesn't grow
/// unbounded. Kept conservative — the AutoComplete dropdown becomes
/// unwieldy past ~10 items anyway.
const WORKSPACES_MRU_LIMIT = 10;

const VALID_THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
const VALID_REASONING: readonly ReasoningVisibility[] = ['hidden', 'compact', 'expanded'];

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    // Default streaming = false: a botched rAF-throttle attempt
    // (committed in 9474bf3, reverted in 51d5dd7) showed that
    // per-delta reconciles cause jitter + repeated-words bugs.
    // Until we have a reliable batching layer, default to non-
    // streaming — the agent's reply lands in one chunk per
    // `assistant.message` event. Users can opt back in via
    // Settings → Appearance.
    appearance: {
      theme: 'system',
      reasoningVisibility: 'compact',
      defaultModelId: 'auto',
      defaultReasoningEffort: null,
      streaming: false,
      enableMermaid: false,
    },
    layout: { dockview: null },
    workspaces: { recent: [], defaultWorkspace: '' },
    notifications: { turnEnd: false, waitingForInput: true },
    tools: { defaultExcluded: [], defaultAllowed: [] },
    permissions: { defaultApproveAll: false },
    terminal: {
      defaultProfileId: 'platform-default',
      fontFamily: 'Cascadia Mono, Consolas, ui-monospace, monospace',
      fontSize: 13,
      scrollback: 10_000,
      theme: { background: '#111827', foreground: '#d1d5db' },
      addons: {
        search: true,
        webLinks: true,
        clipboard: true,
        unicode11: true,
        webFonts: true,
        progress: true,
        ligatures: true,
        image: true,
        unicodeGraphemes: true,
        webgl: true,
        serialize: true,
      },
    },
  };
}

function coerceTools(raw: unknown): ToolsPrefs {
  if (!raw || typeof raw !== 'object') return { defaultExcluded: [], defaultAllowed: [] };
  const obj = raw as { defaultExcluded?: unknown; defaultAllowed?: unknown };
  const dedupeStringList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of input) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  };
  return {
    defaultExcluded: dedupeStringList(obj.defaultExcluded),
    defaultAllowed: dedupeStringList(obj.defaultAllowed),
  };
}

function coerceAppearance(raw: unknown): Appearance {
  const base = defaultSettings().appearance;
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const theme = VALID_THEMES.includes(obj.theme as ThemeChoice)
    ? (obj.theme as ThemeChoice)
    : base.theme;
  const rv = VALID_REASONING.includes(obj.reasoningVisibility as ReasoningVisibility)
    ? (obj.reasoningVisibility as ReasoningVisibility)
    : base.reasoningVisibility;
  const streaming = typeof obj.streaming === 'boolean' ? obj.streaming : base.streaming;
  const enableMermaid =
    typeof obj.enableMermaid === 'boolean' ? obj.enableMermaid : base.enableMermaid;
  const defaultModelId =
    typeof obj.defaultModelId === 'string' ? obj.defaultModelId.trim() : base.defaultModelId;
  const defaultReasoningEffort =
    typeof obj.defaultReasoningEffort === 'string' && obj.defaultReasoningEffort.trim()
      ? obj.defaultReasoningEffort.trim()
      : null;
  return {
    theme,
    reasoningVisibility: rv,
    defaultModelId,
    defaultReasoningEffort,
    streaming,
    enableMermaid,
  };
}

/// Coerces a raw `layout` blob into the canonical shape. The dockview
/// JSON is treated as opaque — we only validate that it's an object.
/// Anything else (string, number, malformed) resets to `null`, which
/// causes startup-resume to skip layout restoration entirely.
function coerceLayout(raw: unknown): Layout {
  if (!raw || typeof raw !== 'object') return { dockview: null };
  const obj = raw as Record<string, unknown>;
  const dv = obj.dockview;
  return {
    dockview: dv && typeof dv === 'object' && !Array.isArray(dv) ? dv : null,
  };
}

/// Coerces a raw `workspaces` blob into the canonical shape. Drops
/// non-string entries, trims whitespace, deduplicates (case-sensitive
/// — Windows-vs-Unix mixed paths aren't normalized here; the renderer
/// avoids inserting a path that already exists modulo trim).
function coerceWorkspaces(raw: unknown): Workspaces {
  if (!raw || typeof raw !== 'object') return { recent: [], defaultWorkspace: '' };
  const list = (raw as { recent?: unknown }).recent;
  const seen = new Set<string>();
  const out: string[] = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= WORKSPACES_MRU_LIMIT) break;
    }
  }
  const rawDefault = (raw as { defaultWorkspace?: unknown }).defaultWorkspace;
  const defaultWorkspace = typeof rawDefault === 'string' ? rawDefault.trim() : '';
  return { recent: out, defaultWorkspace };
}

/// Coerces a raw `notifications` blob into the canonical shape. Both
/// fields default to their `defaultSettings()` values (false +
/// true) when missing — so v5 → v6 migration produces sensible
/// behaviour out of the box (waiting-for-input ON, turn-end OFF).
function coerceNotifications(raw: unknown): NotificationPrefs {
  const base = defaultSettings().notifications;
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const turnEnd = typeof obj.turnEnd === 'boolean' ? obj.turnEnd : base.turnEnd;
  const waitingForInput =
    typeof obj.waitingForInput === 'boolean' ? obj.waitingForInput : base.waitingForInput;
  return { turnEnd, waitingForInput };
}

/// 22c: coerces the `permissions` blob. Single boolean knob; older
/// settings files (v9 and earlier) lack the field entirely so we
/// fall back to the default (off).
function coercePermissions(raw: unknown): PermissionsPrefs {
  const base = defaultSettings().permissions;
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const defaultApproveAll =
    typeof obj.defaultApproveAll === 'boolean' ? obj.defaultApproveAll : base.defaultApproveAll;
  return { defaultApproveAll };
}

function coerceTerminal(raw: unknown): TerminalPrefs {
  const base = defaultSettings().terminal;
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const defaultProfileId =
    typeof obj.defaultProfileId === 'string' && obj.defaultProfileId.trim()
      ? obj.defaultProfileId.trim()
      : base.defaultProfileId;
  const fontFamily =
    typeof obj.fontFamily === 'string' && obj.fontFamily.trim()
      ? obj.fontFamily.trim()
      : base.fontFamily;
  const fontSize =
    typeof obj.fontSize === 'number' && Number.isFinite(obj.fontSize)
      ? Math.min(32, Math.max(8, Math.floor(obj.fontSize)))
      : base.fontSize;
  const scrollback =
    typeof obj.scrollback === 'number' && Number.isFinite(obj.scrollback)
      ? Math.min(100_000, Math.max(1_000, Math.floor(obj.scrollback)))
      : base.scrollback;
  const rawTheme = obj.theme as Record<string, unknown> | undefined;
  const background =
    typeof rawTheme?.background === 'string' && rawTheme.background.trim()
      ? rawTheme.background.trim()
      : base.theme.background;
  const foreground =
    typeof rawTheme?.foreground === 'string' && rawTheme.foreground.trim()
      ? rawTheme.foreground.trim()
      : base.theme.foreground;
  const rawAddons = obj.addons as Record<string, unknown> | undefined;
  const addons = { ...base.addons };
  for (const key of Object.keys(addons) as Array<keyof typeof addons>) {
    if (typeof rawAddons?.[key] === 'boolean') addons[key] = rawAddons[key];
  }
  return {
    defaultProfileId,
    fontFamily,
    fontSize,
    scrollback,
    theme: { background, foreground },
    addons,
  };
}

export function migrate(input: unknown): Settings {
  const defaults = defaultSettings();
  if (!input || typeof input !== 'object') return defaults;
  const raw = input as Record<string, unknown>;
  return {
    version: SETTINGS_VERSION,
    appearance: coerceAppearance(raw.appearance),
    layout: coerceLayout(raw.layout),
    workspaces: coerceWorkspaces(raw.workspaces),
    notifications: coerceNotifications(raw.notifications),
    tools: coerceTools(raw.tools),
    permissions: coercePermissions(raw.permissions),
    terminal: coerceTerminal(raw.terminal),
  };
}

export class SettingsService {
  private cache: Settings;

  private constructor(
    public readonly path: string,
    initial: Settings,
  ) {
    this.cache = initial;
  }

  static loadOrDefault(path: string): SettingsService {
    if (!existsSync(path)) {
      log.info('settings file not found, using defaults', { path });
      return new SettingsService(path, defaultSettings());
    }
    try {
      const raw = readFileSync(path, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return new SettingsService(path, migrate(parsed));
    } catch (err) {
      log.warn('failed to read settings, falling back to defaults', {
        path,
        error: toErrorMessage(err),
      });
      return new SettingsService(path, defaultSettings());
    }
  }

  get(): Settings {
    return structuredClone(this.cache);
  }

  async update(next: Settings): Promise<Settings> {
    const stamped: Settings = { ...migrate(next), version: SETTINGS_VERSION };
    this.cache = stamped;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await Bun.write(this.path, JSON.stringify(stamped, null, 2));
    } catch (err) {
      const message = toErrorMessage(err);
      throw AppError.settings(message);
    }
    return structuredClone(stamped);
  }
}
