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
