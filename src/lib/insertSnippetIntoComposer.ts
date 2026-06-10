/// Insert a snippet's body into the active session's composer.
///
/// Dispatches an `insert-composer-text` bus event scoped to `sessionId`.
/// `MessageComposer.vue` subscribes to this event and inserts the text at
/// the Lexical cursor position (or at the end if the editor is empty).
///
/// Usage:
///   insertSnippetIntoComposer(snippetId, sessionId)
///
/// Returns `false` when the snippet is not found; `true` otherwise.

import { emit } from '@/lib/bus';
import { useSnippetsStore } from '@/stores/snippetsStore';

export function insertSnippetIntoComposer(snippetId: string, sessionId: string): boolean {
  const store = useSnippetsStore();
  const snippet = store.snippets.find((s) => s.id === snippetId);

  if (!snippet) return false;

  emit('insert-composer-text', { sessionId, text: snippet.body });

  return true;
}
