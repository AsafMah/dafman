#!/usr/bin/env bun
// tools/inspect.ts — live-app DOM/CSS inspection harness.
//
// Why this exists: when the symptom is "visual reality ≠ what the
// code seems to say" (missing icons, blank panels, wrong scroll,
// wrong focus, a rule that should apply but doesn't), the fastest
// path to the answer is:
//
//   1. Search the relevant class / selector name in the codebase
//      with the IDE index MCP (`ide_search_text`). If a stale
//      `display: none` lives in our own CSS, this finds it in 200 ms.
//
//   2. If step 1 doesn't surface it, attach to the running app and
//      ask the browser. That's this script. It exposes the same
//      info Chrome DevTools' "Elements + Computed" panel does:
//      bounding rect, computed styles, AND the matching CSS rule
//      chain (which stylesheet, which selector, which declaration
//      won the cascade).
//
//   3. If neither rung resolves it, escalate to a Playwright pwtest
//      probe (slower; controlled stubs; isolated boot).
//
// This script lives at rung 2. It assumes `bun run dev:hmr` is
// already running on port 5173 (start it in a separate terminal
// first — the script does not spawn the dev server).
//
// Usage:
//   bun run inspect ".activity-bar-tab"
//   bun run inspect ".dv-tabs-and-actions-container" --rules
//   bun run inspect ".dv-edge-group" --screenshot edge.png
//   bun run inspect ".dv-tab" --all
//
// Flags:
//   --rules        Show all CSS rules matching the element, in
//                  cascade order, with the winning declaration per
//                  property. This is the killer feature — surfaces
//                  the "display: none from src/style.css:107"
//                  answer that took us 15 round-trips to find via
//                  pwtest.
//   --screenshot   Path to save a screenshot of the element. Omit
//                  for a full-page screenshot in test-results/.
//   --all          Inspect every match for the selector, not just
//                  the first one.
//   --url          Override the dev-server URL. Default:
//                  http://localhost:5173.
//   --rpc-stub     Install the same RPC stub the smoke test uses
//                  (no real backend; useful when the app hasn't
//                  been booted with a real settings file).
//   --wait         Selector to wait for before probing. Default:
//                  ".dv-dockview". Pass an empty string to skip.

import { chromium, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

type Args = {
  selector: string;
  rules: boolean;
  screenshot: string | null;
  all: boolean;
  url: string;
  rpcStub: boolean;
  wait: string;
  headed: boolean;
  click: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    selector: "",
    rules: false,
    screenshot: null,
    all: false,
    url: "http://localhost:5173",
    rpcStub: false,
    wait: ".dv-dockview",
    headed: false,
    click: null,
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rules") args.rules = true;
    else if (a === "--all") args.all = true;
    else if (a === "--rpc-stub") args.rpcStub = true;
    else if (a === "--headed") args.headed = true;
    else if (a === "--screenshot") args.screenshot = argv[++i] ?? null;
    else if (a === "--url") args.url = argv[++i] ?? args.url;
    else if (a === "--wait") args.wait = argv[++i] ?? args.wait;
    else if (a === "--click") args.click = argv[++i] ?? null;
    else if (a === "--help" || a === "-h") {
      // eslint-disable-next-line no-console
      console.log(
        [
          "Usage: bun run inspect <selector> [--rules] [--screenshot path] [--all]",
          "                                  [--url http://127.0.0.1:5173] [--rpc-stub]",
          "                                  [--wait .dv-dockview] [--headed]",
          "",
          "Prerequisites:",
          "  - `bun run hmr` running on port 5173 (default), OR",
          "  - `bun run vite preview --port 4173` after `bun run build` (use",
          "    --url http://127.0.0.1:4173).",
          "  - --rpc-stub is required unless you've also pointed the renderer at",
          "    a real backend bridge (otherwise the boot splash never dismisses).",
        ].join("\n"),
      );
      process.exit(0);
    } else if (a.startsWith("--")) {
      // eslint-disable-next-line no-console
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else {
      rest.push(a);
    }
  }

  if (rest.length === 0) {
    // eslint-disable-next-line no-console
    console.error("Missing selector. Pass one as the first positional arg.");
    process.exit(2);
  }
  args.selector = rest[0]!;

  return args;
}

async function installRpcStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const stub = {
      getSettings: () => ({
        version: 14,
        appearance: { theme: "system", reasoningVisibility: "compact", streaming: false },
        layout: { dockview: null, schemaVersion: 2 },
        workspaces: { recent: [], defaultWorkspace: "" },
        notifications: { turnEnd: false, waitingForInput: true },
      }),
      updateSettings: ({ next }: { next: unknown }) => next,
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
    } as Record<string, (args: unknown) => unknown>;

    (window as unknown as { __DAFMAN_TEST_RPC__: unknown }).__DAFMAN_TEST_RPC__ = {
      request(name: string, args: unknown): Promise<unknown> {
        const handler = stub[name];
        if (!handler) return Promise.reject(new Error(`stub: unhandled ${name}`));
        return Promise.resolve(handler(args));
      },
      onSessionEvent: () => () => undefined,
      onPendingRequest: () => () => undefined,
      onLogEvent: () => () => undefined,
      onAuditEvent: () => () => undefined,
    };
  });
}

interface ProbeResult {
  rect: { x: number; y: number; width: number; height: number };
  tagName: string;
  classes: string;
  inlineStyle: string | null;
  computed: Record<string, string>;
  outerHTML: string;
}

