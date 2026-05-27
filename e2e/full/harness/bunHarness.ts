/// Per-test bun subprocess harness.
///
/// Spawns `bun src-bun/test-server.ts --port=<ephemeral> --workspace=<tempdir>`,
/// waits for the `__TEST_SERVER_READY__` marker on stdout, and returns
/// helpers for: ws URL (for the renderer page param), workspace path
/// (for fs setup), control-RPC client (for swapping send scripts mid-
/// test), and teardown.
///
/// Each Playwright test gets its OWN bun subprocess so they're
/// isolated. Cheap because the test-server uses the fake SDK — no
/// real CLI spawn.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface BunHarness {
  readonly port: number;
  readonly wsUrl: string;
  workspace: string;
  userData: string;
  /// Invoke a control-namespace RPC on the test-server (e.g.
  /// `__test.setSendScript`). Tests use this to drive the fake SDK
  /// from outside the renderer.
  invokeControl: <T = unknown>(name: string, args: Record<string, unknown>) => Promise<T>;
  /// Stop the bun subprocess + remove the temp workspace.
  teardown: () => Promise<void>;
  /// Kill the current bun subprocess, respawn on a fresh port against
  /// the SAME workspace + userData, and rewire `port` / `wsUrl` /
  /// `invokeControl` in-place. Used to assert restart-restore flows
  /// (layout, settings, groups) without juggling two harness objects.
  restart: (overrides?: { stubPickerPath?: string }) => Promise<void>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CONTROL_CONNECT_RETRIES = 10;
const CONTROL_CONNECT_RETRY_DELAY_MS = 100;

function pickPort(): number {
  return 14000 + Math.floor(Math.random() * 1000);
}

