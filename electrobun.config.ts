import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "dafman",
		identifier: "com.dafman.app",
		version: "0.1.0",
	},
	build: {
		// Bun 1.3.13's Windows baseline binary exposes `Bun.Terminal` but
		// rejects `Bun.spawn(..., { terminal })` with "terminal option is not
		// supported on this platform". 1.3.14 fixes the ConPTY path, which
		// Dafman's terminal panes require.
		bunVersion: "1.3.14",
		bun: {
			entrypoint: "src-bun/index.ts",
		},
		// Vite builds the Vue app into dist/; we copy it into the bundled
		// views/mainview/ tree so that `views://mainview/index.html` resolves
		// at runtime.
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
} satisfies ElectrobunConfig;
