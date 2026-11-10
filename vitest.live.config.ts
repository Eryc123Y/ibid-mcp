import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Live, read-only checks against OpenAlex (and S2 when S2_API_KEY is set). Not part of `npm test`. */
export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
    },
  },
  test: { include: ["test/live/**/*.live.ts"], environment: "node", testTimeout: 120_000, silent: false },
});
