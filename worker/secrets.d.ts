// Secrets set with `npx wrangler secret put <NAME>` (never in the repo, never in wrangler.jsonc). Optional: every
// route that needs one answers a labelled 501/503 when it is absent.
interface Env {
  /** Turnstile widget secret for POST /api/replays (12-01). Unset => saving is not enabled (503 not_configured). */
  readonly TURNSTILE_SECRET?: string;
  /** Analytics Engine SQL API token for GET /api/insight (12-06, stretch). */
  readonly AE_SQL_TOKEN?: string;
}
