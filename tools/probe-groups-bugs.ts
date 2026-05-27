// One-off probe for the three bugs the user called out 2026-05-27:
//   1. Sessions go nowhere after creating
//   2. No + button for new groups
//   3. Group tabs can be dragged into edge panels (and break)
//
// Run from a separate terminal with `vite preview --port 4173` already up.

import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const STUB_SRC = readFileSync("e2e/smoke.pwtest.ts", "utf8");
// Extract the stub installer body — we already have a tested one.
const stubMatch = /async function installRpcStub.*?^}/ms.exec(STUB_SRC);
if (!stubMatch) throw new Error("could not extract stub installer");

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

page.on("console", (m) => console.log(`[page:${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.error("[page:exception]", e.message));

// Inline the smoke stub (same fixture as the smoke test uses).
await page.addInitScript(() => {
  const stub: Record<string, (a: unknown) => unknown> = {
    getSettings: () => ({
      version: 14,
      appearance: {
        theme: "system",
        reasoningVisibility: "compact",
        defaultModelId: "auto",
        defaultReasoningEffort: null,
        streaming: false,
        enableMermaid: false,
      },
      layout: { dockview: null, schemaVersion: 2 },
      workspaces: { recent: [], defaultWorkspace: "" },
      notifications: { turnEnd: false, waitingForInput: true },
      tools: { defaultExcluded: [], defaultAllowed: [] },
      permissions: { defaultApproveAll: false },
      terminal: {
        defaultProfileId: "platform-default",
        fontFamily: "Cascadia Mono, Consolas, ui-monospace, monospace",
        fontSize: 13,
        scrollback: 10000,
        theme: { background: "#111827", foreground: "#d1d5db" },
        addons: {
          search: true, webLinks: true, clipboard: true, unicode11: true,
          webFonts: true, progress: true, ligatures: true, image: true,
          unicodeGraphemes: true, webgl: true, serialize: true,
        },
      },
    }),
    updateSettings: (a: unknown) => {
      const next = (a as { next: unknown }).next;
      const persisted = next as { layout?: unknown };
      (window as unknown as { __PERSIST_CALLS__: unknown[] }).__PERSIST_CALLS__ ??= [];
      (window as unknown as { __PERSIST_CALLS__: unknown[] }).__PERSIST_CALLS__.push(persisted.layout);
      return next;
    },
    createClient: () => ({ status: "ready" }),
    listModels: () => [],
    listSessions: () => [],
    rendererLog: () => null,
    openLogFolder: () => true,
    openUrl: () => true,
    pickFolder: () => null,
    browseDirectory: () => [],
    revealPath: () => null,
    respondToRequest: () => true,
    getAuditState: () => ({ recent: [], pendingCount: 0 }),
    getLogState: () => ({ recent: [], droppedCount: 0 }),
    listJobs: () => [],
    createSession: () => ({
      id: "sess-probe-1",
      title: "Probe session",
      cwd: "C:\\probe",
      workingDirectory: "C:\\probe",
    }),
    getSessionMetadata: () => ({ summary: "Probe session", context: { workingDirectory: "C:\\probe" } }),
    listSessionEvents: () => [],
    listSessionHistory: () => [],
    getSession: () => ({ id: "sess-probe-1", title: "Probe session", cwd: "C:\\probe", workingDirectory: "C:\\probe" }),
  };
  (window as unknown as { __DAFMAN_TEST_RPC__: unknown }).__DAFMAN_TEST_RPC__ = {
    request(name: string, args: unknown) {
      const h = stub[name];
      if (!h) return Promise.reject(new Error(`Stub: unhandled RPC '${name}'`));
      try { return Promise.resolve(h(args)); } catch (e) { return Promise.reject(e); }
    },
    onSessionEvent: () => () => undefined,
    onPendingRequest: () => () => undefined,
    onLogEvent: () => () => undefined,
    onAuditEvent: () => () => undefined,
  };
});

await page.goto("http://localhost:4173/");
await page.locator(".dv-dockview").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);

console.log("\n=== STATE 1: boot complete ===");
const s1 = await page.evaluate(() => ({
  outerTabs: Array.from(document.querySelectorAll(".dv-grid-view.dv-dockview .dv-tabs-and-actions-container")).map((t) => ({
    isVertical: t.classList.contains("dv-groupview-header-vertical"),
    width: (t as HTMLElement).getBoundingClientRect().width,
    panelIds: Array.from(t.querySelectorAll(".dv-tab")).map((dt) => dt.querySelector(".group-tab-title")?.textContent?.trim() ?? dt.querySelector(".activity-bar-tab")?.getAttribute("aria-label") ?? "?"),
  })),
  groupTabCount: document.querySelectorAll(".group-tab").length,
  innerDockview: document.querySelectorAll(".group-inner").length,
  headerActionRight: !!document.querySelector(".dv-right-actions-container .new-group-button"),
  prefixActions: document.querySelector(".dv-pre-actions-container")?.outerHTML?.length ?? 0,
}));
console.log(JSON.stringify(s1, null, 2));

console.log("\n=== ACTION: layoutStore.addPanel('sess-1') (bug 1) ===");
const s2 = await page.evaluate(async () => {
  type DafmanTest = {
    addPanel: (id: string) => void;
    getState: () => unknown;
  };
  const w = window as unknown as { __DAFMAN_TEST__?: DafmanTest };
  if (!w.__DAFMAN_TEST__) return { error: "__DAFMAN_TEST__ missing — restart vite preview after bundle rebuild" };
  const before = w.__DAFMAN_TEST__.getState();
  w.__DAFMAN_TEST__.addPanel("sess-1");
  return { before, after: w.__DAFMAN_TEST__.getState() };
});
console.log(JSON.stringify(s2, null, 2));
await page.waitForTimeout(500);

const s3 = await page.evaluate(() => ({
  innerDockviewCount: document.querySelectorAll(".group-inner").length,
  // Look for the chat panel everywhere.
  chatPanelInOuter: document.querySelectorAll(".dv-grid-view.dv-dockview > .dv-content-container [data-component=chat], .dv-grid-view.dv-dockview .dv-tab .chat-tab").length,
  chatPanelInInner: document.querySelectorAll(".group-inner .chat-tab, .group-inner .dv-content-container").length,
  innerTabs: Array.from(document.querySelectorAll(".group-inner .dv-tab")).map((t) => t.textContent?.trim()),
  innerWatermarkVisible: !!document.querySelector(".group-inner .dv-watermark"),
  totalDockviews: document.querySelectorAll(".dv-dockview").length,
  innerPanelsPerDockview: Array.from(document.querySelectorAll(".dv-dockview")).map((d) => d.querySelectorAll(":scope .dv-tab").length),
}));
console.log(JSON.stringify(s3, null, 2));

await page.screenshot({ path: "test-results/probe-after-addPanel.png", fullPage: true });

console.log("\n=== ACTION: view.newGroup (bug 4 — activeGroupId not syncing) ===");
const s5 = await page.evaluate(async () => {
  type DafmanTest = {
    runCommand: (id: string) => Promise<unknown>;
    addPanel: (id: string) => void;
    getState: () => unknown;
  };
  const w = window as unknown as { __DAFMAN_TEST__?: DafmanTest };
  await w.__DAFMAN_TEST__!.runCommand("view.newGroup");
  return { afterNewGroup: w.__DAFMAN_TEST__!.getState() };
});
console.log(JSON.stringify(s5, null, 2));
await page.waitForTimeout(300);

console.log("\n=== ACTION: layoutStore.addPanel('sess-2') after newGroup ===");
const s6 = await page.evaluate(async () => {
  type DafmanTest = { addPanel: (id: string) => void; getState: () => unknown };
  const w = window as unknown as { __DAFMAN_TEST__?: DafmanTest };
  w.__DAFMAN_TEST__!.addPanel("sess-2");
  return { afterAddSecond: w.__DAFMAN_TEST__!.getState() };
});
console.log(JSON.stringify(s6, null, 2));
await page.waitForTimeout(300);

const innerTabsByGroup = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".group-inner")).map((el) => ({
    parentTabName: el.closest(".dv-content-container")?.parentElement?.querySelector(".group-tab-title")?.textContent?.trim() ?? "?",
    tabIds: Array.from(el.querySelectorAll(".dv-tab")).map((t) => t.textContent?.trim()),
  }));
});
console.log("[smoke:inner-tabs]", JSON.stringify(innerTabsByGroup, null, 2));

await page.screenshot({ path: "test-results/probe-after-newGroup-addSess2.png", fullPage: true });

console.log("\n=== Persist check: settings updates received ===");
// Wait beyond schedulePersist debounce (300ms) so the queued save flushes.
await page.waitForTimeout(500);
const persistCalls = await page.evaluate(() => {
  const calls = (window as unknown as { __PERSIST_CALLS__?: unknown[] }).__PERSIST_CALLS__ ?? [];
  return {
    count: calls.length,
    last: calls.at(-1) as unknown,
  };
});
console.log("[smoke:persist]", JSON.stringify(persistCalls, null, 2));

console.log("\n=== Looking for + button on outer body tab strip (bug 2) ===");
const s4 = await page.evaluate(() => {
  // Find the outer body's tab strip (horizontal one).
  const containers = Array.from(document.querySelectorAll(".dv-tabs-and-actions-container"));
  const bodyStrip = containers.find((c) => !c.classList.contains("dv-groupview-header-vertical"));
  if (!bodyStrip) return { found: false };
  return {
    found: true,
    rightActions: bodyStrip.querySelector(".dv-right-actions-container")?.outerHTML?.substring(0, 200) ?? "(empty)",
    leftActions: bodyStrip.querySelector(".dv-left-actions-container")?.outerHTML?.substring(0, 200) ?? "(empty)",
    preActions: bodyStrip.querySelector(".dv-pre-actions-container")?.outerHTML?.substring(0, 200) ?? "(empty)",
  };
});
console.log(JSON.stringify(s4, null, 2));

await browser.close();
console.log("\nScreenshot saved to test-results/probe-after-addPanel.png");
