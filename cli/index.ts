#!/usr/bin/env node
import { fetchVenueTables } from "./fetch-venues";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./commands";
import { prompt, runWrangler } from "./runtime";
import { runWatch } from "./watch/run";
import { runAbstracts } from "./abstracts/run";
import { InputError, MAX_BYTES } from "./abstracts/input";

/** All of stdin as UTF-8; stops reading (and fails) past `limit` bytes. */
async function readStdin(limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > limit)
      throw new InputError(`input is larger than ${limit} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const argv = process.argv.slice(2);
if (argv[0] === "abstracts") {
  // Same rules as watch: stdout carries only result lines, and no process.exit.
  process.exitCode = await runAbstracts(argv.slice(1), {
    fetch,
    env: process.env,
    readStdin: () => readStdin(MAX_BYTES),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
} else if (argv[0] === "watch") {
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
      try {
        await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
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
