import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Unit tests run in Node; the Durable Object base class is stubbed.
      "cloudflare:workers": fileURLToPath(new URL("./test/stubs/cloudflare-workers.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    coverage: { provider: "v8", include: ["src/**/*.ts", "cli/**/*.ts"], reporter: ["text", "json-summary", "html"], thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 } },
  },
});
