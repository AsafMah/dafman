// Registers extra prism grammars beyond the ones `@lexical/code`
// ships with. Side-effect-only module — importing it once at startup
// is enough; prism's grammar components register themselves on the
// global Prism singleton.
//
// `@lexical/code` bundles: clike, javascript/typescript, markup
// (html/xml), markdown, c, css, objectivec, sql, powershell, python,
// rust, swift, java, cpp. Everything else needs to be loaded by us.
//
// Order matters: prism components that depend on a base grammar must
// be imported AFTER it. `bash` has no deps, but e.g. `tsx` would
// depend on `jsx` etc. We keep this set small (no dependencies
// between grammars in this list).

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — prismjs/components are side-effect imports without
// TypeScript declarations.
import "prismjs/components/prism-bash.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-json.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-diff.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-yaml.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-toml.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-go.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-ruby.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-php.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-kotlin.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import "prismjs/components/prism-csharp.js";

// Re-export an empty constant so consumers can `import "./prismLanguages"`
// without bun complaining about an unused side-effect-only module in
// some bundler configurations.
export const PRISM_LANGUAGES_LOADED = true;
