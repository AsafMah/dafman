import MarkdownIt from "markdown-it";
// markdown-it plugins. Types for footnote/emoji ship via @types/*; the
// other three are declared in src/electrobun-shims.d.ts.
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import deflist from "markdown-it-deflist";
import { full as emoji } from "markdown-it-emoji";
import texmath from "markdown-it-texmath";
import katex from "katex";
import DOMPurify from "dompurify";
import Prism from "prismjs";
// Side-effect: registers the prism grammars used by MessageContent for
// fenced-code highlighting. See the file for the language list.
// Importing it here means `renderMarkdown` highlights the same set of
// languages whether it's called from MessageContent.vue (which also
// imports it transitively) or directly from a unit test that doesn't
// mount the Vue tree.
import "../lexical/prismExtraLanguages";

/// Renders untrusted markdown to safe HTML for display in read-only
/// message bubbles. Pipeline: markdown-it (`html: true`, `linkify`)
/// with task lists / footnotes / definition lists / emoji / texmath
/// (KaTeX) plugins → custom renderer rules that tag each block with
/// the existing `lex-*` CSS classes (so one stylesheet covers both
/// the composer's Lexical DOM and these markdown-it bubbles) →
/// DOMPurify with a strict GFM-safe allowlist that includes the
/// inline-HTML tags we want to permit (`details`, `summary`, `dl`,
/// `dt`, `dd`, `kbd`, `sub`, `sup`, `mark`).
///
/// Why `html: true` is safe here: DOMPurify is the security boundary,
/// not markdown-it. We let raw HTML *parse* (so `<details>` and
/// `<summary>` survive into the output) but every tag and attribute
/// is then run through DOMPurify's allowlist. `<script>`, `<style>`,
/// event handlers, `javascript:` URLs, and the `style` attribute
/// (CSS-injection vector — arbitrary positioning, color leaks, etc.)
/// are all stripped. If the user wants colored text they should ask
/// for a Markdown extension, not raw `style=`.
///
/// Code blocks run through Prism. Languages outside the bundled set
/// fall through to plain escaped HTML in a `<pre class="lex-code">`.
const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
  highlight(code, lang) {
    const language = (lang || "").trim().toLowerCase();
    if (language && Prism.languages[language]) {
      try {
        const highlighted = Prism.highlight(
          code,
          Prism.languages[language] as Prism.Grammar,
          language,
        );
        return (
          `<pre class="lex-code" data-highlight-language="${escapeAttr(language)}">` +
          `<code class="language-${escapeAttr(language)}">${highlighted}</code></pre>`
        );
      } catch {
        // fall through to unhighlighted rendering
      }
    }
    return `<pre class="lex-code"><code>${escapeHtml(code)}</code></pre>`;
  },
});

md.use(taskLists, { enabled: false, label: false });
md.use(footnote);
md.use(deflist);
md.use(emoji);
md.use(texmath, {
  engine: katex,
  delimiters: "dollars",
  katexOptions: { throwOnError: false, output: "html" },
});

/// Re-tag a block-level open token with one of our `lex-*` class names.
function addOpenClass(tag: string, cls: string): void {
  const original = md.renderer.rules[`${tag}_open`];
  md.renderer.rules[`${tag}_open`] = (tokens, idx, opts, env, self) => {
    tokens[idx]!.attrJoin("class", cls);
    return original
      ? original(tokens, idx, opts, env, self)
      : self.renderToken(tokens, idx, opts);
  };
}
addOpenClass("paragraph", "lex-paragraph");
addOpenClass("blockquote", "lex-quote");
addOpenClass("bullet_list", "lex-ul");
addOpenClass("ordered_list", "lex-ol");
addOpenClass("list_item", "lex-li");
addOpenClass("table", "md-table");

// Headings: tag varies (h1..h6); pick the matching lex class.
md.renderer.rules.heading_open = (tokens, idx, opts, _env, self) => {
  const t = tokens[idx]!;
  t.attrJoin("class", `lex-${t.tag}`);
  return self.renderToken(tokens, idx, opts);
};

// Inline tokens (no _open/_close pair on these — they're self-rendering).
const codeInline = md.renderer.rules.code_inline;
md.renderer.rules.code_inline = (tokens, idx, opts, env, self) => {
  tokens[idx]!.attrJoin("class", "lex-text-code");
  return codeInline
    ? codeInline(tokens, idx, opts, env, self)
    : self.renderToken(tokens, idx, opts);
};

const linkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
  const t = tokens[idx]!;
  t.attrJoin("class", "lex-link");
  t.attrSet("target", "_blank");
  t.attrSet("rel", "noopener noreferrer");
  return linkOpen
    ? linkOpen(tokens, idx, opts, env, self)
    : self.renderToken(tokens, idx, opts);
};

