/// IPC + state for the Agents tab in the Library panel.
///
/// Handles both global (no-session) listing via `listAgentFilesGlobal`
/// and per-session listing via `listAgentFiles`. The CRUD ops require
/// a session (the SDK reload path is session-scoped); callers MUST
/// pass the session id explicitly.

import { ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import type { AgentFileEntry, AgentFileScope, AgentFileSpec } from '@/ipc/types';
import { toErrorMessage } from '@/lib/errorMessage';

export function useAgentsLibrary() {
  const files = ref<AgentFileEntry[]>([]);
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function load(sessionId: string | undefined): Promise<void> {
    error.value = null;
    loaded.value = false;

    try {
      if (sessionId) {
        files.value = await invokeCommand('listAgentFiles', { sessionId });
      } else {
        // No session: user-scope only.
        files.value = await invokeCommand('listAgentFilesGlobal', {});
      }
    } catch (err) {
      error.value = toErrorMessage(err);
    } finally {
      loaded.value = true;
    }
  }

  /// Create (or overwrite) an agent file. Returns the written path
  /// on success, or null on failure (already toasted).
  async function write(sessionId: string, spec: AgentFileSpec): Promise<string | null> {
    try {
      return await invokeCommand('writeAgentFile', { sessionId, spec });
    } catch (err) {
      useToastStore().error('Save failed', toErrorMessage(err));

      return null;
    }
  }

  /// Delete an agent file. Returns `removed` IPC bool, or null on
  /// failure (already toasted).
  async function remove(
    sessionId: string,
    scope: AgentFileScope,
    name: string,
  ): Promise<boolean | null> {
    try {
      return await invokeCommand('deleteAgentFile', { sessionId, scope, name });
    } catch (err) {
      useToastStore().error('Delete failed', toErrorMessage(err));

      return null;
    }
  }

  return { files, loaded, error, load, write, remove };
}
