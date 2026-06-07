import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, type Component } from 'vue';

const PathChipStub = defineComponent({
  name: 'PathChip',
  props: { path: { type: String, required: true } },
  template: '<span data-testid="path-chip">{{ path }}</span>',
});

const CommandBlockStub = defineComponent({
  name: 'CommandBlock',
  props: {
    code: { type: String, required: true },
    lang: { type: String, default: 'text' },
    filename: { type: String, default: '' },
  },
  template:
    '<pre data-testid="command-block" :data-lang="lang" :data-filename="filename">{{ code }}</pre>',
});

const DiffEditorStub = defineComponent({
  name: 'DiffEditor',
  props: {
    oldText: { type: String, required: true },
    newText: { type: String, required: true },
    filename: { type: String, default: '' },
    language: { type: String, default: 'text' },
  },
  template:
    '<section data-testid="diff-editor" :data-old="oldText" :data-new="newText" :data-filename="filename" />',
});

mock.module('@/components/details/PathChip.vue', () => ({ default: PathChipStub }));
mock.module('@/components/details/CommandBlock.vue', () => ({ default: CommandBlockStub }));
mock.module('@/components/details/DiffEditor.vue', () => ({ default: DiffEditorStub }));
mock.module('@/components/details/UrlChip.vue', () => ({
  default: defineComponent({ template: '<span />' }),
}));
mock.module('@/components/details/ToolChip.vue', () => ({
  default: defineComponent({ template: '<span />' }),
}));
mock.module('@/components/details/ApplyPatchView.vue', () => ({
  default: defineComponent({ template: '<section data-testid="apply-patch" />' }),
}));
mock.module('@/components/details/GrepResults.vue', () => ({
  default: defineComponent({ template: '<span />' }),
}));
mock.module('@/components/details/GlobResults.vue', () => ({
  default: defineComponent({ template: '<span />' }),
}));

let ToolDetails: Component;

function mountToolDetails(props: Record<string, unknown>) {
  return render(ToolDetails, { props });
}

describe('ToolDetails tool rendering', () => {
  beforeAll(async () => {
    ToolDetails = (await import('@/components/permissions/ToolDetails.vue')).default as Component;
  });

  afterEach(() => {
    cleanup();
  });

  test('create renders file_text as file-language code instead of JSON arguments', () => {
    const { container, queryByTestId } = mountToolDetails({
      toolName: 'create',
      args: { path: 'src/example.ts', file_text: 'export const answer = 42;\n' },
      resultContent: '{"ok":true}',
    });

    const blocks = container.querySelectorAll('[data-testid="command-block"]');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.textContent).toContain('export const answer = 42;');
    expect(blocks[0]?.getAttribute('data-lang')).toBe('typescript');
    expect(blocks[0]?.getAttribute('data-filename')).toBe('src/example.ts');
    expect(blocks[0]?.textContent).not.toContain('file_text');
    expect(queryByTestId('arguments-preview')).toBeNull();
  });

  test('create keeps an empty file_text as the rendered file content', () => {
    const { container } = mountToolDetails({
      toolName: 'create_file',
      args: { path: 'empty.md', file_text: '' },
      resultContent: 'created empty.md',
    });

    const blocks = container.querySelectorAll('[data-testid="command-block"]');
    expect(blocks).toHaveLength(0);
    expect(container.querySelector('.tool-empty')?.textContent?.trim()).toBe('Empty file');
    expect(container.querySelector('[data-testid="path-chip"]')?.textContent).toBe('empty.md');
  });

  test('edit-family tools render a single args diff and suppress duplicate raw/result blocks', () => {
    const { container, queryByTestId } = mountToolDetails({
      toolName: 'str_replace_editor',
      args: { path: 'src/example.ts', old_str: 'const answer = 1;', new_str: 'const answer = 42;' },
      resultContent:
        'diff --git a/src/example.ts b/src/example.ts\n-const answer = 1;\n+const answer = 42;',
    });

    const diff = queryByTestId('diff-editor');
    expect(diff).not.toBeNull();
    expect(diff?.getAttribute('data-old')).toBe('const answer = 1;');
    expect(diff?.getAttribute('data-new')).toBe('const answer = 42;');
    expect(container.querySelectorAll('[data-testid="command-block"]')).toHaveLength(0);
    expect(queryByTestId('arguments-preview')).toBeNull();
  });

  test('edit-family tools still render delete-all edits with an empty new_str', () => {
    const { queryByTestId } = mountToolDetails({
      toolName: 'edit_file',
      args: { path: 'src/example.ts', old_str: 'const answer = 1;', new_str: '' },
      resultContent: 'updated',
    });

    const diff = queryByTestId('diff-editor');
    expect(diff).not.toBeNull();
    expect(diff?.getAttribute('data-old')).toBe('const answer = 1;');
    expect(diff?.getAttribute('data-new')).toBe('');
  });
});
