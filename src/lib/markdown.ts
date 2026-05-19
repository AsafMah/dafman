import MarkdownIt from "markdown-it";
// markdown-it-task-lists ships no types; declared in src/types/shims.d.ts.
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";
import Prism from "prismjs";
// Side-effect: registers extra prism grammars (bash, json, diff, yaml,
// toml, go, ruby, php, kotlin, csharp) on the global Prism singleton.
// Importing it here means `renderMarkdown` highlights the same set of
// languages whether it's called from MessageContent.vue (which also
// imports it) or from a unit test.
import "../lexical/prismExtraLanguages";

/// Renders untrusted markdown to safe HTML for display in read-only
/// message bubbles. Pipeline: markdown-it (GFM-leaning subset: tables,
/// strikethrough, autolinks via linkify, fenced code, task lists via
/// plugin) → custom renderer rules that tag each block element with the
/// existing `lex-*` CSS classes (so the same stylesheet covers both the
/// composer's Lexical-rendered DOM and these markdown-it bubbles) →
/// DOMPurify with an explicit GFM-safe allowlist.
///
/// `html: false` rejects raw inline HTML so we never need to trust the
/// model not to inject `<script>`. DOMPurify is the second line of
/// defence: it sanitizes the HTML markdown-it produces (in case a
/// future plugin or our own renderer rule emits something unexpected).
///
/// Code blocks run through Prism if a language is registered. Languages
/// outside `@lexical/code`'s bundled set are registered as a side
/// effect of importing `../lexical/prismExtraLanguages` from the
/// component that renders messages.
const md: MarkdownIt = new MarkdownIt({
  html: false,
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
    "h1","h2","h3","h4","h5","h6",
    "p","blockquote","pre","code",
    "ul","ol","li",
    "table","thead","tbody","tr","th","td",
    "strong","em","s","del",
    "input",
    "a","br","hr","span",
    "img",
  ] as string[],
  ALLOWED_ATTR: [
    "href","target","rel","class","type","checked","disabled",
    "data-highlight-language","colspan","rowspan","align","start",
    "src","alt","title",
  ] as string[],
  ALLOW_DATA_ATTR: false,
};

export function renderMarkdown(source: string): string {
  if (!source) return "";
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
