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

import "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-go";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-php";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-csharp";

export const PRISM_EXTRA_LANGUAGES_LOADED = true;
