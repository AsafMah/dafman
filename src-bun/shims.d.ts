// Stub declarations for Electrobun's optional 3D/GPU surfaces.
//
// Electrobun's main-process module re-exports `three`/`babylon` for
// WGPU helpers we don't use. Ambient stubs keep `vue-tsc -b` clean
// without pulling real `@types/three` / `@babylonjs/core`.
declare module 'three';
declare module '@babylonjs/core';
