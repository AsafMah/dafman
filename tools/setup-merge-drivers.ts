import { execFileSync } from "node:child_process";

/// One-time developer setup: register the `weave` entity-level merge driver
/// in the user's GLOBAL git config so the `merge=weave` mappings in
/// `.gitattributes` take effect across clones. Idempotent — safe to re-run.
/// `union` (used for the Markdown logs) is a built-in git driver and needs
/// nothing here.
///
/// Requires the `weave` + `weave-driver` binaries on PATH:
/// https://github.com/Ataraxy-Labs/weave
///   brew install weave            (macOS / Linux)
///   # or grab a prebuilt release (incl. Windows) and put both binaries on PATH
///
/// weave parses .vue / .ts / .json / .yaml / … via tree-sitter and merges at
/// the entity (function / block / key) level, so independent edits to the
/// same file auto-resolve instead of false-conflicting. LOCAL only — GitHub's
/// server-side merge is unaffected.

const DRIVER = "weave-driver %O %A %B %L %P";

function git(args: string[]): void {
	execFileSync("git", args, { stdio: "inherit" });
}

function isInstalled(cmd: string): boolean {
	try {
		execFileSync(cmd, ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

if (!isInstalled("weave-driver")) {
	console.error(
		"weave-driver not found on PATH. Install weave\n" +
			"(https://github.com/Ataraxy-Labs/weave): `brew install weave`, or grab a\n" +
			"prebuilt release and put `weave` + `weave-driver` on PATH, then re-run\n" +
			"`bun run setup:merge`.",
	);
	process.exit(1);
}

git(["config", "--global", "merge.weave.name", "weave entity-level merge"]);
git(["config", "--global", "merge.weave.driver", DRIVER]);
// Show the base revision so 3-way reconstruction is unambiguous.
git(["config", "--global", "merge.conflictStyle", "diff3"]);

console.log(
	"Registered the weave merge driver globally. Code + .vue conflicts now resolve\n" +
		"entity-aware on local merges/rebases; the Markdown logs use the built-in\n" +
		"`union` driver. Nothing runs server-side — this is a local-only win.",
);
