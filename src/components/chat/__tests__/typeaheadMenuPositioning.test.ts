import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

function readComponent(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('composer typeahead menu positioning', () => {
  test('does not override lexical-vue collision placement with a vertical transform', () => {
    const mentionPlugin = readComponent('src/components/chat/MentionPlugin.vue');
    const slashPlugin = readComponent('src/components/chat/SlashCommandPlugin.vue');

    expect(mentionPlugin).not.toContain('translateY(calc(-100%');
    expect(slashPlugin).not.toContain('translateY(calc(-100%');
    expect(mentionPlugin).not.toContain(':to="anchorElementRef"');
    expect(slashPlugin).not.toContain(':to="anchorElementRef"');
  });
});
