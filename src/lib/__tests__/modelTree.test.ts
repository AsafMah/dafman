import { describe, expect, it } from 'bun:test';
import {
  buildModelTree,
  expandKeysForModel,
  type ModelTreeGroup,
  type ModelTreeLeaf,
  type ModelTreeNode,
} from '../modelTree';
import type { ModelSummary } from '../../ipc/types';

function model(id: string, name: string): ModelSummary {
  return {
    id,
    name,
    supportsReasoningEffort: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  };
}

function isGroup(n: ModelTreeNode): n is ModelTreeGroup {
  return (n as ModelTreeGroup).children !== undefined;
}
function isLeaf(n: ModelTreeNode): n is ModelTreeLeaf {
  return (n as ModelTreeLeaf).data !== undefined;
}

describe('buildModelTree', () => {
  it('pins Auto at the top, ungrouped', () => {
    const tree = buildModelTree([
      model('claude-opus-4.7', 'Claude Opus 4.7'),
      model('auto', 'Auto'),
    ]);
    expect(isLeaf(tree[0])).toBe(true);
    expect((tree[0] as ModelTreeLeaf).label).toBe('Auto');
  });

  it('groups Claude by type (Opus > Sonnet > Haiku) and version DESC', () => {
    const tree = buildModelTree([
      model('claude-sonnet-4.5', 'Claude Sonnet 4.5'),
      model('claude-haiku-4.5', 'Claude Haiku 4.5'),
      model('claude-opus-4.6', 'Claude Opus 4.6'),
      model('claude-opus-4.7', 'Claude Opus 4.7'),
    ]);
    const claude = tree.find((n) => isGroup(n) && n.label === 'Claude') as ModelTreeGroup;
    expect(claude).toBeDefined();
    const types = claude.children.map((c) => (c as ModelTreeGroup).label);
    expect(types).toEqual(['Opus', 'Sonnet', 'Haiku']);
    const opus = claude.children[0] as ModelTreeGroup;
    const opusVersions = opus.children.map((l) => (l as ModelTreeLeaf).label);
    expect(opusVersions).toEqual(['Claude Opus 4.7', 'Claude Opus 4.6']);
  });

  it('flattens GPT under its provider (no type level), preserving full names', () => {
    const tree = buildModelTree([
      model('gpt-5.5', 'GPT-5.5'),
      model('gpt-5.3-codex', 'GPT-5.3-Codex'),
      model('gpt-4.1', 'GPT-4.1'),
    ]);
    const gpt = tree.find((n) => isGroup(n) && n.label === 'GPT') as ModelTreeGroup;
    expect(gpt.children.every(isLeaf)).toBe(true);
    const labels = gpt.children.map((l) => (l as ModelTreeLeaf).label);
    expect(labels[0]).toBe('GPT-5.5');
    expect(labels[labels.length - 1]).toBe('GPT-4.1');
  });

  it('preserves parenthetical suffixes in the full leaf label', () => {
    const tree = buildModelTree([model('claude-opus-4.7-1m', 'Claude Opus 4.7 (1M context)')]);
    const claude = tree[0] as ModelTreeGroup;
    const opus = claude.children[0] as ModelTreeGroup;
    expect((opus.children[0] as ModelTreeLeaf).label).toBe('Claude Opus 4.7 (1M context)');
  });

  it('Claude before GPT regardless of input order', () => {
    const tree = buildModelTree([
      model('gpt-5.5', 'GPT-5.5'),
      model('claude-opus-4.7', 'Claude Opus 4.7'),
    ]);
    const labels = tree.filter(isGroup).map((g) => g.label);
    expect(labels).toEqual(['Claude', 'GPT']);
  });

  it('expandKeysForModel returns the ancestor chain for a leaf', () => {
    const tree = buildModelTree([
      model('claude-opus-4.7', 'Claude Opus 4.7'),
      model('gpt-5.5', 'GPT-5.5'),
    ]);
    const keys = expandKeysForModel(tree, 'claude-opus-4.7');
    expect(keys.claude).toBe(true);
    expect(keys['claude::opus']).toBe(true);
  });
});