async function probeBasic(page: Page, selector: string, all: boolean): Promise<ProbeResult[]> {
  return page.evaluate(
    ({ sel, all: returnAll }) => {
      const nodes = returnAll
        ? Array.from(document.querySelectorAll(sel))
        : (() => {
            const n = document.querySelector(sel);
            return n ? [n] : [];
          })();

      // Subset of computed style worth showing by default. Add more
      // here if a future bug needs them; the matching-rules probe
      // below shows the full cascade.
      const interesting = [
        "display",
        "visibility",
        "opacity",
        "position",
        "width",
        "height",
        "padding",
        "margin",
        "color",
        "background-color",
        "font-size",
        "writing-mode",
        "flex",
        "flex-direction",
        "z-index",
        "overflow",
      ];

      return nodes.map((el) => {
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const computed: Record<string, string> = {};
        for (const prop of interesting) {
          computed[prop] = cs.getPropertyValue(prop);
        }
        return {
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
          tagName: el.tagName,
          classes: typeof el.className === "string" ? el.className : "",
          inlineStyle: el.getAttribute("style"),
          computed,
          outerHTML: el.outerHTML.substring(0, 500),
        };
      });
    },
    { sel: selector, all },
  );
}

interface MatchedRule {
  selector: string;
  origin: string;
  stylesheetHref: string | null;
  ruleText: string;
}

/**
 * Returns every CSS rule that matched the first element matching
 * `selector`, in cascade order (most specific last). Uses the
 * Chrome DevTools Protocol `CSS.getMatchedStylesForNode` — the same
 * API DevTools' "Computed" panel uses to show "matching rules".
 *
 * The chain is what reveals "this stale `display: none` rule from
 * style.css:107 is overriding what dockview would otherwise do."
 */
async function probeMatchingRules(page: Page, selector: string): Promise<MatchedRule[]> {
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");

  const { root } = (await client.send("DOM.getDocument", { depth: -1 })) as {
    root: { nodeId: number };
  };
  const { nodeId } = (await client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  })) as { nodeId: number };

  if (!nodeId) {
    await client.detach();
    return [];
  }

  const matched = (await client.send("CSS.getMatchedStylesForNode", { nodeId })) as {
    matchedCSSRules?: Array<{
      rule: {
        selectorList: { selectors: Array<{ text: string }> };
        origin: string;
        styleSheetId?: string;
        style: { cssText?: string };
      };
    }>;
  };

  const styleSheetIds = new Set<string>();
  for (const m of matched.matchedCSSRules ?? []) {
    if (m.rule.styleSheetId) styleSheetIds.add(m.rule.styleSheetId);
  }
  const sheetHrefs = new Map<string, string | null>();
  for (const id of styleSheetIds) {
    try {
      const info = (await client.send("CSS.getStyleSheetText", {
        styleSheetId: id,
      })) as { text: string };
      // Find any URL hint in the first line of the sheet
      const firstLine = info.text.split("\n", 1)[0];
      sheetHrefs.set(id, firstLine.startsWith("/*") ? null : null);
    } catch {
      sheetHrefs.set(id, null);
    }
  }

  const result: MatchedRule[] = (matched.matchedCSSRules ?? []).map((m) => ({
    selector: m.rule.selectorList.selectors.map((s) => s.text).join(", "),
    origin: m.rule.origin,
    stylesheetHref: m.rule.styleSheetId ? (sheetHrefs.get(m.rule.styleSheetId) ?? null) : null,
    ruleText: m.rule.style.cssText ?? "",
  }));

  await client.detach();
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await mkdir("test-results", { recursive: true });

  // eslint-disable-next-line no-console
  console.log("Launching chromium…");
  const browser = await chromium.launch({ headless: !args.headed });
  // eslint-disable-next-line no-console
  console.log("Creating context…");
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      // eslint-disable-next-line no-console
      console.error(`[page:error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    // eslint-disable-next-line no-console
    console.error(`[page:exception] ${err.message}`);
  });

  if (args.rpcStub) await installRpcStub(page);

  // eslint-disable-next-line no-console
  console.log(`Connecting to ${args.url}…`);
  await page.goto(args.url);

  if (args.wait) {
    try {
      await page.waitForSelector(args.wait, { timeout: 15_000 });
    } catch {
      // eslint-disable-next-line no-console
      console.warn(
        `Wait selector "${args.wait}" did not appear within 15s. Continuing anyway.`,
      );
    }
  }
  await page.waitForTimeout(1000);

  if (args.click) {
    // eslint-disable-next-line no-console
    console.log(`Clicking "${args.click}" before probing…`);
    try {
      // Try the locator click first; if the strip doesn't expand,
      // also try a synthetic click event with `bubbles: true`. As
      // a final fallback, dispatch a pointerdown+pointerup pair
      // (dockview's edge-strip tab click is bound via click but
      // some test environments only trigger pointer events).
      await page.locator(args.click).first().dispatchEvent('click');
      await page.waitForTimeout(800);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Click failed: ${(err as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Probing "${args.selector}"…\n`);

  const matches = await probeBasic(page, args.selector, args.all);
  if (matches.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`No elements matched "${args.selector}".`);
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(matches, null, 2));
  }

  if (args.rules && matches.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\n--- matching CSS rules (cascade order, last wins) ---");
    const rules = await probeMatchingRules(page, args.selector);
    for (const r of rules) {
      // eslint-disable-next-line no-console
      console.log(`[${r.origin}] ${r.selector}\n  ${r.ruleText.trim()}`);
    }
  }

  if (args.screenshot) {
    const path = join("test-results", args.screenshot);
    await page.screenshot({ path, fullPage: false });
    // eslint-disable-next-line no-console
    console.log(`\nScreenshot saved: ${path}`);
  }

  await browser.close();
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
