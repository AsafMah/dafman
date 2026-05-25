/// Group + sort `ModelSummary[]` into a tree suitable for PrimeVue's
/// `TreeSelect`. Rules (matching the user-facing taxonomy):
///
///   - "Auto" pinned to the top, ungrouped.
///   - Provider = first whitespace-separated token of `name` (or the
///     prefix before `-` for GPT-style names like "GPT-5.5").
///   - For Claude, an extra "type" level groups by capability tier:
///       Opus > Sonnet > Haiku. Anything else falls through under
///       provider directly.
///   - Leaf labels keep the full model name, even inside provider/type
///     groups, so the closed picker never collapses to an ambiguous
///     version like "5.5".
///   - Versions sort descending so the newest is on top.
///
/// The function is deterministic and pure: no Date.now(), no Math.random.
/// All comparisons are case-insensitive on the provider/type words but
/// the original `name` is preserved verbatim in the leaf label so e.g.
/// "(1M context)" suffixes stay visible.

import type { ModelSummary } from '../ipc/types';

export interface ModelTreeLeaf {
  key: string;
  label: string;
  /// The model id; consumed by the TreeSelect v-model handler.
  data: string;
  /// The full ModelSummary, so callers don't have to look it up again
  /// (e.g. to read `supportsReasoningEffort` after a selection change).
  model: ModelSummary;
}

export interface ModelTreeGroup {
  key: string;
  label: string;
  children: (ModelTreeGroup | ModelTreeLeaf)[];
  /// PrimeVue Tree uses `selectable: false` to mark a node as a
  /// header-only row that can't be the selection. Group rows aren't
  /// selectable — only leaves are.
  selectable: false;
}

export type ModelTreeNode = ModelTreeGroup | ModelTreeLeaf;

const CLAUDE_TYPE_ORDER = ['opus', 'sonnet', 'haiku'];

function isAuto(name: string): boolean {
  return name.trim().toLowerCase() === 'auto';
}

function providerOf(name: string): string {
  const trimmed = name.trim();
  // "GPT-5.5", "GPT-5.3-Codex" — split on the first dash.
  if (/^gpt[-\s]/i.test(trimmed)) return 'GPT';
  // "Claude Sonnet 4.6", "Claude Opus 4.7 (1M context)".
  const firstWord = trimmed.split(/\s+/)[0];
  return firstWord ?? trimmed;
}

/// Returns "Opus" | "Sonnet" | "Haiku" for Claude models, "" for
/// everything else. Case preserved as-rendered for the group label.
function claudeType(name: string): string {
  const m = name.trim().match(/^claude\s+(\S+)/i);
  if (!m) return '';
  const word = m[1].toLowerCase();
  if (word === 'opus') return 'Opus';
  if (word === 'sonnet') return 'Sonnet';
  if (word === 'haiku') return 'Haiku';
  return '';
}

/// Natural-order comparator on version-ish strings: splits on
/// non-alphanumerics and compares numeric runs as numbers so "4.10"
/// sorts after "4.9". Returns DESC order (newest first) — flip the
/// result if you want ASC.
function compareVersionDesc(a: string, b: string): number {
  const ax = a.split(/[^0-9a-z]+/i).filter(Boolean);
  const bx = b.split(/[^0-9a-z]+/i).filter(Boolean);
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const ai = ax[i] ?? '';
    const bi = bx[i] ?? '';
    const an = Number(ai);
    const bn = Number(bi);
    if (!Number.isNaN(an) && !Number.isNaN(bn) && ai !== '' && bi !== '') {
      if (an !== bn) return bn - an;
    } else {
      const cmp = ai.localeCompare(bi, undefined, { sensitivity: 'base' });
      if (cmp !== 0) return -cmp;
    }
  }
  return 0;
}

export function buildModelTree(models: ModelSummary[]): ModelTreeNode[] {
  const auto: ModelTreeLeaf[] = [];
  /// providerKey → typeKey | "" → leaves
  const buckets = new Map<string, Map<string, ModelTreeLeaf[]>>();
  const providerLabel = new Map<string, string>();
  const typeLabel = new Map<string, string>();

  for (const m of models) {
    if (isAuto(m.name)) {
      auto.push({ key: m.id, label: m.name, data: m.id, model: m });
      continue;
    }
    const provider = providerOf(m.name);
    const providerKey = provider.toLowerCase();
    providerLabel.set(providerKey, provider);
    const type = providerKey === 'claude' ? claudeType(m.name) : '';
    const typeKey = type.toLowerCase();
    if (type) typeLabel.set(`${providerKey}::${typeKey}`, type);
    const provBucket = buckets.get(providerKey) ?? new Map();
    const typeBucket = provBucket.get(typeKey) ?? [];
    typeBucket.push({
      key: m.id,
      label: m.name,
      data: m.id,
      model: m,
    });
    provBucket.set(typeKey, typeBucket);
    buckets.set(providerKey, provBucket);
  }

  const out: ModelTreeNode[] = [];
  out.push(...auto);

  // Providers sorted alphabetically EXCEPT Claude and GPT come first
  // in that order (matches the user's stated priority).
  const providers = [...buckets.keys()].sort((a, b) => {
    const rank = (k: string) => (k === 'claude' ? 0 : k === 'gpt' ? 1 : 2);
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  for (const provKey of providers) {
    const provBucket = buckets.get(provKey)!;
    const provLabel = providerLabel.get(provKey) ?? provKey;
    const providerChildren: (ModelTreeGroup | ModelTreeLeaf)[] = [];

    // Types in this provider — Claude uses Opus > Sonnet > Haiku
    // order; everything else alphabetical. Untyped leaves ("")
    // are flattened into the provider directly.
    const types = [...provBucket.keys()];
    types.sort((a, b) => {
      if (provKey === 'claude') {
        const ia = CLAUDE_TYPE_ORDER.indexOf(a);
        const ib = CLAUDE_TYPE_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      return a.localeCompare(b);
    });

    for (const typeKey of types) {
      const leaves = provBucket.get(typeKey)!;
      leaves.sort((a, b) => compareVersionDesc(a.label, b.label));
      if (typeKey === '') {
        providerChildren.push(...leaves);
      } else {
        providerChildren.push({
          key: `${provKey}::${typeKey}`,
          label: typeLabel.get(`${provKey}::${typeKey}`) ?? typeKey,
          children: leaves,
          selectable: false,
        });
      }
    }

    out.push({
      key: provKey,
      label: provLabel,
      children: providerChildren,
      selectable: false,
    });
  }

  return out;
}

/// Walks the tree to find the leaf path keys leading to `modelId`.
/// Used to expand the tree to the current selection when the popup
/// opens. Returns an empty object if the id isn't in the tree.
export function expandKeysForModel(
  tree: ModelTreeNode[],
  modelId: string,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  function visit(nodes: ModelTreeNode[], ancestors: string[]): boolean {
    for (const n of nodes) {
      if ('data' in n && n.data === modelId) {
        for (const a of ancestors) out[a] = true;
        return true;
      }
      if ('children' in n) {
        if (visit(n.children, [...ancestors, n.key])) return true;
      }
    }
    return false;
  }
  visit(tree, []);
  return out;
}
