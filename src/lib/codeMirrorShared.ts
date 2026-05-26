// Shared CodeMirror primitives used by both `CodeEditor.vue` (single
// EditorView with a language Compartment) and `DiffEditor.vue`
// (MergeView with explicit rebuild on language change). The two
// surfaces have different lifecycles per the comments in DiffEditor:
//
//   "CM6's Compartment.reconfigure() works inside a single EditorView,
//    but `MergeView` wraps its two halves in a way that makes the
//    post-mount reconfigure unreliable for syntax highlighting —
//    resolving up-front and rebuilding on prop change is simpler"
//
// So we DON'T extract a full `useCodeMirror()` composable. Per the
// 2026-05-26 Phase E rubber-duck: just the visual theme + the
// language-resolution helper that both files were duplicating.

import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import { resolveLanguageExtension, resolveLanguageForFile } from '@/lib/codeLanguage';

export interface CodeMirrorThemeOptions {
  /// Max content height before scroll. `0` = fit content.
  maxHeight: number;
  /// CSS padding for `.cm-content`. CodeEditor uses `0.4rem 0.6rem`;
  /// DiffEditor uses `0.3rem 0.5rem`.
  contentPadding: string;
}

/// Builds the `EditorView.theme(...)` extension shared by the chat
/// surfaces' CodeMirror instances. Font sizing, mono-font wiring,
/// transparent background, scroller max-height, content padding,
/// and gutter styling are identical between editor + diff view.
export function buildCodeMirrorTheme(opts: CodeMirrorThemeOptions): Extension {
  return EditorView.theme({
    '&': {
      fontSize: '0.82rem',
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: 'var(--p-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      maxHeight: opts.maxHeight > 0 ? `${opts.maxHeight}px` : 'none',
    },
    '.cm-content': {
      padding: opts.contentPadding,
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      borderRight: '1px solid var(--p-surface-border, rgba(255,255,255,0.08))',
    },
  });
}

export interface LanguageResolutionOptions {
  language?: string;
  filename?: string;
}

/// Resolves a `LanguageSupport` extension from either an explicit
/// language id (e.g. `"typescript"`) or a filename (extension /
/// shebang detection). Returns `null` when neither source matches a
/// known grammar. The two-tier order (explicit first, filename
/// fallback) is identical between CodeEditor + DiffEditor.
export async function resolveLanguageWithFallback(
  opts: LanguageResolutionOptions,
): Promise<Extension | null> {
  if (opts.language) {
    const ext = await resolveLanguageExtension(opts.language);

    if (ext) return ext;
  }

  if (opts.filename) {
    const ext = await resolveLanguageForFile(opts.filename);

    if (ext) return ext;
  }

  return null;
}
