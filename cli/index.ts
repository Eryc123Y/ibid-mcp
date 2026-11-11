#!/usr/bin/env node
import { fetchVenueTables } from "./fetch-venues";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./commands";
import { prompt, runWrangler } from "./runtime";
import { runWatch } from "./watch/run";
const argv = process.argv.slice(2);
if (argv[0] === "watch") {
  // stdout carries only feed lines; every message goes to stderr. Never call process.exit here:
  // that could cut off buffered stdout when it is a pipe.
  process.exitCode = await runWatch(argv.slice(1), {
    fetch,
    env: process.env,
    readFile: (file) => readFile(file, "utf8"),
    // State (the JMLR ledger) is replaced atomically, so a concurrent run never reads half a file.
    writeFile: async (file, text) => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    },
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
} else {
  await runCli(argv, {
    fetchVenues: fetchVenueTables,
    dir: path.join(homedir(), ".config", "litscout"),
    bundlePath: fileURLToPath(new URL("../worker.js", import.meta.url)),
    run: runWrangler,
    prompt,
    fetch,
    print: console.log,
  }).catch(() => {
    // Never forward exception messages from upstream commands or prompts: they may contain secrets.
    console.error(
      "LitScout could not complete the command. Check the command, authentication and local configuration, then retry.",
    );
    process.exitCode = 1;
  });
}
