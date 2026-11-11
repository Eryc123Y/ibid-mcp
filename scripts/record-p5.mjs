// Opt-in only. Never imported by tests or CI. All artifacts stay in this worktree.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
if (!process.argv.includes("--record")) {
  console.log(
    "Opt-in: node scripts/record-p5.mjs --record [--availability response.json]. Reads public APIs without keys; resumes .artifacts/p5/state.json. Requires python3 and the read-only reference measurement checkout. Budget <800 credits/day, including shared-IP usage; 600 searches alone cost 6000 credits, so collection needs multiple days.",
  );
} else {
  await mkdir(".artifacts/p5", { recursive: true });
  await build({
    entryPoints: ["eval/collect.ts"],
    outfile: ".artifacts/p5/collector.mjs",
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
  });
  const { collect } = await import(
    pathToFileURL(resolve(".artifacts/p5/collector.mjs")).href
  );
  const index = process.argv.indexOf("--availability");
  const availability =
    index < 0
      ? undefined
      : JSON.parse(await readFile(process.argv[index + 1], "utf8"));
  try {
    await collect(availability);
  } catch (error) {
    const report = {
      status: "unverified",
      reason: error.message,
      state: ".artifacts/p5/state.json",
    };
    await writeFile(
      ".artifacts/p5/collection-status.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.error(report.reason);
    process.exitCode = 2;
  }
}
