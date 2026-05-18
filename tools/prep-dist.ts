// Ensure dist/ exists before `electrobun dev --watch` starts watching it.
// In HMR mode (`bun run dev:hmr`), Vite serves the renderer from
// http://localhost:5173, so dist/index.html only needs to be a stub that
// redirects there. A real `vite build` will overwrite these placeholders.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/assets", { recursive: true });

if (!existsSync("dist/index.html")) {
	writeFileSync(
		"dist/index.html",
		`<!doctype html><meta http-equiv="refresh" content="0; url=http://localhost:5173/">`,
	);
}
