// Project overlay apply + capture operations.
//
// Fans out a project's defaults through per-session setter RPCs. Uses a
// duck-typed SessionOps interface so this module stays framework-agnostic
// and can be unit-tested without a real SessionRegistry.
//
// apply: sequence — agent → mcp → skills → mode → model → approveAll.
//   Per-op errors push a warning instead of throwing so partial failures
//   surface to the user without aborting the whole apply.
//
// capture: reads live session config (getCurrentAgent, listSessionMcpServers,
//   listSkills, getMode) and packs it into a Project shape. Caller persists.

import type {
  AgentInfo,
  AgentFileScope,
  ApplyProjectResult,
  Project,
  ProjectDefaults,
  SessionMode,
} from '../../rpc';
import { toErrorMessage } from '../shared/errorMessage';

/// Duck-type of the registry methods projectOps needs. Keeping this as an
/// interface (not importing SessionRegistry directly) lets tests inject a
/// simple stub without pulling in the whole sessions module.
export interface SessionOps {
  selectAgent(sessionId: string, name: string): Promise<AgentInfo>;
  deselectAgent(sessionId: string): Promise<boolean>;
  setSessionMcpEnabled(sessionId: string, serverName: string, enabled: boolean): Promise<boolean>;
  setSkillEnabled(sessionId: string, name: string, enabled: boolean): Promise<boolean>;
  setMode(sessionId: string, mode: SessionMode): Promise<SessionMode>;
  setApproveAll(sessionId: string, enabled: boolean): Promise<boolean>;
  setModel(sessionId: string, model: string, reasoningEffort: string | null): Promise<string>;
  getCurrentAgent(sessionId: string): Promise<AgentInfo | null>;
  listSessionMcpServers(
    sessionId: string,
  ): Promise<Array<{ name: string; status: string; source?: string; error?: string }>>;
  listSkills(sessionId: string): Promise<
    Array<{
      name: string;
      description: string;
      source: string;
      enabled: boolean;
      userInvocable: boolean;
      path?: string;
    }>
  >;
  getMode(sessionId: string): Promise<SessionMode>;
}

/// Apply a project's defaults to a live session. Returns `{ applied: true,
/// warnings }` — never throws. Per-op failures (missing server, unknown
/// agent, etc.) are collected as human-readable warnings.
export async function applyProjectToSession(
  sessions: SessionOps,
  project: Project,
  sessionId: string,
): Promise<ApplyProjectResult> {
  const warnings: string[] = [];
  const d = project.defaults;

  // Agent
  if (d.agentName !== undefined) {
    try {
      await sessions.selectAgent(sessionId, d.agentName);
    } catch (err) {
      warnings.push(`Could not select agent "${d.agentName}": ${toErrorMessage(err)}`);
    }
  }

  // MCP servers — force each listed server ON
  if (d.mcpEnabled && d.mcpEnabled.length > 0) {
    for (const serverName of d.mcpEnabled) {
      try {
        await sessions.setSessionMcpEnabled(sessionId, serverName, true);
      } catch (err) {
        warnings.push(`Could not enable MCP server "${serverName}": ${toErrorMessage(err)}`);
      }
    }
  }

  // Skills — force each listed skill OFF
  if (d.skillsDisabled && d.skillsDisabled.length > 0) {
    for (const skillName of d.skillsDisabled) {
      try {
        await sessions.setSkillEnabled(sessionId, skillName, false);
      } catch (err) {
        warnings.push(`Could not disable skill "${skillName}": ${toErrorMessage(err)}`);
      }
    }
  }

  // Run mode
  if (d.runMode !== undefined) {
    try {
      await sessions.setMode(sessionId, d.runMode);
    } catch (err) {
      warnings.push(`Could not set run mode "${d.runMode}": ${toErrorMessage(err)}`);
    }
  }

  // Model + reasoning effort (both present in SessionRegistry.setModel)
  if (d.modelId !== undefined && d.modelId !== '') {
    try {
      await sessions.setModel(sessionId, d.modelId, d.reasoningEffort ?? null);
    } catch (err) {
      warnings.push(`Could not set model "${d.modelId}": ${toErrorMessage(err)}`);
    }
  }

  // Approve-all (SessionRegistry.setApproveAll present)
  if (d.approveAll !== undefined) {
    try {
      await sessions.setApproveAll(sessionId, d.approveAll);
    } catch (err) {
      warnings.push(`Could not set approve-all: ${toErrorMessage(err)}`);
    }
  }

  return { applied: true, warnings };
}

/// Read a live session's current config and pack it into a Project value.
/// Caller is responsible for persisting (via ProjectService.save).
/// Best-effort: each reader is wrapped independently so a single SDK
/// failure doesn't abort the entire capture.
export async function captureProjectFromSession(
  sessions: SessionOps,
  sessionId: string,
  path: string,
  name?: string,
): Promise<Project> {
  const now = new Date().toISOString();
  const defaults: ProjectDefaults = {};

  // Agent
  try {
    const agent = await sessions.getCurrentAgent(sessionId);

    if (agent) {
      defaults.agentName = agent.name;

      if (agent.path) {
        defaults.agentScope = (
          agent.path.includes('.github/agents') || agent.path.includes('.github\\agents')
            ? 'project'
            : 'user'
        ) satisfies AgentFileScope;
      }
    }
  } catch {
    /* best-effort */
  }

  // MCP servers that are not disabled
  try {
    const servers = await sessions.listSessionMcpServers(sessionId);
    const enabled = servers
      .filter((s) => s.status !== 'disabled' && s.status !== 'error')
      .map((s) => s.name);

    if (enabled.length > 0) defaults.mcpEnabled = enabled;
  } catch {
    /* best-effort */
  }

  // Skills that are explicitly disabled
  try {
    const skills = await sessions.listSkills(sessionId);
    const disabled = skills.filter((s) => !s.enabled).map((s) => s.name);

    if (disabled.length > 0) defaults.skillsDisabled = disabled;
  } catch {
    /* best-effort */
  }

  // Run mode — omit if 'interactive' (that's the default; no delta needed)
  try {
    const mode = await sessions.getMode(sessionId);

    if (mode !== 'interactive') defaults.runMode = mode;
  } catch {
    /* best-effort */
  }

  return {
    path,
    ...(name !== undefined && name.trim() ? { name: name.trim() } : {}),
    defaults,
    createdAt: now,
    updatedAt: now,
  };
}
