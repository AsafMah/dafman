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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import type {
	Appearance,
	Layout,
	ReasoningVisibility,
	Settings,
	ThemeChoice,
	Workspaces,
} from "../rpc";
import { AppError } from "./errors";
import { log } from "./logging";

export const SETTINGS_VERSION = 5;
/// Hard upper bound on the size of the workspace MRU. Anything beyond
/// this trims off the tail so the on-disk settings file doesn't grow
/// unbounded. Kept conservative — the AutoComplete dropdown becomes
/// unwieldy past ~10 items anyway.
export const WORKSPACES_MRU_LIMIT = 10;

const VALID_THEMES: readonly ThemeChoice[] = ["system", "light", "dark"];
const VALID_REASONING: readonly ReasoningVisibility[] = [
	"hidden",
	"compact",
	"expanded",
];

export function defaultSettings(): Settings {
	return {
		version: SETTINGS_VERSION,
		appearance: { theme: "system", reasoningVisibility: "compact" },
		layout: { dockview: null },
		workspaces: { recent: [], defaultWorkspace: "" },
	};
}

function coerceAppearance(raw: unknown): Appearance {
	const base = defaultSettings().appearance;
	if (!raw || typeof raw !== "object") return base;
	const obj = raw as Record<string, unknown>;
	const theme = VALID_THEMES.includes(obj.theme as ThemeChoice)
		? (obj.theme as ThemeChoice)
		: base.theme;
	const rv = VALID_REASONING.includes(obj.reasoningVisibility as ReasoningVisibility)
		? (obj.reasoningVisibility as ReasoningVisibility)
		: base.reasoningVisibility;
	return { theme, reasoningVisibility: rv };
}

/// Coerces a raw `layout` blob into the canonical shape. The dockview
/// JSON is treated as opaque — we only validate that it's an object.
/// Anything else (string, number, malformed) resets to `null`, which
/// causes startup-resume to skip layout restoration entirely.
function coerceLayout(raw: unknown): Layout {
	if (!raw || typeof raw !== "object") return { dockview: null };
	const obj = raw as Record<string, unknown>;
	const dv = obj.dockview;
	return {
		dockview:
			dv && typeof dv === "object" && !Array.isArray(dv) ? dv : null,
	};
}

/// Coerces a raw `workspaces` blob into the canonical shape. Drops
/// non-string entries, trims whitespace, deduplicates (case-sensitive
/// — Windows-vs-Unix mixed paths aren't normalized here; the renderer
/// avoids inserting a path that already exists modulo trim).
function coerceWorkspaces(raw: unknown): Workspaces {
	if (!raw || typeof raw !== "object") return { recent: [], defaultWorkspace: "" };
	const list = (raw as { recent?: unknown }).recent;
	const seen = new Set<string>();
	const out: string[] = [];
	if (Array.isArray(list)) {
		for (const entry of list) {
			if (typeof entry !== "string") continue;
			const trimmed = entry.trim();
			if (!trimmed || seen.has(trimmed)) continue;
			seen.add(trimmed);
			out.push(trimmed);
			if (out.length >= WORKSPACES_MRU_LIMIT) break;
		}
	}
	const rawDefault = (raw as { defaultWorkspace?: unknown }).defaultWorkspace;
	const defaultWorkspace =
		typeof rawDefault === "string" ? rawDefault.trim() : "";
	return { recent: out, defaultWorkspace };
}

/// Resolves the auto-default workspace (`<homedir>/dafman`) and ensures
/// the directory exists. Returns the absolute path on success, or an
/// empty string when home-directory resolution / mkdir fails so the
/// renderer falls back to "no default". Idempotent — safe to call on
/// every startup; `recursive: true` makes the mkdir a no-op when the
/// directory already exists.
export async function ensureDefaultWorkspace(): Promise<string> {
	try {
		const home = homedir();
		if (!home) return "";
		const target = join(home, "dafman");
		await mkdir(target, { recursive: true });
		return target;
	} catch (err) {
		log.warn("ensureDefaultWorkspace failed", {
			error: err instanceof Error ? err.message : String(err),
		});
		return "";
	}
}

export function migrate(input: unknown): Settings {
	const defaults = defaultSettings();
	if (!input || typeof input !== "object") return defaults;
	const raw = input as Record<string, unknown>;
	return {
		version: SETTINGS_VERSION,
		appearance: coerceAppearance(raw.appearance),
		layout: coerceLayout(raw.layout),
		workspaces: coerceWorkspaces(raw.workspaces),
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
			log.info("settings file not found, using defaults", { path });
			return new SettingsService(path, defaultSettings());
		}
		try {
			const raw = readFileSync(path, "utf-8");
			const parsed = JSON.parse(raw) as unknown;
			return new SettingsService(path, migrate(parsed));
		} catch (err) {
			log.warn("failed to read settings, falling back to defaults", {
				path,
				error: err instanceof Error ? err.message : String(err),
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
			const message = err instanceof Error ? err.message : String(err);
			throw AppError.settings(message);
		}
		return structuredClone(stamped);
	}
}
