import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig(({ mode }) => {
  const local = loadEnv(mode, process.cwd(), "SELLER_");
  return {
    plugins: [
      react(),
      tailwindcss(),
      cloudflare({
        persistState: local.SELLER_LOCAL_STATE_DIR
          ? { path: local.SELLER_LOCAL_STATE_DIR }
          : true,
      }),
    ],
  };
});
