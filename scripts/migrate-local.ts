import { loadEnv } from "vite";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const wrangler = join(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const local = loadEnv("development", process.cwd(), "SELLER_");
const args = ["d1", "migrations", "apply", "seller-db", "--local"];
if (local.SELLER_LOCAL_STATE_DIR)
  args.push("--persist-to", local.SELLER_LOCAL_STATE_DIR);
const child = spawnSync(process.execPath, [wrangler, ...args], {
  stdio: "inherit",
  windowsHide: true,
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
