// Stub declarations for Electrobun's optional 3D/GPU surfaces.
//
// Electrobun's main-process module re-exports a `three`/`babylon`
// namespace; the actual packages aren't part of our app, but vue-tsc
// follows the import chain anyway. These ambient declarations satisfy
// the compiler without pulling real `@types/three`/`@babylonjs/core`.
declare module 'three';
declare module '@babylonjs/core';

// markdown-it plugins that ship without @types. All four follow
// markdown-it's PluginWithOptions / PluginSimple contract.
declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it';

  const plugin: PluginWithOptions<{
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }>;

  export default plugin;
}

declare module 'markdown-it-deflist' {
  import type { PluginSimple } from 'markdown-it';

  const plugin: PluginSimple;

  export default plugin;
}

declare module 'markdown-it-texmath' {
  import type { PluginWithOptions } from 'markdown-it';

  interface TexmathOptions {
    engine: unknown;
    delimiters?: 'dollars' | 'brackets' | 'gitlab' | 'julia' | 'kramdown' | 'beg_end';
    katexOptions?: Record<string, unknown>;
  }
  const plugin: PluginWithOptions<TexmathOptions>;

  export default plugin;
}
