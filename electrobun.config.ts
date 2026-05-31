import type { ElectrobunConfig } from 'electrobun';
import { existsSync } from 'node:fs';

// The Copilot SDK needs a CLI runtime to spawn. In `bun run dev` the SDK
// resolves the prebuilt native binary from node_modules at runtime; but a
// PACKAGED build has no node_modules, so we must bundle the binary INTO the
// app and resolve it bundle-relative (see src-bun/app/client/client.ts).
//
// `electrobun.config.ts` is evaluated at build time on the BUILDING machine,
// so `process.platform`/`process.arch` here are the target's (host == target;
// no cross-compile in our CI matrix). Each CI runner installs only its own
// `@github/copilot-<plat>-<arch>` optional dep, so this source exists per-OS.
const nativeBinName = process.platform === 'win32' ? 'copilot.exe' : 'copilot';
const nativePkg = `@github/copilot-${process.platform}-${process.arch}`;
const nativeBinSrc = `node_modules/${nativePkg}/${nativeBinName}`;

// Electrobun's copy step only logs-and-continues when a source is missing
// (node_modules/electrobun/src/cli/index.ts), so a missing binary would
// silently ship a build whose SDK can't start. Fail the build loudly instead.
if (!existsSync(nativeBinSrc)) {
  throw new Error(
    `Cannot bundle the Copilot CLI: ${nativeBinSrc} is missing. ` +
      `Install the platform optional dep (\`bun install\`) for ${nativePkg}.`,
  );
}

export default {
  app: {
    name: 'dafman',
    identifier: 'com.dafman.app',
    version: '0.1.0',
  },
  build: {
    // Bun 1.3.13's Windows baseline binary exposes `Bun.Terminal` but
    // rejects `Bun.spawn(..., { terminal })` with "terminal option is not
    // supported on this platform". 1.3.14 fixes the ConPTY path, which
    // Dafman's terminal panes require.
    bunVersion: '1.3.14',
    bun: {
      entrypoint: 'src-bun/index.ts',
    },
    // Vite builds the Vue app into dist/; we copy it into the bundled
    // views/mainview/ tree so that `views://mainview/index.html` resolves
    // at runtime. The Copilot native binary is copied next to the bundled
    // bun entry (`Resources/app/bun/`) so client.ts can resolve it via
    // `import.meta.dir` when node_modules isn't present (packaged mode).
    copy: {
      'dist/index.html': 'views/mainview/index.html',
      'dist/assets': 'views/mainview/assets',
      [nativeBinSrc]: `bun/${nativeBinName}`,
    },
    watchIgnore: ['dist/**'],
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
