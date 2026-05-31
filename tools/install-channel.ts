#!/usr/bin/env bun
// tools/install-channel.ts — install (and launch) an already-built dafman
// bundle for a non-dev build channel, so it can run ALONGSIDE `bun run dev`.
//
// Why this exists: two dafman instances on the SAME build channel share one
// WebView2 user-data folder + dafman's JSON state and crash the webview —
// that's what the single-instance guard (src-bun/app/shared/singleInstance.ts)
// blocks. Electrobun keys userData + the WebView2 folder on the build channel
// (dev/canary/stable), so a *different* channel coexists cleanly.
//
// The `electrobun build --env=canary` output is a PACKAGED bundle: a
// self-extracting Setup stub (`dafman-Setup-<channel>.exe`) plus a sibling
// `.tar.zst`. It is NOT runnable in place (no extracted launcher tree); you
// run the Setup stub, which installs + launches the channel app. This script
// just locates and runs that Setup artifact.
//
// Usage: `bun tools/install-channel.ts [canary|stable]` (default canary).
// Build first: `bun run build:canary` (or `bun run install:canary`, which
// builds then runs this).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type Channel = 'canary' | 'stable';

const APP_NAME = 'dafman';
const BUILD_FOLDER = 'build';

function archToken(): string {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function osToken(): 'win' | 'macos' | 'linux' {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'macos';

  return 'linux';
}

function suffix(channel: Channel): string {
  // Electrobun suffixes every non-stable artifact with the channel.
  return channel === 'stable' ? '' : `-${channel}`;
}

function resolveInstaller(channel: Channel): { command: string; args: string[]; artifact: string } {
  const os = osToken();
  const bundleDir = join(BUILD_FOLDER, `${channel}-${os}-${archToken()}`);

  if (os === 'win') {
    const setup = join(bundleDir, `${APP_NAME}-Setup${suffix(channel)}.exe`);

    return { command: setup, args: [], artifact: setup };
  }

  if (os === 'macos') {
    const dmg = join(bundleDir, `${APP_NAME}${suffix(channel)}.dmg`);

    return { command: 'open', args: [dmg], artifact: dmg };
  }

  // Linux: artifact format varies; surface the folder for a manual install.
  return { command: '', args: [], artifact: bundleDir };
}

const channelArg = (process.argv[2] ?? 'canary') as Channel;

if (!['canary', 'stable'].includes(channelArg)) {
  console.error(`Unknown channel "${channelArg}". Use one of: canary, stable.`);
  process.exit(1);
}

const { command, args, artifact } = resolveInstaller(channelArg);

if (!existsSync(artifact)) {
  console.error(
    `No ${channelArg} build found at ${artifact}.\n` +
      `Build it first: bun run build${channelArg === 'canary' ? ':canary' : ''}`,
  );
  process.exit(1);
}

if (osToken() === 'linux' || command === '') {
  console.log(
    `Built ${channelArg} artifacts are in ${artifact}. Install them with your ` +
      'platform installer, then launch alongside `bun run dev`.',
  );
  process.exit(0);
}

console.log(`Running ${channelArg} installer: ${command}`);

const child = spawn(command, args, { detached: true, stdio: 'ignore' });

child.on('error', (err) => {
  console.error(`Failed to run ${channelArg} installer:`, err.message);
  process.exit(1);
});

child.unref();
