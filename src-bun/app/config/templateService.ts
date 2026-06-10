// Session template persistence service.
//
// Stores named session config templates in `<userData>/session-templates.json`.
// Pattern mirrors SnippetService: load synchronously at startup, persist async
// via atomicWrite with a serialised write-chain to avoid interleaved partial writes.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionTemplate } from '../../rpc';
import { atomicWrite } from '../shared/atomicWrite';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';

export const TEMPLATE_STORE_VERSION = 1;

const VALID_RUN_MODES: ReadonlyArray<string> = ['interactive', 'plan', 'autopilot'];

interface TemplateFile {
  version: number;
  templates: SessionTemplate[];
}

export class TemplateService {
  /// Serialises writes so concurrent save/delete calls cannot interleave
  /// a half-written file.
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly data: TemplateFile,
  ) {}

  static loadOrDefault(path: string): TemplateService {
    const empty: TemplateFile = { version: TEMPLATE_STORE_VERSION, templates: [] };

    if (!existsSync(path)) return new TemplateService(path, empty);

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;

      return new TemplateService(path, TemplateService.coerce(parsed));
    } catch (err) {
      log.warn('template store load failed; starting empty', {
        path,
        error: toErrorMessage(err),
      });

      return new TemplateService(path, empty);
    }
  }

  private static coerce(input: unknown): TemplateFile {
    const out: TemplateFile = { version: TEMPLATE_STORE_VERSION, templates: [] };

    if (!input || typeof input !== 'object') return out;

    const raw = input as { version?: unknown; templates?: unknown };
    const templates = raw.templates;

    if (!Array.isArray(templates)) return out;

    for (const item of templates) {
      const t = TemplateService.coerceTemplate(item);

      if (t !== null) out.templates.push(t);
    }

    return out;
  }

  private static coerceTemplate(raw: unknown): SessionTemplate | null {
    if (!raw || typeof raw !== 'object') return null;

    const r = raw as Record<string, unknown>;

    if (typeof r.id !== 'string' || !r.id) return null;

    if (typeof r.name !== 'string') return null;

    if (typeof r.createdAt !== 'string') return null;

    if (typeof r.updatedAt !== 'string') return null;

    const mcpEnabled = Array.isArray(r.mcpEnabled)
      ? (r.mcpEnabled as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    const skillsDisabled = Array.isArray(r.skillsDisabled)
      ? (r.skillsDisabled as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    const result: SessionTemplate = {
      id: r.id,
      name: r.name,
      mcpEnabled,
      skillsDisabled,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };

    if (typeof r.agentName === 'string' && r.agentName) result.agentName = r.agentName;

    if (typeof r.agentScope === 'string' && r.agentScope) result.agentScope = r.agentScope;

    if (VALID_RUN_MODES.includes(r.runMode as string)) {
      result.runMode = r.runMode as SessionTemplate['runMode'];
    }

    return result;
  }

  list(): SessionTemplate[] {
    return [...this.data.templates];
  }

  async save(template: SessionTemplate): Promise<void> {
    const now = new Date().toISOString();
    const id = template.id || crypto.randomUUID();
    const idx = this.data.templates.findIndex((t) => t.id === id);

    const next: SessionTemplate = {
      ...template,
      id,
      updatedAt: now,
      createdAt: template.createdAt || now,
    };

    if (idx >= 0) {
      this.data.templates[idx] = next;
    } else {
      this.data.templates.push(next);
    }

    this.persist();
    await this.writeChain;
  }

  async delete(id: string): Promise<void> {
    const idx = this.data.templates.findIndex((t) => t.id === id);

    if (idx < 0) return;

    this.data.templates.splice(idx, 1);
    this.persist();
    await this.writeChain;
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.data, null, 2);

    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await atomicWrite(this.path, snapshot);
      })
      .catch((err) => {
        log.warn('template store persist failed', {
          path: this.path,
          error: toErrorMessage(err),
        });
      });
  }
}
