/** Node shim for the workerd-only module 'cloudflare:workers' (aliased in vitest.config.ts). Only what worker/ imports. */
export class DurableObject<Env = unknown> {
  constructor(
    protected readonly ctx: unknown,
    protected readonly env: Env,
  ) {}
}
