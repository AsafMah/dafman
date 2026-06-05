import { execFileSync } from "node:child_process";

/// One-time developer setup: register the `mergiraf` syntax-aware merge
/// driver in the user's GLOBAL git config so the `merge=mergiraf` mappings
/// in `.gitattributes` take effect across every clone. Idempotent — safe to
/// re-run. `union` (used for the Markdown logs) is a built-in git driver and
/// needs nothing here.
///
/// Requires the `mergiraf` binary: https://mergiraf.org
///   cargo install mergiraf   (or a prebuilt release / package manager)

const DRIVER = "mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L";

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

if (!isInstalled("mergiraf")) {
	console.error(
		"mergiraf not found on PATH. Install it (https://mergiraf.org):\n" +
			"  cargo install mergiraf\n" +
			"or grab a prebuilt release, then re-run `bun run setup:merge`.",
	);
	process.exit(1);
}

git(["config", "--global", "merge.mergiraf.name", "mergiraf"]);
git(["config", "--global", "merge.mergiraf.driver", DRIVER]);
// mergiraf reconstructs base/ours/theirs, so it needs the base shown.
git(["config", "--global", "merge.conflictStyle", "diff3"]);

console.log(
	"Registered the mergiraf merge driver globally. Code conflicts (.ts/.json/…)\n" +
		"now resolve syntax-aware on local merges/rebases; the Markdown logs use the\n" +
		"built-in `union` driver. Nothing runs server-side — this is a local-only win.",
);
