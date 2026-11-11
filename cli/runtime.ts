import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
/** Wrangler stdout is captured, never forwarded (secret upload errors may echo input). */
export function runWrangler(args: readonly string[]): Promise<string> {
  const require = createRequire(import.meta.url);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(
          path.dirname(require.resolve("wrangler/package.json")),
          "bin",
          "wrangler.js",
        ),
        ...args,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.resume();
    child.once("error", () => reject(new Error("Unable to start Wrangler")));
    child.once("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(
            new Error(
              `Wrangler ${args[0]} failed; check your local authentication and configuration.`,
            ),
          ),
    );
  });
}
export async function prompt(label: string, secret = false): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error("An interactive terminal is required for private prompts.");
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    process.stdout.write(`${label}: `);
    muted = secret;
    const answer = await rl.question("");
    muted = false;
    if (secret) process.stdout.write("\n");
    return answer;
  } finally {
    rl.close();
    output.destroy();
  }
}
