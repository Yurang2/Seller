import { build } from "esbuild";
import { build as buildClient } from "vite";
await buildClient({ configFile: "vite.desktop.config.ts" });
await build({ entryPoints: { main: "electron/main.ts", preload: "electron/preload.ts" }, bundle: true, platform: "node", format: "cjs", target: "node22", outdir: "dist/desktop", outExtension: { ".js": ".cjs" }, external: ["electron", "better-sqlite3"], sourcemap: true });
