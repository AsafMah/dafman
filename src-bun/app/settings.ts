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
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type {
	Appearance,
	Layout,
	ReasoningVisibility,
	Settings,
	ThemeChoice,
} from "../rpc";
import { AppError } from "./errors";
import { log } from "./logging";

export const SETTINGS_VERSION = 3;

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

export function migrate(input: unknown): Settings {
	const defaults = defaultSettings();
	if (!input || typeof input !== "object") return defaults;
	const raw = input as Record<string, unknown>;
	return {
		version: SETTINGS_VERSION,
		appearance: coerceAppearance(raw.appearance),
		layout: coerceLayout(raw.layout),
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