/// Seed a temp workspace with a tiny set of files so fileSearch has
/// something to return. Returns the workspace path.
export function seedWorkspace(extra: Record<string, string> = {}): string {
  const ws = mkdtempSync(join(tmpdir(), "dafman-e2e-"));
  writeFileSync(join(ws, "README.md"), "# Hello\n");
  writeFileSync(join(ws, "package.json"), '{"name":"fixture"}\n');
  mkdirSync(join(ws, "src"));
  writeFileSync(join(ws, "src", "main.ts"), "// main\n");
  writeFileSync(join(ws, "src", "app.ts"), "// app\n");
  for (const [rel, content] of Object.entries(extra)) {
    const target = join(ws, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return ws;
}

export async function spawnBunHarness(options: {
  workspace?: string;
  /// Override the default `<workspace>/.dafman-userdata` location.
  /// Used by the cwd-persistence E2E so two bun subprocesses can
  /// share a catalog even though they point at different workspaces.
  userData?: string;
  stubPickerPath?: string;
} = {}): Promise<BunHarness> {
  const workspace = options.workspace ?? seedWorkspace();
  const userData = options.userData ?? join(workspace, ".dafman-userdata");

  // Mutable child + control-client refs so `restart()` can swap them
  // in-place while the returned harness object keeps the same identity.
  let active = await spawnChild({ workspace, userData, stubPickerPath: options.stubPickerPath });

  const harness: BunHarness = {
    get port() { return active.port; },
    get wsUrl() { return active.wsUrl; },
    workspace,
    userData,
    invokeControl: async <T = unknown>(name: string, args: Record<string, unknown>): Promise<T> => {
      return active.invokeControl<T>(name, args);
    },
    async teardown() {
      await killChild(active.child);
      // Only nuke the workspace when WE created it. The caller
      // owns external workspaces (cwd-persistence test passes its
      // own A + B tempdirs in and cleans them up itself).
      if (!options.workspace) {
        try {
          rmSync(workspace, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    },
    async restart(overrides) {
      await killChild(active.child);
      active = await spawnChild({
        workspace,
        userData,
        stubPickerPath: overrides?.stubPickerPath ?? options.stubPickerPath,
      });
    },
  };

  // BunHarness's interface declares `port` / `wsUrl` as plain strings/numbers
  // for callers, but we want them to read through to `active`. The TS shape
  // is preserved at the public boundary; the getter trick keeps `harness.wsUrl`
  // current after `restart()`.
  return harness;
}

interface ActiveChild {
  child: ChildProcess;
  port: number;
  wsUrl: string;
  invokeControl: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
}

async function spawnChild(opts: {
  workspace: string;
  userData: string;
  stubPickerPath?: string;
}): Promise<ActiveChild> {
  const port = pickPort();
  const args = [
    "src-bun/test-server.ts",
    `--port=${port}`,
    `--workspace=${opts.workspace}`,
    `--user-data=${opts.userData}`,
  ];
  if (opts.stubPickerPath) {
    args.push(`--stub-picker=${opts.stubPickerPath}`);
  }
  const child = spawn("bun", args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  child.stderr?.on("data", (b) => {
    process.stderr.write(`[bun] ${String(b)}`);
  });
  await waitForReadyMarker(child, port);
  return {
    child,
    port,
    wsUrl: `ws://127.0.0.1:${port}`,
    invokeControl: makeControlClient(`ws://127.0.0.1:${port}`),
  };
}

async function killChild(child: ChildProcess): Promise<void> {
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  // 200ms grace on Windows for the socket to drop before the next
  // spawnChild picks a (potentially same) port. The port-picker is
  // randomized so collisions are unlikely, but the wait also lets the
  // control-client `close` listeners fire and clear pending callbacks.
  await new Promise((r) => setTimeout(r, 200));
}

function waitForReadyMarker(child: ChildProcess, port: number): Promise<void> {
  return new Promise((resolveFn, reject) => {
    let buf = "";
    const onData = (b: Buffer | string) => {
      buf += String(b);
      if (buf.includes(`__TEST_SERVER_READY__::port=${port}`)) {
        child.stdout?.off("data", onData);
        resolveFn();
      }
    };
    child.stdout?.on("data", onData);
    child.once("exit", (code) =>
      reject(new Error(`test-server exited before ready (code=${code})`)),
    );
    setTimeout(() => reject(new Error("test-server ready timeout (10s)")), 10_000);
  });
}

function makeControlClient(
  wsUrl: string,
): <T>(name: string, args: Record<string, unknown>) => Promise<T> {
  let ws: WebSocket | null = null;
  let openPromise: Promise<void> | null = null;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 100_000;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolveFn) => setTimeout(resolveFn, ms));
  }

  function ensure(): Promise<void> {
    if (ws && ws.readyState === 1) return Promise.resolve();
    if (openPromise) return openPromise;
    openPromise = new Promise((resolveFn, reject) => {
      ws = new WebSocket(wsUrl);
      ws.addEventListener("open", () => resolveFn());
      ws.addEventListener("error", () => {
        const socket = ws;
        ws = null;
        openPromise = null;
        try {
          socket?.close();
        } catch {
          /* ignore */
        }
        reject(new Error("control ws connect failed"));
      });
      ws.addEventListener("close", () => {
        ws = null;
        openPromise = null;
        for (const slot of pending.values()) {
          slot.reject(new Error("control ws closed"));
        }
        pending.clear();
      });
      ws.addEventListener("message", (e) => {
        try {
          const p = JSON.parse(String(e.data)) as {
            type: string;
            id?: number;
            result?: unknown;
            error?: { message?: string };
          };
          if ((p.type === "response" || p.type === "error") && typeof p.id === "number") {
            const slot = pending.get(p.id);
            if (!slot) return;
            pending.delete(p.id);
            if (p.type === "response") slot.resolve(p.result);
            else slot.reject(new Error(p.error?.message ?? "rpc error"));
          }
        } catch {
          /* ignore */
        }
      });
    });
    return openPromise;
  }

  async function ensureWithRetry(): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= CONTROL_CONNECT_RETRIES; attempt++) {
      try {
        await ensure();
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === CONTROL_CONNECT_RETRIES) break;
        await sleep(CONTROL_CONNECT_RETRY_DELAY_MS);
      }
    }
    throw lastError ?? new Error("control ws connect failed");
  }

  return async function invokeControl<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await ensureWithRetry();
    const id = nextId++;
    return new Promise<T>((resolveFn, reject) => {
      pending.set(id, { resolve: resolveFn as (v: unknown) => void, reject });
      ws!.send(JSON.stringify({ type: "request", id, name, args }));
    });
  };
}
