// Composable: built-in tools, MCP servers, tool state for the session details rail.

import { computed, ref, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { invokeCommand } from '@/ipc/invoke';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

export type ToolItem = { name: string; description: string; namespacedName?: string };
export type McpItem = { name: string; status: string; error?: string };
export type ToolState = 'default' | 'forbidden' | 'only-allow';

/// Critical built-in tools — disabling these makes the agent
/// effectively unusable.
const CRITICAL_TOOLS: ReadonlySet<string> = new Set([
  'bash',
  'shell',
  'str_replace_editor',
  'write_file',
  'create_file',
  'edit_file',
]);

/// Tri-state SelectButton options.
export const toolStateOptions: { label: string; value: ToolState }[] = [
  { label: 'Default', value: 'default' },
  { label: 'Only allow', value: 'only-allow' },
  { label: 'Forbid', value: 'forbidden' },
];

export function useSessionTools(sessionId: ComputedRef<string>) {
  const toasts = useToastStore();
  const settingsStore = useSettingsStore();
  const { settings } = storeToRefs(settingsStore);
  const builtinTools = ref<ToolItem[]>([]);
  const mcpServers = ref<McpItem[]>([]);
  const toolsLoaded = ref(false);
  const toolsError = ref<string | null>(null);

  async function loadBuiltinTools() {
    toolsError.value = null;

    try {
      const tools = await invokeCommand('listBuiltinTools', {});

      builtinTools.value = tools.map((t) => ({
        name: t.name,
        description: t.description,
        ...(t.namespacedName ? { namespacedName: t.namespacedName } : {}),
      }));
      toolsLoaded.value = true;
    } catch (err) {
      toolsError.value = toErrorMessage(err);
      toolsLoaded.value = true;
    }
  }

  async function loadMcpServers() {
    if (!sessionId.value) return;

    try {
      const servers = await invokeCommand('listSessionMcpServers', {
        sessionId: sessionId.value,
      });

      mcpServers.value = servers.map((s) => ({
        name: s.name,
        status: s.status,
        ...(s.error ? { error: s.error } : {}),
      }));
    } catch (err) {
      toolsError.value = toErrorMessage(err);
    }
  }

  async function setMcpServerEnabled(server: McpItem, enabled: boolean) {
    if (!sessionId.value) return;

    server.status = enabled ? 'connected' : 'disabled';

    try {
      await invokeCommand('setSessionMcpEnabled', {
        sessionId: sessionId.value,
        serverName: server.name,
        enabled,
      });
      await loadMcpServers();
    } catch (err) {
      toasts.error('Failed to toggle MCP server', toErrorMessage(err));
      server.status = enabled ? 'disabled' : 'connected';
    }
  }

  function mcpEnabled(s: McpItem): boolean {
    return s.status !== 'disabled';
  }

  function toolKey(t: ToolItem): string {
    return t.namespacedName ?? t.name;
  }

  function toolState(t: ToolItem): ToolState {
    const key = toolKey(t);

    if (settings.value.tools?.defaultExcluded?.includes(key)) return 'forbidden';

    if (settings.value.tools?.defaultAllowed?.includes(key)) return 'only-allow';

    return 'default';
  }

  async function setToolState(t: ToolItem, next: ToolState) {
    const key = toolKey(t);
    const excluded = (settings.value.tools?.defaultExcluded ?? []).filter((n) => n !== key);
    const allowed = (settings.value.tools?.defaultAllowed ?? []).filter((n) => n !== key);

    if (next === 'forbidden') excluded.push(key);

    if (next === 'only-allow') allowed.push(key);

    await settingsStore.update({
      ...settings.value,
      tools: { defaultExcluded: excluded, defaultAllowed: allowed },
    });
    toasts.info(
      'Tool change recorded',
      'Restart or recreate the session to apply (SDK does not support runtime tool mutation).',
    );
  }

  function isCriticalTool(t: ToolItem): boolean {
    return CRITICAL_TOOLS.has(t.name);
  }

  type ToolGroup = { label: string; items: ToolItem[]; isBuiltin: boolean };
  const toolGroups = computed<ToolGroup[]>(() => {
    const byPrefix = new Map<string, ToolItem[]>();
    const builtins: ToolItem[] = [];

    for (const t of builtinTools.value) {
      if (!t.namespacedName) {
        builtins.push(t);
        continue;
      }

      const prefix = t.namespacedName.split('/')[0] || 'namespaced';
      const list = byPrefix.get(prefix) ?? [];

      list.push(t);
      byPrefix.set(prefix, list);
    }

    const groups: ToolGroup[] = [];

    if (builtins.length > 0) groups.push({ label: 'Built-in', items: builtins, isBuiltin: true });

    for (const prefix of Array.from(byPrefix.keys()).sort()) {
      groups.push({
        label: prefix,
        items: byPrefix.get(prefix) ?? [],
        isBuiltin: false,
      });
    }

    return groups;
  });

  const allowlistActive = computed(() => (settings.value.tools?.defaultAllowed ?? []).length > 0);

  function resetMcp() {
    mcpServers.value = [];
  }

  return {
    builtinTools,
    mcpServers,
    toolsLoaded,
    toolsError,
    loadBuiltinTools,
    loadMcpServers,
    setMcpServerEnabled,
    mcpEnabled,
    toolKey,
    toolState,
    setToolState,
    isCriticalTool,
    toolGroups,
    allowlistActive,
    resetMcp,
  };
}
