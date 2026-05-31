// Singleton CopilotClient lifecycle.
//
// At most one client per app instance, matching the Rust
// `AppState.client` slot. `ensure()` is idempotent — the second call
// returns the existing instance and `start()` is only invoked once.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CopilotClient, RuntimeConnection } from './copilotSdk';
import { AppError } from '../shared/errors';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';

let instance: CopilotClient | null = null;
let starting: Promise<CopilotClient> | null = null;

/// Test-mode override: inject a fake client (typed `unknown` because
/// the SDK class has private members we can't reconstruct; tests pass
/// either `null` (to clear) or `client as unknown as Parameters<…>[0]`
/// for a duck-typed fake). Set to `null` to clear.
export function setClientForTest(c: unknown): void {
  instance = c as CopilotClient | null;
  starting = null;
}

/// @deprecated Use `setClientForTest` instead. Kept as a re-export so
/// existing test imports keep compiling without a sweeping rename.
export const _setClientForTest = setClientForTest;

/// Resolves the prebuilt platform-native `copilot` binary shipped by
/// `@github/copilot-<platform>-<arch>` (an optional dependency of
/// `@github/copilot`). When present we hand its path to the SDK via
/// `cliPath` so the SDK spawns the binary directly instead of falling
/// back to the JS entrypoint, which requires Node 24+ for
/// `node:sqlite` and crashes immediately under older Node runtimes.
///
/// Two resolution strategies, in order:
///   1. `import.meta.resolve` of the npm package — works in `bun run dev`
///      and anywhere node_modules is on disk.
///   2. A bundle-relative sibling of the bun entry (`import.meta.dir`) —
///      a PACKAGED build has no node_modules, so electrobun.config.ts copies
///      the native binary to `Resources/app/bun/<copilot[.exe]>`, right next
///      to the emitted `index.js`. Without this the SDK falls back to its own
///      `getBundledCliPath()` (`import.meta.resolve('@github/copilot/sdk')`),
///      which also has no node_modules and throws on every chat.
///
/// Returns `undefined` only if neither is found (e.g. an arch without
/// prebuilds), in which case we let the SDK use its bundled JS path.
function resolvePlatformCliBinary(): string | undefined {
  const pkg = `@github/copilot-${process.platform}-${process.arch}`;

  try {
    const resolved = import.meta.resolve(pkg);
    const path = fileURLToPath(resolved);

    if (existsSync(path)) return path;
  } catch {
    /* package not installed for this platform; fall through */
  }

  // Packaged-build fallback: the binary copied next to the bun entry.
  const binName = process.platform === 'win32' ? 'copilot.exe' : 'copilot';
  const bundled = join(import.meta.dir, binName);

  if (existsSync(bundled)) return bundled;

  return undefined;
}

export async function ensureClient(): Promise<CopilotClient> {
  if (instance) return instance;

  if (starting) return starting;

  starting = (async () => {
    const cliPath = resolvePlatformCliBinary();

    if (cliPath) {
      log.info('using prebuilt copilot binary', { cliPath });
    } else {
      log.warn(
        'prebuilt copilot binary not found for this platform; SDK will fall back to bundled JS (requires Node >= 24)',
        { platform: process.platform, arch: process.arch },
      );
    }

    const client = new CopilotClient(
      cliPath ? { connection: RuntimeConnection.forStdio({ path: cliPath }) } : undefined,
    );

    try {
      await client.start();
    } catch (err) {
      starting = null;
      const message = toErrorMessage(err);

      log.error('failed to start copilot client', { error: message });
      throw AppError.sdk(message);
    }

    instance = client;
    starting = null;
    log.info('copilot client started');

    return client;
  })();

  return starting;
}

export function tryGetClient(): CopilotClient {
  if (!instance) throw AppError.clientNotStarted();

  return instance;
}

export async function shutdownClient(): Promise<void> {
  if (!instance) return;

  try {
    const errs = await instance.stop();

    if (errs.length) {
      log.warn('copilot client stopped with errors', {
        count: errs.length,
        errors: errs.map((e) => e.message),
      });
    }
  } catch (err) {
    log.warn('copilot client stop threw', {
      error: toErrorMessage(err),
    });
  } finally {
    instance = null;
  }
}
