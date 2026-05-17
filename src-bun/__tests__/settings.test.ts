import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SETTINGS_VERSION,
	SettingsService,
	defaultSettings,
	migrate,
} from "../app/settings";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function newTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "dafman-settings-"));
	tempDirs.push(dir);
	return dir;
}

describe("SettingsService", () => {
	test("defaults when file is missing", () => {
		const svc = SettingsService.loadOrDefault(
			join(newTempDir(), "settings.json"),
		);
		expect(svc.get()).toEqual(defaultSettings());
	});

	test("defaults when file is malformed", () => {
		const dir = newTempDir();
		const path = join(dir, "settings.json");
		writeFileSync(path, "not json {{{");
		const svc = SettingsService.loadOrDefault(path);
		expect(svc.get()).toEqual(defaultSettings());
	});

	test("update persists and round-trips on reload", async () => {
		const dir = newTempDir();
		const path = join(dir, "settings.json");
		const svc = SettingsService.loadOrDefault(path);
		const next = {
			version: SETTINGS_VERSION,
			appearance: {
				theme: "dark" as const,
				reasoningVisibility: "compact" as const,
			},
		};
		const written = await svc.update(next);
		expect(written).toEqual(next);

		const reloaded = SettingsService.loadOrDefault(path);
		expect(reloaded.get().appearance.theme).toBe("dark");
	});

	test("unknown version is stamped to current", () => {
		const dir = newTempDir();
		const path = join(dir, "settings.json");
		writeFileSync(
			path,
			JSON.stringify({ version: 999, appearance: { theme: "light" } }),
		);
		const svc = SettingsService.loadOrDefault(path);
		expect(svc.get().version).toBe(SETTINGS_VERSION);
		expect(svc.get().appearance.theme).toBe("light");
	});

	test("v1 document migrates with default reasoningVisibility", () => {
		const dir = newTempDir();
		const path = join(dir, "settings.json");
		writeFileSync(
			path,
			JSON.stringify({ version: 1, appearance: { theme: "dark" } }),
		);
		const svc = SettingsService.loadOrDefault(path);
		const settings = svc.get();
		expect(settings.version).toBe(SETTINGS_VERSION);
		expect(settings.appearance.theme).toBe("dark");
		expect(settings.appearance.reasoningVisibility).toBe("compact");
	});

	test("migrate rejects bogus fields", () => {
		const settings = migrate({
			version: 1,
			appearance: { theme: "neon", reasoningVisibility: "verbose" },
		});
		expect(settings.appearance.theme).toBe("system");
		expect(settings.appearance.reasoningVisibility).toBe("compact");
	});
});
