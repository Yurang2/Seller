import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  resolve: { alias: {
    "cloudflare:workers": resolve("tests/platform/api-bindings.ts"),
    "cloudflare:test": resolve("tests/platform/api-bindings.ts"),
  } },
  test: { include: ["tests/api/**/*.test.ts", "tests/platform/**/*.test.ts"], environment: "node", testTimeout: 30000 },
});
