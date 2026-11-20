// The worker program type-checks contracts/net.ts -> store.ts -> app.ts, which names the client-only HTMLElement.
// Workers runtime types have no DOM, so declare an opaque stand-in (never used at runtime by worker code).
interface HTMLElement {}
