import { readFileSync, existsSync } from "node:fs";
import { expect, it } from "vitest";
it("ships a placeholder configuration and no legacy sign-in code", () => {
  expect(existsSync("src/auth/github.ts")).toBe(false);
  expect(existsSync("src/auth/allowlist.ts")).toBe(false);
  expect(existsSync("wrangler.jsonc")).toBe(false);
  expect(readFileSync("wrangler.template.jsonc", "utf8")).toContain(
    "KV_NAMESPACE_ID",
  );
  expect(readFileSync("src/env.ts", "utf8")).not.toMatch(/GITHUB|MAILTO/);
});
