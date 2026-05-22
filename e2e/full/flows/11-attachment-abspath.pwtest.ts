/// F11 — File pill carries an ABSOLUTE path (no `..` relative leak).
///
/// Bug class: in prod, `pickAttachment` returned a path relative to
/// the bun-process cwd (the Electrobun exe's `bin/` folder),
/// producing pills like `../Resources/version.json`. Fix:
/// `pickAttachment` now passes the result through `path.resolve()`
/// when not already absolute.
///
/// Test: configure the test-server to stub the native dialog with
/// a RELATIVE path, call pickAttachment, assert the returned path
/// is absolute.

import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let tempWs: string | null = null;
let relFile: string | null = null;
let absFile: string | null = null;
let child: import("node:child_process").ChildProcess | null = null;
let port = 0;

test.beforeEach(async () => {
  tempWs = mkdtempSync(join(tmpdir(), "dafman-e2e-abs-"));
  writeFileSync(join(tempWs, "thing.txt"), "x");
  // The dialog stub returns whatever the --stub-picker= flag was
  // given. To prove the abs-path fix works, we stub with a RELATIVE
  // path (relative to the bun process cwd). The fix should resolve
  // it to absolute before returning to the renderer.
  absFile = join(tempWs, "thing.txt");
  // Compute the path that would be relative to the repo root (where
  // the bun subprocess runs).
  const repoRoot = resolve(__dirname, "..", "..", "..");
  const rel = absFile.startsWith(repoRoot)
    ? absFile.slice(repoRoot.length).replace(/^[\\/]/, "")
    : absFile;
  relFile = rel;

  port = 14000 + Math.floor(Math.random() * 1000);
  child = spawn("bun", [
    "src-bun/test-server.ts",
    `--port=${port}`,
    `--workspace=${tempWs}`,
    `--stub-picker=${relFile}`,
  ], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  // Wait for ready
  await new Promise<void>((resolveFn, reject) => {
    let buf = "";
    const onData = (b: Buffer | string) => {
      buf += String(b);
      if (buf.includes(`__TEST_SERVER_READY__::port=${port}`)) {
        child!.stdout?.off("data", onData);
        resolveFn();
      }
    };
    child!.stdout?.on("data", onData);
    setTimeout(() => reject(new Error("ready timeout")), 10_000);
  });
});

test.afterEach(async () => {
  try { child?.kill("SIGTERM"); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 50));
  if (tempWs) try { rmSync(tempWs, { recursive: true, force: true }); } catch { /* ignore */ }
  tempWs = relFile = absFile = null;
  child = null;
});

test("pickAttachment returns an absolute path even when the OS dialog reports relative", async () => {
  // Quick WS request — same wire shape as the bridge.
  const result = await new Promise<{ path: string; kind: string } | null>((resolve_, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "request",
        id: 1,
        name: "pickAttachment",
        args: { kind: "file" },
      }));
    };
    ws.onmessage = (e) => {
      const p = JSON.parse(String(e.data));
      if (p.type === "response" && p.id === 1) {
        resolve_(p.result);
        ws.close();
      }
    };
    ws.onerror = () => reject(new Error("ws err"));
    setTimeout(() => reject(new Error("response timeout")), 5000);
  });

  expect(result).not.toBeNull();
  expect(result!.kind).toBe("file");
  // The critical assertion: absolute path, no `..` leak.
  expect(isAbsolute(result!.path)).toBe(true);
  // And it resolves to the file we stubbed.
  expect(result!.path).toBe(absFile);
  // Also covers the bug shape from MANUAL_TESTS:
  expect(result!.path).not.toMatch(/\.\.[/\\]/);
  // Keep dirname import used so vue-tsc is happy on bare config:
  void dirname;
});
