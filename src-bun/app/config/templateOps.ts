// applyTemplate + captureTemplate — session config template apply/capture.
//
// Standalone module imported by both src-bun/index.ts and
// src-bun/test-server.ts so the logic is not duplicated. The session
// registry is passed as a duck-typed interface to keep this module
// decoupled from SessionRegistry directly (same pattern as SessionMetadataPersistence).

import type { AgentInfo, ApplyTemplateResult, SessionMode, SessionTemplate } from '../../rpc';
import type { TemplateService } from './templateService';
import { AppError } from '../shared/errors';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';

/// Minimal duck-type for the session registry operations used by
/// applyTemplate and captureTemplate.
export interface SessionOps {
  selectAgent(sessionId: string, name: string): Promise<AgentInfo>;
  deselectAgent(sessionId: string): Promise<boolean>;
  setSessionMcpEnabled(sessionId: string, serverName: string, enabled: boolean): Promise<boolean>;
  setSkillEnabled(sessionId: string, name: string, enabled: boolean): Promise<boolean>;
  setMode(sessionId: string, mode: SessionMode): Promise<SessionMode>;
  getCurrentAgent(sessionId: string): Promise<AgentInfo | null>;
  listSkills(sessionId: string): Promise<
    Array<{
      name: string;
      enabled: boolean;
      description: string;
      source: string;
      userInvocable: boolean;
      path?: string;
    }>
  >;
  listSessionMcpServers(
    sessionId: string,
  ): Promise<Array<{ name: string; status: string; source?: string; error?: string }>>;
  getMode(sessionId: string): Promise<SessionMode>;
}

/// Apply a stored template to a running session.
///
/// Sequence: selectAgent/deselectAgent → setSessionMcpEnabled(true) per server
/// → setSkillEnabled(false) per disabled skill → setMode if runMode set.
///
/// Per-op errors for missing servers/skills are collected into warnings and
/// never re-thrown — the session remains open regardless of partial failures.
/// Throws AppError.settings only when the template id does not exist.
export async function applyTemplate(
  sessionId: string,
  templateId: string,
  templateService: TemplateService,
  sessions: SessionOps,
): Promise<ApplyTemplateResult> {
  const template = templateService.list().find((t) => t.id === templateId);

  if (!template) throw AppError.settings(`template not found: ${templateId}`);

  const warnings: string[] = [];

  // 1. Agent selection / deselection
  if (template.agentName) {
    try {
      await sessions.selectAgent(sessionId, template.agentName);
    } catch (err) {
      const msg = `Agent "${template.agentName}" not found: ${toErrorMessage(err)}`;

      warnings.push(msg);
      log.warn('applyTemplate: selectAgent failed', {
        sessionId,
        agentName: template.agentName,
        error: toErrorMessage(err),
      });
    }
  } else {
    try {
      await sessions.deselectAgent(sessionId);
    } catch (err) {
      // deselect failing is not a user-visible warning — just log
      log.warn('applyTemplate: deselectAgent failed', {
        sessionId,
        error: toErrorMessage(err),
      });
    }
  }

  // 2. MCP servers — enable each listed server; warn on any that fail
  for (const serverName of template.mcpEnabled) {
    try {
      await sessions.setSessionMcpEnabled(sessionId, serverName, true);
    } catch (err) {
      const msg = `MCP server "${serverName}" could not be enabled: ${toErrorMessage(err)}`;

      warnings.push(msg);
      log.warn('applyTemplate: setSessionMcpEnabled failed', {
        sessionId,
        serverName,
        error: toErrorMessage(err),
      });
    }
  }

  // 3. Skills — disable each listed skill; warn on any that fail
  for (const skillName of template.skillsDisabled) {
    try {
      await sessions.setSkillEnabled(sessionId, skillName, false);
    } catch (err) {
      const msg = `Skill "${skillName}" could not be disabled: ${toErrorMessage(err)}`;

      warnings.push(msg);
      log.warn('applyTemplate: setSkillEnabled failed', {
        sessionId,
        skillName,
        error: toErrorMessage(err),
      });
    }
  }

  // 4. Run mode
  if (template.runMode) {
    try {
      await sessions.setMode(sessionId, template.runMode);
    } catch (err) {
      const msg = `Run mode "${template.runMode}" could not be set: ${toErrorMessage(err)}`;

      warnings.push(msg);
      log.warn('applyTemplate: setMode failed', {
        sessionId,
        runMode: template.runMode,
        error: toErrorMessage(err),
      });
    }
  }

  return { applied: true, warnings };
}

/// Capture the current session configuration as a new named template.
///
/// Reads: current agent (getCurrentAgent), skills (listSkills),
/// MCP servers (listSessionMcpServers), run mode (getMode).
/// Saves to templateService and returns the saved template.
///
/// MCP enabled: servers whose status is NOT 'stopped', 'error', or 'disabled'.
/// Skills disabled: skills where enabled === false.
/// runMode: omitted from template when 'interactive' (the default).
export async function captureTemplate(
  sessionId: string,
  name: string,
  templateService: TemplateService,
  sessions: SessionOps,
): Promise<SessionTemplate> {
  const [agent, skills, mcpServers, mode] = await Promise.all([
    sessions.getCurrentAgent(sessionId),
    sessions.listSkills(sessionId),
    sessions.listSessionMcpServers(sessionId),
    sessions.getMode(sessionId),
  ]);

  // Derive agent scope from path: project agents live under .github/agents/
  const agentScope: string | undefined = agent?.path
    ? agent.path.replace(/\\/g, '/').includes('.github/agents/')
      ? 'project'
      : 'user'
    : undefined;

  // Enabled MCP: exclude servers in stopped/error/disabled states
  const mcpEnabled = mcpServers
    .filter((s) => s.status !== 'stopped' && s.status !== 'error' && s.status !== 'disabled')
    .map((s) => s.name);

  // Disabled skills (user explicitly turned them off in this session)
  const skillsDisabled = skills.filter((s) => !s.enabled).map((s) => s.name);

  const now = new Date().toISOString();
  const template: SessionTemplate = {
    id: crypto.randomUUID(),
    name,
    ...(agent
      ? {
          agentName: agent.name,
          ...(agentScope ? { agentScope } : {}),
        }
      : {}),
    mcpEnabled,
    skillsDisabled,
    // Omit runMode when interactive to keep the template minimal
    ...(mode !== 'interactive' ? { runMode: mode } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await templateService.save(template);

  return template;
}
