import type { VenueTable } from "../src/sources/venue";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import template from "./worker-template.json" with { type: "json" };
import { privateJson, readState, secureDir, type LocalState } from "./state";
export interface CliDeps {
  fetchVenues: () => Promise<VenueTable>;
  dir: string;
  bundlePath: string;
  run: (args: readonly string[]) => Promise<string>;
  prompt: (label: string, secret?: boolean) => Promise<string>;
  fetch: typeof fetch;
  print: (text: string) => void;
}
const commands = [
  "deploy",
  "pair",
  "clients",
  "revoke",
  "status",
  "keys",
  "destroy",
];
const keys = ["S2_API_KEY", "OPENALEX_API_KEY", "CORE_API_KEY"] as const;
async function sourceKeys(deps: CliDeps): Promise<Record<string, string>> {
  const entries = await keys.reduce(
    async (previous, key) => {
      const values = await previous;
      const value = (await deps.prompt(`${key} (blank to skip)`, true)).trim();
      return value ? [...values, [key, value] as const] : values;
    },
    Promise.resolve([] as Array<readonly [string, string]>),
  );
  return Object.fromEntries(entries);
}
function configPath(deps: CliDeps): string {
  return path.join(deps.dir, "wrangler.jsonc");
}
async function writeConfig(deps: CliDeps, state: LocalState): Promise<void> {
  await privateJson(configPath(deps), {
    ...template,
    name: state.name,
    main: deps.bundlePath,
    vars: { PUBLIC_URL: state.endpoint ?? "https://not-configured.invalid" },
    kv_namespaces: [{ binding: "OAUTH_KV", id: state.namespaceId }],
  });
}
async function upload(
  deps: CliDeps,
  secrets: Record<string, string>,
): Promise<void> {
  if (!Object.keys(secrets).length) return;
  const directory = await mkdtemp(path.join(deps.dir, "secrets-"));
  const file = path.join(directory, "secrets.json");
  try {
    await privateJson(file, secrets);
    await deps.run(["secret", "bulk", file, "--config", configPath(deps)]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function deploy(deps: CliDeps): Promise<void> {
  await secureDir(deps.dir);
  try {
    const output = await deps.run(["whoami"]);
    if (/not (?:logged|authenticated)/i.test(output))
      throw new Error("Not authenticated");
  } catch {
    await deps.run(["login"]);
    await deps.run(["whoami"]);
  }
  let state: LocalState;
  try {
    state = await readState(deps.dir);
  } catch {
    const name =
      (await deps.prompt("Worker name (litscout)")).trim() || "litscout";
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(name))
      throw new Error("Invalid Worker name");
    state = {
      name,
      token: crypto.randomUUID() + crypto.randomUUID(),
      consentSecret: crypto.randomUUID() + crypto.randomUUID(),
    };
    await privateJson(path.join(deps.dir, "state.json"), state);
  }
  if (!state.namespaceId) {
    const result = await deps.run([
      "kv",
      "namespace",
      "create",
      `${state.name}-oauth`,
    ]);
    const namespaceId = result.match(/"id"\s*:\s*"([\w-]+)"/)?.[1];
    if (!namespaceId)
      throw new Error("Wrangler did not return a KV namespace id");
    state = { ...state, namespaceId };
    await privateJson(path.join(deps.dir, "state.json"), state);
  }
  await writeConfig(deps, state);
  try {
    const table = await deps.fetchVenues();
    const file = path.join(deps.dir, "venues.json");
    await privateJson(file, table);
    await deps.run([
      "kv",
      "key",
      "put",
      "litscout:venues",
      "--path",
      file,
      "--namespace-id",
      state.namespaceId!,
      "--remote",
    ]);
  } catch {
    deps.print(
      "Venue tables could not be downloaded or uploaded. Search remains available; rerun deploy to retry.",
    );
  }
  // Keep source keys only in the short-lived private upload file.
  await upload(deps, {
    ...(await sourceKeys(deps)),
    MGMT_TOKEN: state.token,
    ...(state.consentSecret ? { CONSENT_SECRET: state.consentSecret } : {}),
  });
  const output = await deps.run(["deploy", "--config", configPath(deps)]);
  const endpoint =
    [...output.matchAll(/(?:^|\n)\s*(https:\/\/[^\s"'<>]+)\s*(?=\n|$)/g)]
      .at(-1)?.[1]
      ?.replace(/\/$/, "") ?? state.endpoint;
  if (!endpoint)
    throw new Error("Deployment URL missing; local state preserved for retry.");
  state = { ...state, endpoint };
  await writeConfig(deps, state);
  // Bind OAuth issuer/resource to the actual public endpoint returned by Wrangler.
  await deps.run(["deploy", "--config", configPath(deps)]);
  await privateJson(path.join(deps.dir, "state.json"), {
    ...state,
    consentSecret: undefined,
  });
  deps.print(`Deployed: ${endpoint}/mcp\nNext: litscout pair`);
}
async function admin(
  deps: CliDeps,
  state: LocalState,
  command: string,
  id?: string,
): Promise<void> {
  if (!state.endpoint)
    throw new Error("Deployment incomplete; run litscout deploy again.");
  const response = await deps.fetch(`${state.endpoint}/admin/${command}`, {
    method: ["pair", "revoke"].includes(command) ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${state.token}`,
      "content-type": "application/json",
    },
    body: id ? JSON.stringify({ id }) : undefined,
  });
  if (!response.ok)
    throw new Error(`Management request failed (HTTP ${response.status})`);
  const data = (await response.json()) as { code?: string };
  deps.print(
    command === "pair"
      ? `Connector: ${state.endpoint}/mcp\nPairing code: ${data.code}\nExpires in 10 minutes.`
      : JSON.stringify(data, null, 2),
  );
}
export async function runCli(
  args: readonly string[],
  deps: CliDeps,
): Promise<void> {
  const [command, id, ...extra] = args;
  if (!command || ["help", "--help", "-h"].includes(command)) {
    deps.print(
      `LitScout: ${commands.join(", ")}\nKeys are entered privately, never as arguments.`,
    );
    return;
  }
  if (!commands.includes(command))
    throw new Error("Unknown command; use --help");
  if (extra.length || (id && command !== "revoke"))
    throw new Error("Unexpected arguments; enter keys at the private prompt");
  if (command === "deploy") return deploy(deps);
  const state = await readState(deps.dir);
  if (command === "keys") {
    await upload(deps, await sourceKeys(deps));
    deps.print("Source keys updated.");
    return;
  }
  if (command === "destroy") {
    if (
      (await deps.prompt("Delete this Worker and its OAuth KV? Type yes")) !==
      "yes"
    ) {
      deps.print("Cancelled.");
      return;
    }
    await deps.run(["delete", "--config", configPath(deps), "--force"]);
    if (state.namespaceId)
      await deps.run([
        "kv",
        "namespace",
        "delete",
        "--namespace-id",
        state.namespaceId,
      ]);
    await rm(path.join(deps.dir, "state.json"));
    await rm(configPath(deps), { force: true });
    deps.print("Deployment removed.");
    return;
  }
  if (command === "revoke" && !id)
    throw new Error("Client id required: litscout revoke <id>");
  await admin(deps, state, command, id);
}
