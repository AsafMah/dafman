// Extra prism grammars beyond what `@lexical/code` ships with.
//
// @lexical/code bundles a fixed subset: clike, javascript / typescript,
// markup (html / xml), markdown, c, css, objectivec, sql, powershell,
// python, rust, swift, java, cpp. Our per-tool renderer registry routes
// most blocks to languages OUTSIDE that set — bash (shell), json (args),
// diff (apply_patch), yaml / toml (configs), go / ruby / php / kotlin /
// csharp. Without these registrations, ToolCallBlock's code fences
// render as un-highlighted monospace.
//
// Earlier attempt failed (`748f65d`) with a blank-screen crash because
// the side-effect imports ran from `main.ts` BEFORE @lexical/code was
// loaded, so prismjs's components couldn't find `globalThis.Prism` and
// threw at module-init. Fix here is two-fold:
//
//   1. Import `'prismjs'` first in this file. ES module ordering
//      guarantees it evaluates before the subsequent component imports,
//      so the global Prism singleton is set up.
//   2. Import THIS module from `MessageContent.vue` (which also
//      imports @lexical/code transitively) rather than from `main.ts`.
//      Either order works in theory because of #1, but loading here
//      avoids running grammar registrations during the early app boot
//      where they wouldn't be useful yet.

import 'prismjs';

// IMPORTANT: dependency order matters. Each prism component file
// expects its prerequisites already registered on the global `Prism`
// singleton at import time, and throws if they aren't. A blank-screen
// regression has happened on this file before — see the comment block
// above plus commit history for `748f65d`.
//
// Grouped by dependency tier so reorderings are obvious:
//   tier 0  — no deps
//   tier 1  — depends on tier 0
//   tier 2  — depends on tier 1
//   tier 3  — depends on tier 2

// tier 0
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-clike';

// tier 1 — need markup OR clike
import 'prismjs/components/prism-markup-templating'; // → markup
import 'prismjs/components/prism-css'; // → markup
import 'prismjs/components/prism-c'; // → clike
import 'prismjs/components/prism-javascript'; // → clike
import 'prismjs/components/prism-sql'; // → clike
import 'prismjs/components/prism-java'; // → clike
import 'prismjs/components/prism-csharp'; // → clike
import 'prismjs/components/prism-go'; // → clike
import 'prismjs/components/prism-bash'; // standalone
import 'prismjs/components/prism-python'; // standalone
import 'prismjs/components/prism-rust'; // standalone
import 'prismjs/components/prism-yaml'; // standalone
import 'prismjs/components/prism-toml'; // standalone
import 'prismjs/components/prism-diff'; // standalone
import 'prismjs/components/prism-json'; // standalone
import 'prismjs/components/prism-powershell'; // standalone
import 'prismjs/components/prism-ruby'; // standalone
// tier 2 — need a tier-1 lang
import 'prismjs/components/prism-cpp'; // → c
import 'prismjs/components/prism-typescript'; // → javascript
import 'prismjs/components/prism-kotlin'; // → java/clike
import 'prismjs/components/prism-php'; // → markup-templating + clike
import 'prismjs/components/prism-markdown'; // → markup-templating

// NOTE: prism-objectivec and prism-swift are imported here NOT because
// we care about highlighting them (Windows-only dev tool, no Apple
// target) but because `@lexical/code` imports them transitively. If
// we don't also import them here, Vite's esbuild dep optimizer
// inlines them directly into @lexical/code's chunk WITHOUT the
// prerequisite prism-c, causing
// `Cannot set properties of undefined (setting 'string')` in
// HMR mode. By importing them here too, esbuild externalizes them
// like the other prism components, which means they get loaded
// after the others (proper order). prism-c (tier 1 above) is
// guaranteed registered first.
import 'prismjs/components/prism-objectivec'; // → c
import 'prismjs/components/prism-swift'; // standalone

// tier 3 — need a tier-2 lang
import 'prismjs/components/prism-jsx'; // → markup + javascript
import 'prismjs/components/prism-tsx'; // → jsx + typescript

export const PRISM_EXTRA_LANGUAGES_LOADED = true;
