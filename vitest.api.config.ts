import { defineConfig } from "vitest/config";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/api/index.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          APP_ENV: "development",
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
        d1Databases: ["DB", "RESTORED_DB"],
        r2Buckets: ["ATTACHMENTS", "BACKUPS", "RESTORED_ATTACHMENTS"],
      },
    })),
  ],
  test: { include: ["tests/api/**/*.test.ts"], testTimeout: 30000 },
});
