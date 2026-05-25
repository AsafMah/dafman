/// Minimal `.vue` SFC shim for `tsconfig.bun.json` — lets `bun test`
/// fixtures like `tools/__tests__/Counter.vue` typecheck cleanly even
/// though the renderer's vite-env.d.ts isn't included in this project.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;

  export default component;
}
