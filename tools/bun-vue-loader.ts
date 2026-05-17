/// <reference types="@types/bun" />

// Bun test loader for Vue SFCs.
//
// Patterned on https://bun.com/docs/guides/test/svelte-test — the
// `plugin({...})` call registers a `.vue` import handler that compiles
// each Single-File Component into a JS module via `@vue/compiler-sfc`.
// `beforeEach`/`afterEach` swap a fresh `happy-dom` environment in for
// every test so DOM-touching code (mount, queries, events) works under
// `bun test`.
//
// Wire it into `bunfig.toml`:
//   [test]
//   preload = ["./tools/bun-vue-loader.ts"]

import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	parse,
	compileScript,
	compileTemplate,
	rewriteDefault,
} from "@vue/compiler-sfc";

// Register the happy-dom globals immediately, *before* anything else
// imports `vue` / `@vue/runtime-dom`. Vue captures `document` at module
// load time, so deferring this to `beforeEach` (as the Svelte guide
// does) yields `null is not an object (evaluating 'doc.createElement')`
// on first mount. Each test gets a fresh body via `beforeEach` below.
GlobalRegistrator.register();

beforeEach(() => {
	if (typeof document !== "undefined") {
		document.body.innerHTML = "";
		document.head.innerHTML = "";
	}
});

let scopeCounter = 0;
function nextScopeId(): string {
	scopeCounter += 1;
	return `data-v-${scopeCounter.toString(36)}`;
}

plugin({
	name: "vue-sfc-loader",
	setup(builder) {
		builder.onLoad({ filter: /\.vue(\?[^.]+)?$/ }, ({ path }) => {
			const real = path.includes("?")
				? path.substring(0, path.indexOf("?"))
				: path;
			const source = readFileSync(real, "utf-8");
			const { descriptor, errors } = parse(source, { filename: real });
			if (errors.length) {
				throw new Error(
					`Vue SFC parse failed (${real}):\n${errors
						.map((e) => e.message)
						.join("\n")}`,
				);
			}

			const id = nextScopeId();
			const hasScoped = descriptor.styles.some((s) => s.scoped);
			const scopeId = hasScoped ? id : undefined;
			const isTs =
				descriptor.script?.lang === "ts" ||
				descriptor.scriptSetup?.lang === "ts";
			const parserPlugins: Array<"typescript"> = isTs
				? ["typescript"]
				: [];

			const scriptBlock = compileScript(descriptor, {
				id,
				inlineTemplate: true,
				templateOptions: { scoped: hasScoped, id },
			});

			let scriptCode = rewriteDefault(
				scriptBlock.content,
				"__sfc_main__",
				parserPlugins,
			);

			// When the SFC uses `<script setup>` we already get an inlined
			// render via `inlineTemplate: true`, so a separate `compileTemplate`
			// pass would just produce duplicate hoisted-vnode constants
			// (`_hoisted_1` declared twice → parse error). Gate the fallback on
			// the source descriptor rather than `scriptBlock.scriptSetup`, which
			// is `undefined` on the returned `SFCScriptBlock` regardless.
			if (!descriptor.scriptSetup && descriptor.template) {
				const tpl = compileTemplate({
					id,
					filename: real,
					source: descriptor.template.content,
					scoped: hasScoped,
					compilerOptions: { scopeId },
				});
				scriptCode += `\n${tpl.code.replace(/export\s+function\s+render\b/, "function render")}\n__sfc_main__.render = render;`;
			}

			scriptCode += `\n__sfc_main__.__file = ${JSON.stringify(real)};`;
			if (scopeId) {
				scriptCode += `\n__sfc_main__.__scopeId = ${JSON.stringify(scopeId)};`;
			}
			scriptCode += `\nexport default __sfc_main__;`;

			return { contents: scriptCode, loader: "ts" };
		});
	},
});
