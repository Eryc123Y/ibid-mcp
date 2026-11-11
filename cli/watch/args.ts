/** `litscout watch` arguments. */

import { WatchError, type VenueKind } from "./watchlist";

export interface WatchArgs {
  readonly since: string;
  readonly until?: string;
  readonly venues: string;
  readonly kinds: readonly VenueKind[];
}

export const USAGE =
  "usage: litscout watch --since YYYY-MM-DD --venues <file> [--kinds journal,conference] [--until YYYY-MM-DD]";
const FLAGS = ["--since", "--until", "--venues", "--kinds"] as const;

function day(flag: string, value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new WatchError(`${flag} must be a date YYYY-MM-DD`);
  return value;
}

function pairs(argv: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (!(FLAGS as readonly string[]).includes(flag))
      throw new WatchError(`unknown argument ${flag.slice(0, 40)}; ${USAGE}`);
    const value = eq > 0 ? arg.slice(eq + 1) : argv[(i += 1)];
    if (value === undefined || value === "")
      throw new WatchError(`${flag} needs a value`);
    if (values.has(flag)) throw new WatchError(`${flag} given twice`);
    values.set(flag, value);
  }
  return values;
}

export function parseArgs(argv: readonly string[]): WatchArgs {
  const values = pairs(argv);
  const since = values.get("--since");
  const venues = values.get("--venues");
  if (!since || !venues)
    throw new WatchError(`--since and --venues are required; ${USAGE}`);
  const until = values.has("--until")
    ? day("--until", values.get("--until")!)
    : undefined;
  if (until && until < day("--since", since))
    throw new WatchError("--until is before --since");
  const kinds = (values.get("--kinds") ?? "journal")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (!kinds.length || kinds.some((k) => k !== "journal" && k !== "conference"))
    throw new WatchError("--kinds takes journal, conference or both");
  return {
    since: day("--since", since),
    until,
    venues,
    kinds: [...new Set(kinds)] as VenueKind[],
  };
}
