import { describe, expect, test, mock, beforeAll } from 'bun:test';
import { render, cleanup } from '@testing-library/vue';
import { h } from 'vue';

const renderedIds: string[] = [];

beforeAll(() => {
  mock.module('mermaid', () => ({
    default: {
      initialize: () => {},
      render: async (id: string) => {
        renderedIds.push(id);
        return { svg: `<svg id="${id}"></svg>` };
      },
    },
  }));
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('MermaidBlock', () => {
  test('two diagrams rendered in the same tick get distinct mermaid ids', async () => {
    renderedIds.length = 0;
    const MermaidBlock = (await import('@/components/shared/MermaidBlock.vue')).default;

    // Freeze the clock so both instances mount with the same Date.now() —
    // the worst case for id collision. Regression: localId used a per-instance
    // counter (always 1) + Date.now(), so two diagrams in one message produced
    // the SAME mermaid id and rendered into the same element.
    const realNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      // Mount both blocks inside ONE app (as in a real message with two
      // diagrams) — useId is app-scoped, so two separate render() calls would
      // each reset to the same id and not reflect production.
      const Wrapper = {
        render: () =>
          h('div', [
            h(MermaidBlock, { source: 'graph TD; A-->B' }),
            h(MermaidBlock, { source: 'graph TD; A-->B' }),
          ]),
      };
      render(Wrapper);
      await flush();
    } finally {
      Date.now = realNow;
    }

    expect(renderedIds.length).toBe(2);
    expect(renderedIds[0]).not.toBe(renderedIds[1]);
    cleanup();
  });
});
