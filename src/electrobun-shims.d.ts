// Stub declarations for Electrobun's optional 3D/GPU surfaces.
//
// Electrobun's main-process module re-exports a `three`/`babylon`
// namespace; the actual packages aren't part of our app, but vue-tsc
// follows the import chain anyway. These ambient declarations satisfy
// the compiler without pulling real `@types/three`/`@babylonjs/core`.
declare module "three";
declare module "@babylonjs/core";

// markdown-it-task-lists ships no @types. The plugin signature matches
// markdown-it's PluginWithOptions contract.
declare module "markdown-it-task-lists" {
  import type { PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions<{
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }>;
  export default plugin;
}
