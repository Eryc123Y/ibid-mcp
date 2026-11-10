/** Minimal stand-in for the workerd DurableObject base class in Node unit tests. */
export class DurableObject<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}
