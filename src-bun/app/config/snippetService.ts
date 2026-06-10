// Snippet persistence service.
//
// Stores user-created prompt snippets in `<userData>/snippets.json`.
// Pattern mirrors SessionMetadataStore: load synchronously at startup,
// persist async via atomicWrite with a serialised write-chain to avoid
// interleaved partial writes.
//
// Validation:
//   - body max 10 000 chars (throws AppError.settings on overflow)
//   - id is auto-generated (crypto.randomUUID) if absent on save
//   - createdAt/updatedAt are stamped on every save

import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Snippet } from '../../rpc';
import { AppError } from '../shared/errors';
import { atomicWrite } from '../shared/atomicWrite';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';

export const SNIPPET_STORE_VERSION = 1;
const BODY_MAX_CHARS = 10_000;

interface SnippetFile {
  version: number;
  snippets: Snippet[];
}

export class SnippetService {
  /// Serialises writes so concurrent save/delete calls cannot interleave
  /// a half-written file.
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly data: SnippetFile,
  ) {}

  static loadOrDefault(path: string): SnippetService {
    const empty: SnippetFile = { version: SNIPPET_STORE_VERSION, snippets: [] };

    if (!existsSync(path)) return new SnippetService(path, empty);

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;

      return new SnippetService(path, SnippetService.coerce(parsed));
    } catch (err) {
      log.warn('snippet store load failed; starting empty', {
        path,
        error: toErrorMessage(err),
      });

      return new SnippetService(path, empty);
    }
  }

  private static coerce(input: unknown): SnippetFile {
    const out: SnippetFile = { version: SNIPPET_STORE_VERSION, snippets: [] };

    if (!input || typeof input !== 'object') return out;

    const raw = input as { version?: unknown; snippets?: unknown };
    const snippets = raw.snippets;

    if (!Array.isArray(snippets)) return out;

    for (const item of snippets) {
      const s = SnippetService.coerceSnippet(item);

      if (s !== null) out.snippets.push(s);
    }

    return out;
  }

  private static coerceSnippet(raw: unknown): Snippet | null {
    if (!raw || typeof raw !== 'object') return null;

    const r = raw as Record<string, unknown>;

    if (typeof r.id !== 'string' || !r.id) return null;
    if (typeof r.title !== 'string') return null;
    if (typeof r.body !== 'string') return null;
    if (typeof r.createdAt !== 'string') return null;
    if (typeof r.updatedAt !== 'string') return null;

    const tags = Array.isArray(r.tags)
      ? (r.tags as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];

    return {
      id: r.id,
      title: r.title,
      body: r.body,
      tags,
      ...(typeof r.shortcut === 'string' && r.shortcut ? { shortcut: r.shortcut } : {}),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  list(): Snippet[] {
    // Return a shallow copy so callers can't mutate internal state.
    return [...this.data.snippets];
  }

  async save(snippet: Snippet): Promise<void> {
    if (snippet.body.length > BODY_MAX_CHARS) {
      throw AppError.settings(
        `snippet body exceeds ${BODY_MAX_CHARS.toLocaleString()} character limit`,
      );
    }

    const now = new Date().toISOString();
    const id = snippet.id || crypto.randomUUID();
    const idx = this.data.snippets.findIndex((s) => s.id === id);

    const next: Snippet = {
      ...snippet,
      id,
      updatedAt: now,
      createdAt: snippet.createdAt || now,
    };

    if (idx >= 0) {
      this.data.snippets[idx] = next;
    } else {
      this.data.snippets.push(next);
    }

    this.persist();

    // Await the in-flight write so the caller can observe completion.
    await this.writeChain;
  }

  async delete(id: string): Promise<void> {
    const idx = this.data.snippets.findIndex((s) => s.id === id);

    if (idx < 0) return;

    this.data.snippets.splice(idx, 1);
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
        log.warn('snippet store persist failed', {
          path: this.path,
          error: toErrorMessage(err),
        });
      });
  }
}
