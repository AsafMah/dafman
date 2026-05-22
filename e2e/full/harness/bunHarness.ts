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
  port: number;
  wsUrl: string;
  workspace: string;
  userData: string;
  /// Invoke a control-namespace RPC on the test-server (e.g.
  /// `__test.setSendScript`). Tests use this to drive the fake SDK
  /// from outside the renderer.
  invokeControl: <T = unknown>(name: string, args: Record<string, unknown>) => Promise<T>;
  /// Stop the bun subprocess + remove the temp workspace.
  teardown: () => Promise<void>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

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
  stubPickerPath?: string;
} = {}): Promise<BunHarness> {
  const workspace = options.workspace ?? seedWorkspace();
  const userData = join(workspace, ".dafman-userdata");
  const port = pickPort();
  const args = [
    "src-bun/test-server.ts",
    `--port=${port}`,
    `--workspace=${workspace}`,
    `--user-data=${userData}`,
  ];
  if (options.stubPickerPath) {
    args.push(`--stub-picker=${options.stubPickerPath}`);
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

  const invokeControl = makeControlClient(`ws://127.0.0.1:${port}`);

  return {
    port,
    wsUrl: `ws://127.0.0.1:${port}`,
    workspace,
    userData,
    invokeControl,
    async teardown() {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 50));
      try {
        rmSync(workspace, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
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
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 100_000;
  function ensure(): Promise<void> {
    if (ws && ws.readyState === 1) return Promise.resolve();
    return new Promise((resolveFn, reject) => {
      ws = new WebSocket(wsUrl);
      ws.addEventListener("open", () => resolveFn());
      ws.addEventListener("error", () => reject(new Error("control ws connect failed")));
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
  }
  return async function invokeControl<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await ensure();
    const id = nextId++;
    return new Promise<T>((resolveFn, reject) => {
      pending.set(id, { resolve: resolveFn as (v: unknown) => void, reject });
      ws!.send(JSON.stringify({ type: "request", id, name, args }));
    });
  };
}
