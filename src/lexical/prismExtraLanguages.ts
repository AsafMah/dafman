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
// `prism-markup-templating` is a transitive dependency of several other
// grammars (notably `prism-php` and indirectly `prism-bash`'s ecosystem
// of templated shells). It used to load via `@lexical/code`'s grammar
// bundle (prism-markdown pulls it in), but since `MessageContent` now
// renders through markdown-it instead of Lexical we can't rely on
// that side-effect. Load it explicitly so the languages below don't
// throw `Prism.languages["markup-templating"].tokenizePlaceholders`
// at first highlight.
import "prismjs/components/prism-markup-templating";

// Core grammars that used to load transitively via @lexical/code (it
// imported prism-markdown which pulls clike/markup/etc, plus its own
// auto-registered set for js/ts/python/rust/swift/java/cpp). Now that
// MessageContent goes through markdown-it (not Lexical), those grammars
// are no longer loaded as a side-effect. Register them explicitly here
// so code fences highlight on first paint.
//
// Order matters for grammars with dependencies: clike must precede
// javascript, javascript must precede typescript/jsx, markup must
// precede markdown.
import "prismjs/components/prism-clike";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-java";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-objectivec";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-powershell";

// Extras beyond @lexical/code's stock bundle — covers shell output,
// JSON args, apply_patch diffs, configs, and the languages our users
// will paste most often that the upstream Lexical bundle didn't ship.
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
