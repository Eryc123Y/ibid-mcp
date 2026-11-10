import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
export interface LocalState {
  token: string;
  consentSecret?: string;
  name: string;
  namespaceId?: string;
  endpoint?: string;
}
export async function secureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}
export async function privateJson(file: string, data: unknown): Promise<void> {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, file);
}
export async function readState(dir: string): Promise<LocalState> {
  try {
    return JSON.parse(
      await readFile(path.join(dir, "state.json"), "utf8"),
    ) as LocalState;
  } catch {
    throw new Error("No deployment state. Run litscout deploy first.");
  }
}
