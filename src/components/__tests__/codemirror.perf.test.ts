/// Perf benchmarks for the CodeMirror surface. Not run on every
/// `bun test` (timing tests are flaky in CI); invoke directly:
///
///     bun test src/components/__tests__/codemirror.perf.ts
///
/// Numbers are wall-clock on the dev machine — relative comparisons
/// matter more than absolute values.

import { describe, expect, test, beforeEach } from "bun:test";
import { render, cleanup } from "@testing-library/vue";
import { setActivePinia, createPinia } from "pinia";
import { nextTick, h } from "vue";
import PrimeVue from "primevue/config";
import CodeEditor from "../CodeEditor.vue";
import DiffEditor from "../details/DiffEditor.vue";
import MessageContent from "../MessageContent.vue";
import { renderMarkdown, renderMarkdownSegments } from "../../lib/markdown";

const SAMPLE_TS = `import { computed, ref } from "vue";
import { EditorView } from "@codemirror/view";

interface Props {
  modelValue: string;
  language?: string;
}

export function useCounter(initial = 0) {
  const count = ref(initial);
  const double = computed(() => count.value * 2);
  return { count, double, increment: () => count.value++ };
}

// A larger paragraph of code to exercise tokenization
const sample = Array.from({ length: 50 }, (_, i) =>
  \`function fn\${i}() { return \${i} * 2; }\`,
).join("\\n");
`;

const SAMPLE_TS_NEW = SAMPLE_TS.replace(
  "function fn0() { return 0 * 2; }",
  "function fn0() { return 0 * 4; }",
).replace(
  "function fn1() { return 1 * 2; }",
  "function fn1() { return 1 * 4; } // changed",
);

async function mountTimed<T extends () => unknown>(factory: T): Promise<number> {
  const t0 = performance.now();
  factory();
  await nextTick();
  await nextTick();
  return performance.now() - t0;
}

describe("perf: CodeEditor", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("mount with TypeScript syntax highlighting", async () => {
    const ms = await mountTimed(() =>
      render(
        {
          setup: () => () =>
            h(CodeEditor, {
              modelValue: SAMPLE_TS,
              language: "typescript",
              readonly: true,
            }),
        },
        { global: { plugins: [PrimeVue] } },
      ),
    );
    console.log(`  CodeEditor mount (TS, ~${SAMPLE_TS.length}B): ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(500); // generous ceiling
    cleanup();
  });

  test("mount with no language (plain text fast path)", async () => {
    const ms = await mountTimed(() =>
      render(
        {
          setup: () => () =>
            h(CodeEditor, {
              modelValue: SAMPLE_TS,
              readonly: true,
            }),
        },
        { global: { plugins: [PrimeVue] } },
      ),
    );
    console.log(`  CodeEditor mount (plain): ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(500);
    cleanup();
  });
});

describe("perf: DiffEditor", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("mount inline (unifiedMergeView)", async () => {
    const ms = await mountTimed(() =>
      render(
        {
          setup: () => () =>
            h(DiffEditor, {
              oldText: SAMPLE_TS,
              newText: SAMPLE_TS_NEW,
              filename: "sample.ts",
              initialMode: "inline",
            }),
        },
        { global: { plugins: [PrimeVue] } },
      ),
    );
    console.log(`  DiffEditor inline mount (TS): ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(500);
    cleanup();
  });

  test("mount side-by-side (MergeView)", async () => {
    const ms = await mountTimed(() =>
      render(
        {
          setup: () => () =>
            h(DiffEditor, {
              oldText: SAMPLE_TS,
              newText: SAMPLE_TS_NEW,
              filename: "sample.ts",
              initialMode: "side-by-side",
            }),
        },
        { global: { plugins: [PrimeVue] } },
      ),
    );
    console.log(`  DiffEditor side-by-side mount (TS): ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(500);
    cleanup();
  });
});

describe("perf: markdown rendering", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const STREAMING_DOC= `# A long response

Here's some intro text with **bold** and \`inline code\` and a [link](https://example.com).

\`\`\`typescript
${SAMPLE_TS}
\`\`\`

And a follow-up paragraph. Some more prose. Then another code block:

\`\`\`python
def fib(n):
    if n < 2: return n
    return fib(n - 1) + fib(n - 2)
print([fib(i) for i in range(10)])
\`\`\`

End of message.`;

  test("renderMarkdown (old v-html path)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) renderMarkdown(STREAMING_DOC);
    const ms = (performance.now() - t0) / 50;
    console.log(`  renderMarkdown avg over 50 calls: ${ms.toFixed(2)}ms`);
    expect(ms).toBeLessThan(50);
  });

  test("renderMarkdownSegments (new segment path)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) renderMarkdownSegments(STREAMING_DOC);
    const ms = (performance.now() - t0) / 50;
    console.log(`  renderMarkdownSegments avg over 50 calls: ${ms.toFixed(2)}ms`);
    expect(ms).toBeLessThan(50);
  });

  test("MessageContent full mount", async () => {
    const ms = await mountTimed(() =>
      render(
        {
          setup: () => () =>
            h(MessageContent, { text: STREAMING_DOC }),
        },
        { global: { plugins: [PrimeVue] } },
      ),
    );
    console.log(`  MessageContent mount (2 code blocks + prose): ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(1000);
    cleanup();
  });
});

describe("perf: streaming simulation", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("incremental MessageContent updates (50 chunks)", async () => {
    let doc = "Loading...\n\n\`\`\`typescript\n";
    const tail = SAMPLE_TS;
    const chunkSize = Math.ceil(tail.length / 50);

    const { rerender } = render(
      {
        props: ["text"],
        setup: (props: { text: string }) => () =>
          h(MessageContent, { text: props.text }),
      },
      {
        props: { text: doc + "\n```" },
        global: { plugins: [PrimeVue] },
      },
    );
    await nextTick();
    await nextTick();

    const t0 = performance.now();
    for (let i = 0; i < 50; i++) {
      doc += tail.slice(i * chunkSize, (i + 1) * chunkSize);
      await rerender({ text: doc + "\n```" });
    }
    await nextTick();
    const total = performance.now() - t0;
    console.log(
      `  50 streaming chunks: ${total.toFixed(0)}ms total (${(total / 50).toFixed(1)}ms/chunk)`,
    );
    expect(total).toBeLessThan(5000);
    cleanup();
  });
});