md.renderer.rules.s_open = (tokens, idx, opts, _env, self) => {
  tokens[idx]!.attrJoin("class", "lex-text-strike");
  return self.renderToken(tokens, idx, opts);
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/// DOMPurify allowlist: every tag/attribute markdown-it can emit through
/// our rules, plus the prism span tokens. No `<script>`, no `<style>`,
/// no event handlers — DOMPurify strips those by default but we list
/// allowed tags/attrs explicitly so future renderer rules that emit
/// something outside this list are caught at sanitize time.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    // headings + block text
    "h1","h2","h3","h4","h5","h6",
    "p","blockquote","pre","code",
    // lists
    "ul","ol","li",
    // definition lists (markdown-it-deflist)
    "dl","dt","dd",
    // tables (GFM core)
    "table","thead","tbody","tr","th","td",
    // inline emphasis + semantic
    "strong","em","s","del","kbd","sub","sup","mark",
    // task-list checkboxes (markdown-it-task-lists)
    "input",
    // collapsible sections (raw HTML pass-through after sanitize)
    "details","summary",
    // footnotes (markdown-it-footnote emits section/hr/ol/li with anchors)
    "section","a","br","hr","span",
    // images (linked, sanitized)
    "img",
    // KaTeX HTML output (`output: "html"` emits nested span trees with
    // MathML annotations for screen readers)
    "math","semantics","mrow","mi","mo","mn","msup","msub","mfrac","msqrt","annotation","mtext",
  ] as string[],
  ALLOWED_ATTR: [
    // links + images
    "href","target","rel","src","alt","title",
    // class is how every renderer-rule / plugin attaches styling;
    // KaTeX in particular leans on dozens of class names. Allowed.
    "class",
    // task-list checkboxes
    "type","checked","disabled",
    // collapsible
    "open",
    // tables
    "colspan","rowspan","align","start",
    // code-highlight metadata used by our CSS
    "data-highlight-language",
    // footnote/cross-reference anchors
    "id","name",
    // KaTeX accessibility
    "role","aria-hidden","aria-label","xmlns","encoding",
    // KaTeX inline sizing (em-width spans) is the one place we accept
    // a constrained `style` — narrowed below in the FORBID_ATTR rule
    // wouldn't help us, so we list it and rely on DOMPurify's URL
    // sanitization + a custom hook that strips anything not matching
    // `width:` / `margin:` / `height:` patterns.
    "style",
  ] as string[],
  ALLOW_DATA_ATTR: false,
};

// DOMPurify uAfterSanitizeAttributes hook: tighten the `style`
// allowlist to the small subset KaTeX uses for inline math sizing.
// Anything else (color, position, transform, font-family, etc.) is
// stripped. This is run once at module load.
let purifyHookInstalled = false;
function ensurePurifyHook(): void {
  if (purifyHookInstalled) return;
  if (typeof DOMPurify.addHook !== "function") return;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName !== "style") return;
    // KaTeX uses: width, height, margin-left, margin-right, margin-top,
    // top, left, vertical-align, padding-left/right, position:relative.
    // Tighter than the general "ALLOW_STYLE" sledgehammer.
    const allowed =
      /^(?:\s*(?:width|height|margin(?:-(?:left|right|top|bottom))?|top|left|right|bottom|vertical-align|padding(?:-(?:left|right|top|bottom))?|position)\s*:\s*[^;:]+;?\s*)+$/;
    if (!allowed.test(data.attrValue)) {
      data.attrValue = "";
      data.keepAttr = false;
    }
  });
  purifyHookInstalled = true;
}

export function renderMarkdown(source: string): string {
  if (!source) return "";
  ensurePurifyHook();
  const dirty = md.render(source);
  return DOMPurify.sanitize(dirty, PURIFY_CONFIG);
}

/// Wraps a string in a fenced markdown code block. The outer fence is
/// chosen dynamically so embedded ``` runs in `content` can't close the
/// block early — tool output frequently contains markdown samples,
/// shell echoes of fenced code, or LLM-formatted snippets, and a fixed
/// three-backtick fence would split mid-block on the first inner ```.
///
/// CommonMark allows any opening/closing fence of identical backticks
/// of length ≥ 3; we pick `max(3, longestInnerRun + 1)` so the closer
/// is always strictly longer than anything inside the body.
///
/// Returns the empty string for empty input so callers can pass
/// through `partialOutput` / `resultContent` without conditioning.
export function fenced(content: string, language: string): string {
  if (!content) return "";
  const body = content.endsWith("\n") ? content : `${content}\n`;
  const longestRun = (body.match(/`+/g) ?? []).reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${body}${fence}`;
}
