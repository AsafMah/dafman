import { describe, expect, test, afterEach } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/vue';
import { defineComponent } from 'vue';
import SubagentBlock from '@/components/chat/SubagentBlock.vue';
import type { ChatItem } from '@/lib/chatEvents';

const childStubs = {
  ToolCallBlock: defineComponent({
    name: 'ToolCallBlock',
    template: '<button type="button" class="stub-tool-control">Tool inner control</button>',
  }),
  MessageContent: defineComponent({
    name: 'MessageContent',
    template: '<a href="https://example.com" class="stub-message-link">Message link</a>',
  }),
  ReasoningBlock: defineComponent({
    name: 'ReasoningBlock',
    template:
      '<button type="button" class="stub-reasoning-control">Reasoning inner control</button>',
  }),
};

function renderBlock(overrides: Partial<InstanceType<typeof SubagentBlock>['$props']> = {}) {
  return render(SubagentBlock, {
    props: {
      agentId: 'agent-1',
      agentName: 'research-agent',
      displayName: 'Researcher',
      description: 'Checks the codebase',
      status: 'completed',
      items: [],
      reasoningVisibility: 'expanded',
      ...overrides,
    },
    global: {
      stubs: childStubs,
    },
  });
}

describe('SubagentBlock', () => {
  afterEach(() => cleanup());

  test('clicking the header chrome and bottom affordance toggles expansion', async () => {
    renderBlock();

    const header = screen.getByRole('button', { name: 'Toggle sub-agent Researcher' });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.hasAttribute('aria-controls')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Collapse sub-agent Researcher' })).toBeNull();

    await fireEvent.click(header);

    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.getAttribute('aria-controls')).toBe('subagent-body-agent-1');
    const footer = screen.getByRole('button', { name: 'Collapse sub-agent Researcher' });
    expect(footer.getAttribute('aria-expanded')).toBe('true');
    expect(footer.getAttribute('aria-controls')).toBe('subagent-body-agent-1');

    await fireEvent.click(footer);

    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.hasAttribute('aria-controls')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Collapse sub-agent Researcher' })).toBeNull();
  });

  test('clicking inner interactive content does not toggle the sub-agent card', async () => {
    const items: ChatItem[] = [
      {
        id: 1,
        kind: 'tool',
        toolCallId: 'tool-1',
        toolName: 'shell',
        status: 'running',
        partialOutput: '',
      },
    ];
    renderBlock({ status: 'running', items });

    const header = screen.getByRole('button', { name: 'Toggle sub-agent Researcher' });
    expect(header.getAttribute('aria-expanded')).toBe('true');

    await fireEvent.click(screen.getByRole('button', { name: 'Tool inner control' }));

    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tool inner control' })).toBeTruthy();
  });
});
