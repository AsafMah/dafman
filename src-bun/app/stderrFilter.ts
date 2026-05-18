// Stderr noise filter for relayed CLI subprocess output.
//
// The Copilot CLI binary uses `node-pty` on Windows. When the parent
// process (bun under Electrobun) has no Windows console attached
// (which is always the case for a GUI app), node-pty's
// `conpty_console_list_agent.js` helper crashes during module init
// with `Error: AttachConsole failed` and dumps a multi-line stack
// trace. It's harmless — node-pty falls back to ConPTY — but the
// `@github/copilot` SDK relays the CLI's stderr verbatim with a
// `[CLI subprocess]` prefix (see `copilot-sdk-supercharged`
// `client.js`), so the trace ends up in our terminal on every run.
//
// We install a stderr write filter that:
//   1. Drops lines matching known node-pty / AttachConsole noise.
//   2. Routes all other `[CLI subprocess]` lines into our structured
//      log so they're preserved in the JSON log file.
//   3. Passes everything else through unchanged.
//
// The patch is process-global. Install it once at startup, before the
// SDK has a chance to relay any subprocess output.

import { log } from "./logging";

/// Patterns to drop entirely. Each line of stderr is matched against
/// every pattern — a match suppresses the whole line. Tuned for the
/// node-pty AttachConsole stack trace; add more patterns here as
/// needed.
const NOISE_PATTERNS: readonly RegExp[] = [
	/conpty_console_list_agent\.js/,
	/AttachConsole failed/,
	/at Object\.<anonymous>/,
	/at Module\._(compile|load)/,
	/at (Object|Module)\.\.js/,
	/at Module\.load/,
	/at wrapModuleLoad/,
	/at loadCJSModuleWithModuleLoad/,
	/at ModuleWrap\.<anonymous>/,
	/at ModuleJob\.run/,
	/at async node:internal\/modules/,
	/at node:internal\/modules/,
	/^Error: AttachConsole/,
];

const CLI_SUBPROCESS_PREFIX = "[CLI subprocess] ";

/// Returns true if the given line should be dropped entirely.
export function isNoiseLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed) return false;
	return NOISE_PATTERNS.some((re) => re.test(trimmed));
}

let installed = false;

export function installStderrFilter(): void {
	if (installed) return;
	installed = true;

	const originalWrite = process.stderr.write.bind(process.stderr);

	type WriteArgs = Parameters<typeof process.stderr.write>;

	const patched = (...args: WriteArgs): boolean => {
		const [chunk, encodingOrCb, maybeCb] = args;
		const cb = typeof encodingOrCb === "function" ? encodingOrCb : maybeCb;
		const encoding =
			typeof encodingOrCb === "string"
				? (encodingOrCb as BufferEncoding)
				: undefined;
		const text =
			typeof chunk === "string"
				? chunk
				: Buffer.isBuffer(chunk)
					? chunk.toString(encoding ?? "utf8")
					: null;
		if (text === null) {
			// Unknown chunk type — fall back to the original write.
			return originalWrite(...(args as Parameters<typeof originalWrite>));
		}
		// Filter per-line so a single noisy line in an otherwise useful
		// chunk doesn't drop the rest. `split` preserves a trailing
		// empty entry on chunks ending in "\n" so we don't accidentally
		// strip newlines.
		const lines = text.split("\n");
		const kept: string[] = [];
		for (const line of lines) {
			if (isNoiseLine(line)) continue;
			if (line.startsWith(CLI_SUBPROCESS_PREFIX)) {
				const body = line.slice(CLI_SUBPROCESS_PREFIX.length);
				if (body.trim()) {
					try {
						log.debug("cli subprocess stderr", { line: body });
					} catch {
						/* logger not ready yet; drop */
					}
				}
				continue;
			}
			kept.push(line);
		}
		if (kept.length === 0 || (kept.length === 1 && kept[0] === "")) {
			// Whole chunk filtered out — call the callback so the writer
			// doesn't stall waiting on a drain that never comes.
			cb?.(null);
			return true;
		}
		const joined = kept.join("\n");
		if (encoding) return originalWrite(joined, encoding, cb);
		if (cb) return originalWrite(joined, cb);
		return originalWrite(joined);
	};

	process.stderr.write = patched as typeof process.stderr.write;
}
