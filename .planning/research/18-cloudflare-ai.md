# 18 - Cloudflare AI stack for an "AI Race Engineer" (research, 2026-11-20)

Sources: developers.cloudflare.com (read via the `/index.md` mirror of each page, plus the per-model `sync-input.json` schemas), raw GitHub files, the npm registry, and `ai@7.0.178` type definitions unpacked locally. I could NOT call Workers AI (no credentials), so latency and live tool-call streaming behaviour are UNVERIFIED. Everything marked "verified" was read on the page.

## 0. TL;DR verdict

**BUILD the minimal version, STRETCH the rest.**
- Minimal version: one stateless Worker endpoint, `POST /api/engineer`. It takes the user question plus a telemetry snapshot, streams a 1-3 sentence grounded answer over SSE, and emits whitelisted tool calls that the browser executes against the Three.js app.
- Model: `@cf/google/gemma-4-26b-a4b-it` (verified: function calling, reasoning, vision, 256k context, `response_format`, free-tier eligible, $0.10 / $0.30 per M tokens). Fallback `@cf/zai-org/glm-4.7-flash`.
- Grounding: curated per-suspension "fact cards" injected into the system prompt, with NO RAG. Vectorize and AI Search are not worth it for ~20 pages.
- Abuse protection: Turnstile once per session, the Rate Limiting binding, `max_completion_tokens`, and AI Gateway rate and spend limits.
- Voice: use browser `speechSynthesis` by default. Workers AI TTS costs about 5-10x more than the LLM answer it narrates.
- Skip for v1: Agents SDK / Durable Objects, Vectorize, AI Search, realtime voice input.

## 1. Platform changes since early 2026 that affect the plan (verified)

1. **Deprecations dated 11/20/2026 (today):** `@cf/moonshotai/kimi-k2.6`, `kimi-k2.7-code`, `@cf/zai-org/glm-5.3-flash`, `@cf/nvidia/nemotron-3-120b-a12b`, `@cf/myshell-ai/melotts`. The agents-starter repo still uses `kimi-k2.7-code`, so do not copy that model id.
2. **Docs say `workers-ai-provider` is deprecated.** The replacement is `createAI` from `agents/models/ai-sdk`, which needs `ai@^7` and `@ai-sdk/provider@^4`.
   - npm still publishes `workers-ai-provider@4.0.1` as `latest` with no registry-level deprecation flag. The `cloudflare/ai` README still lists it as a package.
   - `createAI` always routes through AI Gateway (default gateway id `default`, auto-created on the first authenticated request).
   - It also supports `fallback: [...]`, `cacheTtl`, `cacheKey`, `metadata`, `sessionAffinity`, `reasoningEffort` and `chatTemplateKwargs`.
3. **AI Search (formerly AutoRAG) billing starts 2026-12-01.**
   - Included monthly: 1,000 semantic queries, 1,000 full-text queries, 5M ingestion tokens, 10 GB-month of storage.
   - Beyond that: $0.75 per 1,000 semantic/hybrid queries, $0.10 per 1,000 full-text queries, $0.75 per M ingestion tokens.
   - 1,000 free queries per month is far too few for a public demo.
4. **Agents SDK has been reorganised.**
   - `agents` is at 0.34.0 on npm (MIT); the starter pins `^0.17.4`. Current docs push `Lifecycle`, the Pi harness, and `Think` (`@cloudflare/think` 0.24.0), with `AIChatAgent` (`@cloudflare/ai-chat` 0.12.3) still present.
   - Voice now ships inside `agents/voice` (beta) from `agents` 0.23.0. `@cloudflare/voice` is deprecated.
   - The API is moving fast, so pin versions if you use it.
5. **Workers AI text-generation rate limit:** 300 requests/min per model, per account. Models that require Workers Paid get 20 requests/min (50 with prepaid AI Gateway credits). Local `wrangler dev` calls count, and the `ai` binding always runs remotely, which needs a login.
6. **AI Gateway logs:** accounts that created their first gateway before 2026-09-24 use Legacy Logs (100k logs total on Free, 10M per gateway on Paid). Newer accounts use Workers Logs.

## 2. Workers AI model catalogue (verified from model pages; neuron prices from the pricing page)

Pricing is $0.011 per 1,000 neurons. The **free allocation is 10,000 neurons/day**, resetting at 00:00 UTC. "Paid" means Workers Paid or prepaid gateway credits are required.

| Model id | Context | Tools | Reasoning | $/M in / out | Neurons/M in / out | Notes |
|---|---|---|---|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | 256,000 | yes | yes | 0.10 / 0.30 | 9,091 / 27,273 | Vision, batch, `chat_template_kwargs.enable_thinking`, `response_format` json_object/json_schema. MoE with ~4B active (name-implied), so expect fast. **Pick.** |
| `@cf/zai-org/glm-4.7-flash` | 131,072 | yes (multi-turn) | yes | 0.0605 / 0.40 | 5,500 / 36,400 | Cheapest input. Good fallback. |
| `@cf/openai/gpt-oss-120b` | 128,000 | yes | low/med/high | 0.35 / 0.75 | 31,818 / 68,182 | Quality option, slower. |
| `@cf/openai/gpt-oss-20b` | 128,000 | yes | yes | 0.20 / 0.30 | 18,182 / 27,273 | |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 131,000 | yes | no | 0.27 / 0.85 | 24,545 / 77,273 | Vision. |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | **24,000** | yes | no | 0.293 / 2.253 | 26,668 / 204,805 | Output is expensive, context small. |
| `@cf/qwen/qwen3.8-27b` | 262,144 | yes | yes | 0.45 / 3.20 | 40,909 / 290,909 | Output is expensive. |
| `@cf/ibm-granite/granite-4.0-h-micro` | 131,000 | yes | no | 0.017 / 0.112 | 1,542 / 10,158 | Cheapest, weakest. |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 128,000 | yes | no | 0.351 / 0.555 | 31,876 / 50,488 | |
| `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | 1,048,576 | yes | yes | 0.30 / 1.20 | 27,273 / 109,091 | Paid only. |
| `@cf/thinkingmachines/inkling-2-small` | 1,048,576 | yes | yes | 0.30 / 1.00 | 27,273 / 90,909 | Paid only. |
| `@cf/zai-org/glm-5.3` | 1,048,576 | yes | yes | 1.40 / 4.40 | 127,273 / 400,000 | Paid only. Overkill. |

Notes:
- Streaming: every model above takes `stream: true` and returns `text/event-stream`.
- JSON mode: the JSON-mode feature page lists only older models (llama-3.3-70b, llama-3.x-8b, hermes-2-pro, deepseek-r1-distill) and says it does NOT support streaming. The gemma-4 input schema does list `response_format` (`text`, `json_object`, `json_schema`). Treat JSON mode as non-streaming and use tool calls for structured actions instead.
- Output chunk format for the glm/gemma family is OpenAI chat-completions style (verified in `sync-output.json`: `choices[].message.tool_calls[] = {id, type:"function", function:{name, arguments:"<json string>"}}`, `finish_reason` includes `tool_calls`). I have not seen a live streamed tool-call chunk. Going through the AI SDK (section 5) avoids parsing it by hand.
- **Latency/speed: no official tokens/sec figure is published on the pages I read.** Treat any speed claim as UNVERIFIED and measure time-to-first-token yourself (AI Gateway logs show duration per request).
- **Always set `chat_template_kwargs: { enable_thinking: false }`** (via `createAI` option `chatTemplateKwargs`) or `reasoningEffort: null`. Otherwise reasoning tokens are billed as output and delay the first visible token.

### Speech and embeddings (verified)

| Task | Model id | Price | Notes |
|---|---|---|---|
| TTS | `@cf/deepgram/aura-2-en` | $0.03 / 1k chars (2,727 neurons/1k chars) | Real-time capable, 40 speakers (default `luna`), output MP3 / wav / opus / etc. |
| TTS | `@cf/deepgram/aura-1` | 1,364 neurons / 1k chars | Default for `agents/voice` `WorkersAITTS`. |
| TTS | `@cf/myshell-ai/melotts` | 18.6 neurons / audio min | **DEPRECATED 2026-11-20.** |
| STT | `@cf/openai/whisper-large-v3-turbo` | 46.6 neurons / audio min | Batch (push-to-talk). |
| STT | `@cf/deepgram/nova-3` | 473 neurons/min (HTTP), 836/min (WS) | |
| STT | `@cf/deepgram/flux` | $0.0077 / min, WebSocket only | Built for voice agents, end-of-turn events. Not usable via the AI SDK `transcribe`. |
| Embeddings | `@cf/baai/bge-base-en-v1.5` (768-d) | 6,058 neurons/M tokens | Others: `bge-small-en-v1.5`, `bge-m3`, `qwen3-embedding-0.6b`, `embeddinggemma-2`. |

## 3. Cost per interaction (my arithmetic from the verified prices; assumes reasoning is OFF)

Assumptions: system prompt with fact cards about 3,500 tokens, tools 500, telemetry 250, history 250, so about 4.5k input tokens. Output is about 100 tokens (1-3 sentences plus a tool call).

| Model | Neurons/question | $/1,000 questions | Free questions/day (10k neurons) |
|---|---|---|---|
| gemma-4-26b-a4b-it | ~41 in + ~2.7 out = **~44** | ~$0.48 | **~225** |
| glm-4.7-flash | ~25 + ~3.6 = ~29 | ~$0.31 | ~340 |
| gpt-oss-120b | ~143 + ~6.8 = ~150 | ~$1.65 | ~66 |

- If you inject all 20 pages (about 16k tokens), gemma-4 input rises to about 145 neurons per question, giving about 68 free questions/day. That is another reason to curate rather than paste.
- `sessionAffinity` routes a session to one replica for prefix caching. Cached-input rates exist on some models; the gemma/glm pages list none.
- **TTS costs far more than the LLM:** a 150-character narration is about 409 neurons on aura-2-en or about 205 on aura-1, versus about 44 for the answer. On the free tier that is about 24 aura-2 answers/day. Use browser `speechSynthesis`, or pre-render stock lines to static MP3s.

## 4. Grounding: curated prompt vs RAG (Vectorize / AI Search)

**Recommendation: curated "fact cards" in the system prompt, selected deterministically by suspension type. Do not use RAG for ~20 pages.**

Why:
- 20 pages is roughly 12-16k tokens, which fits easily in a 128k-256k window. But sending all of it costs about 145 neurons per question and dilutes the answer. Condense it to about 3k tokens of fact cards: one `common` card plus one card per suspension type (MacPherson, double wishbone, multi-link). The Worker adds only the active type's card, so the prompt stays small and stable (better prefix caching).
- RAG adds an embedding call, a vector query and more moving parts (about +100-400 ms, unmeasured), and a retriever can return the wrong chunk.
- AI Search is billed from 2026-12-01 with only 1,000 free queries/month. Vectorize has a free tier (30M queried and 5M stored dimensions/month on Free) and is cheap, but you would also have to build chunking and an ingestion script.
- The real hallucination risk is NUMBERS: camber at this section, roll angle, load. Those come from telemetry, not from a knowledge base. Mitigations:
  - the client sends computed values from its own kinematics solver;
  - the system prompt forbids quoting any number not in `TELEMETRY`;
  - give the model a precomputed `event` label (e.g. "mid-corner, left-hander, outside wheel loaded") and a `derived` object so it explains, not calculates;
  - temperature 0.2;
  - schema-validate and clamp tool arguments;
  - optionally add a `lookup_fact(topic)` tool backed by a small in-Worker map if cards outgrow the prompt (still no vector DB).
- When RAG WOULD be right: the knowledge base grows past ~60k tokens, you need per-document citations, or non-developers edit docs in R2. Then use AI Search (upload to its built-in storage; every instance exposes an MCP endpoint), or Vectorize plus `bge-base-en-v1.5`.

## 5. Complete liftable code (minimal version)

Install: `npm i agents ai @ai-sdk/provider zod` (needs `ai@^7`, tested types: `ai@7.0.178`) and `npm i -D wrangler @cloudflare/workers-types`.

### 5.1 `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "suspension-lab",
  "main": "src/worker.ts",
  "compatibility_date": "2026-11-20",
  "compatibility_flags": ["nodejs_compat"],        // required by the `agents` package
  "upload_source_maps": true,

  // Workers AI binding -> env.AI (always runs remotely, even in `wrangler dev`)
  "ai": { "binding": "AI" },

  // Static Three.js build, Worker only runs for /api/*
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },

  // Rate Limiting binding (wrangler >= 4.36). period must be 10 or 60. Per-location, approximate.
  "ratelimits": [
    { "name": "RL_BURST",     "namespace_id": "2001", "simple": { "limit": 3,  "period": 10 } },
    { "name": "RL_SUSTAINED", "namespace_id": "2002", "simple": { "limit": 15, "period": 60 } }
  ],

  "vars": { "TURNSTILE_SITEKEY": "0x4AAAA...", "MODEL": "@cf/google/gemma-4-26b-a4b-it" }
  // secrets: `wrangler secret put TURNSTILE_SECRET`, `wrangler secret put SESSION_HMAC_KEY`
}
```

(`ai` binding and `ratelimits` shapes were copied from the Workers bindings and Rate Limiting docs. Pages Functions would need dashboard binding config instead.)

### 5.2 `src/worker.ts` (stateless, streams SSE, tools are client-executed)

```ts
import { createAI } from "agents/models/ai-sdk";
import { streamText, tool } from "ai";
import { z } from "zod";
import { FACTS } from "./facts";            // { common: string, macpherson: string, double_wishbone: string, multilink: string }

interface Env {
  AI: Ai; ASSETS: Fetcher;
  RL_BURST: RateLimit; RL_SUSTAINED: RateLimit;
  TURNSTILE_SECRET: string; SESSION_HMAC_KEY: string; MODEL: string;
}

// ---------- schemas -------------------------------------------------------------
const Wheel = z.object({
  camber_deg: z.number().min(-10).max(10),
  travel_mm: z.number().min(-150).max(150),     // + = bump
  load_n: z.number().min(0).max(20000),
});
const Telemetry = z.object({
  suspension: z.enum(["macpherson", "double_wishbone", "multilink"]),
  section: z.string().max(40),                  // e.g. "chicane-2"
  event: z.string().max(80),                    // client-derived label: "mid-corner, left-hander, outside wheel loaded"
  speed_kmh: z.number().min(0).max(400),
  lat_g: z.number().min(-3).max(3),
  roll_deg: z.number().min(-8).max(8),
  pitch_deg: z.number().min(-6).max(6),
  wheels: z.object({ fl: Wheel, fr: Wheel, rl: Wheel, rr: Wheel }),
  derived: z.record(z.string().max(24), z.number()).optional(),   // e.g. {roll_centre_height_mm: 62}
});
const Body = z.object({
  question: z.string().min(1).max(280),
  telemetry: Telemetry,
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(600) })).max(6).default([]),
});

// ---------- tools: NO `execute` => model emits a tool-call, the browser performs it ---
const tools = {
  switch_suspension: tool({
    description: "Switch the car to a different suspension type.",
    inputSchema: z.object({ type: z.enum(["macpherson", "double_wishbone", "multilink"]) }),
  }),
  focus_camera: tool({
    description: "Move the camera to look at one wheel or the whole car.",
    inputSchema: z.object({ target: z.enum(["fl", "fr", "rl", "rr", "car"]), view: z.enum(["close", "xray", "side"]).default("close") }),
  }),
  set_slow_motion: tool({
    description: "Set simulation speed. 1 = normal, 0.1 = very slow.",
    inputSchema: z.object({ scale: z.number().min(0.1).max(1) }),
  }),
  highlight_component: tool({
    description: "Glow one suspension component on a wheel.",
    inputSchema: z.object({
      component: z.enum(["spring", "damper", "upper_arm", "lower_arm", "strut", "anti_roll_bar", "subframe", "knuckle", "tyre"]),
      wheel: z.enum(["fl", "fr", "rl", "rr", "all"]).default("all"),
    }),
  }),
  jump_to_section: tool({
    description: "Teleport the car to the start of a named track section.",
    inputSchema: z.object({ section: z.enum(["straight", "chicane-1", "chicane-2", "hairpin", "bumps", "sweeper"]) }), // match your track config
  }),
};

const systemPrompt = (t: z.infer<typeof Telemetry>) => `You are the Race Engineer inside a 3D suspension simulator.
RULES
- Answer in 1-3 short sentences, plain language, no markdown, no lists.
- Explain WHY using ONLY the TELEMETRY below and the FACTS. Quote only numbers that appear in TELEMETRY. If a number is missing, say you can't see it.
- If you use a tool, write your sentence(s) FIRST, then call at most 2 tools. Use tools to SHOW (e.g. highlight the damper, focus the loaded wheel, slow motion) instead of describing.
- Never invent specifications, brands or lap times. If the question is off-topic, answer in one sentence and steer back to the suspension.
FACTS
${FACTS.common}
${FACTS[t.suspension]}
TELEMETRY (live, from the simulator)
${JSON.stringify(t)}`;

// ---------- helpers -------------------------------------------------------------
const enc = new TextEncoder();
const sse = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function makeSession(env: Env) {           // cookie = "<expiryEpoch>.<hmac>"
  const exp = Math.floor(Date.now() / 1000) + 1800;
  return `${exp}.${await hmac(env.SESSION_HMAC_KEY, String(exp))}`;
}
async function validSession(env: Env, req: Request) {
  const m = /(?:^|;\s*)eng=(\d+)\.([0-9a-f]+)/.exec(req.headers.get("cookie") ?? "");
  return !!m && +m[1] > Date.now() / 1000 && (await hmac(env.SESSION_HMAC_KEY, m[1])) === m[2];
}

// ---------- worker --------------------------------------------------------------
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // 1) Turnstile -> short-lived signed cookie (tokens are single-use, so exchange once per session)
    if (url.pathname === "/api/session" && req.method === "POST") {
      const { token } = (await req.json().catch(() => ({}))) as { token?: string };
      const ip = req.headers.get("CF-Connecting-IP") ?? "";
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token ?? "", remoteip: ip }),
      });
      const v = (await r.json()) as { success: boolean };
      if (!v.success) return new Response("turnstile failed", { status: 403 });
      return new Response("ok", { headers: { "set-cookie": `eng=${await makeSession(env)}; Path=/api; Max-Age=1800; HttpOnly; Secure; SameSite=Lax` } });
    }

    if (url.pathname !== "/api/engineer" || req.method !== "POST") return new Response("Not found", { status: 404 });
    if (!(await validSession(env, req))) return new Response("session required", { status: 401 });

    // 2) rate limits (key by IP; add session id if you like)
    const ip = req.headers.get("CF-Connecting-IP") ?? "anon";
    const [a, b] = await Promise.all([env.RL_BURST.limit({ key: ip }), env.RL_SUSTAINED.limit({ key: ip })]);
    if (!a.success || !b.success) return new Response("slow down", { status: 429, headers: { "retry-after": "10" } });

    // 3) validate input
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return new Response("bad request", { status: 400 });
    const { question, telemetry, history } = parsed.data;

    // 4) model via AI Gateway ("default" gateway; create your own for limits/caching settings)
    const ai = createAI({ binding: env.AI, id: "suspension-lab", metadata: { app: "race-engineer" } });
    const model = ai(env.MODEL, {
      chatTemplateKwargs: { enable_thinking: false },      // no hidden reasoning tokens
      sessionAffinity: ip,                                 // prefix caching on one replica
      fallback: ["@cf/zai-org/glm-4.7-flash"],             // tried only if the primary fails before output
    });

    const result = streamText({
      model,
      system: systemPrompt(telemetry),
      messages: [...history, { role: "user" as const, content: question }],
      tools,
      maxOutputTokens: 160,                                // hard cost/abuse cap
      temperature: 0.2,
      abortSignal: req.signal,
    });

    // 5) re-emit as simple SSE events: {t:"text",v} | {t:"tool",name,args} | {t:"done"} | {t:"error"}
    const body = new ReadableStream({
      async start(c) {
        try {
          for await (const p of result.fullStream) {
            if (p.type === "text-delta") c.enqueue(sse({ t: "text", v: p.text }));
            else if (p.type === "tool-call") c.enqueue(sse({ t: "tool", name: p.toolName, args: p.input }));
            else if (p.type === "error") c.enqueue(sse({ t: "error" }));
          }
        } catch { c.enqueue(sse({ t: "error" })); }
        c.enqueue(sse({ t: "done" }));
        c.close();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
  },
} satisfies ExportedHandler<Env>;
```

Verified against the `ai@7.0.178` type definitions: `fullStream` part `text-delta` has `.text`, `tool-call` is a `TypedToolCall` (`toolName`, `input`, `toolCallId`), `finish` has `finishReason`, and `system` plus `isStepCount` exist. `maxOutputTokens` is the AI SDK's call option (I did not re-check its exact v7 name in the d.ts; if it errors, use `providerOptions` or the raw `max_completion_tokens`). Behaviour on a live Workers AI stream is UNVERIFIED. A tool with no `execute` should end the turn after the tool-call; the "sentence first, then tool" ordering relies on the model following the prompt, so test it.

### 5.3 Client: SSE reader (POST, so not `EventSource`) and action dispatcher

```ts
type Ev = { t: "text"; v: string } | { t: "tool"; name: string; args: any } | { t: "done" } | { t: "error" };

export async function askEngineer(
  question: string, telemetry: object, history: {role:"user"|"assistant";content:string}[],
  on: { text(d: string): void; tool(name: string, args: any): void; done(): void; error(): void },
  signal?: AbortSignal,
) {
  const res = await fetch("/api/engineer", {
    method: "POST", credentials: "same-origin", signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, telemetry, history }),
  });
  if (!res.ok || !res.body) { on.error(); return; }          // 401 -> re-run Turnstile, 429 -> show "engineer is busy"
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (!line.startsWith("data: ")) continue;
      const ev = JSON.parse(line.slice(6)) as Ev;
      if (ev.t === "text") on.text(ev.v);
      else if (ev.t === "tool") on.tool(ev.name, ev.args);
      else if (ev.t === "done") on.done();
      else on.error();
    }
  }
}

// Whitelisted dispatcher: the model can only call what you wire here
const actions: Record<string, (a: any) => void> = {
  switch_suspension: a => sim.setSuspension(a.type),
  focus_camera: a => cam.focusWheel(a.target, a.view),
  set_slow_motion: a => sim.setTimeScale(a.scale),
  highlight_component: a => scene.highlight(a.component, a.wheel),
  jump_to_section: a => track.jumpTo(a.section),
};
// on.tool = (name, args) => actions[name]?.(args)
```

"Why did it do that?" button: send `question = "Why did the car just do that?"` with the telemetry snapshot taken a few hundred ms ago (keep a ring buffer client-side) plus the event label the physics layer already computed.

### 5.4 Turnstile on the client (once per session)

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>
<script>
  turnstile.render("#ts", { sitekey: "<TURNSTILE_SITEKEY>", size: "invisible" /* or managed */,
    callback: t => fetch("/api/session", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ token: t }) }) });
</script>
```

### 5.5 Raw alternative without the AI SDK (verified call shape, streamed tool-call parsing UNVERIFIED)

```ts
const stream = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
  messages, tools: [{ type: "function", function: { name, description, parameters /* JSON Schema */ } }],
  stream: true, max_completion_tokens: 160, temperature: 0.2,
  chat_template_kwargs: { enable_thinking: false },
}, { gateway: { id: "suspension-lab", cacheTtl: 0 /* or skipCache:true */ } });
return new Response(stream, { headers: { "content-type": "text/event-stream" } });
```
You would parse OpenAI-style `data:` chunks (`choices[0].delta.content` and `delta.tool_calls[]`, then `[DONE]`) yourself. The AI SDK route above is less code and less risk.

## 6. AI Gateway options (verified)

- **How Workers AI goes through it:**
  - `createAI({ binding, id })` always does (default id `default`).
  - Raw binding: `env.AI.run(model, input, { gateway: { id, skipCache, cacheTtl } })`.
  - REST: `POST /accounts/{id}/ai/v1/chat/completions` with the header `cf-aig-gateway-id`.
- **Caching:** off by default. Exact-match only (SHA-256 of provider + endpoint + model + auth header + full body); text and image responses only, no semantic cache yet. Headers: `cf-aig-cache-ttl`, `cf-aig-skip-cache`, `cf-aig-cache-key`, and the response header `cf-aig-cache-status` (HIT/MISS).
  - Live telemetry makes every prompt unique, so hit rate is about 0%. To benefit, quantise: for the canned "Why did it do that?" case, set `cacheKey = "${suspension}:${section}:${eventLabel}"` and serve the same explanation to everyone.
  - Per-model `cacheTtl` and `cacheKey` are `createAI` options.
- **Rate limiting:** gateway-level, requests per window, fixed or sliding, returns 429. Configure in dashboard (AI > AI Gateway > Settings) or via `rate_limiting_*` fields on the gateway API. It is a global backstop; keep the Worker binding for per-IP fairness.
- **Spend limits:** dollar budgets per gateway, up to 20 rules, scoped by provider, model or custom metadata (e.g. split by `userId`), returning 429 when exceeded. They are eventually consistent, so a burst can slightly overshoot. This is the best "never get a surprise bill" control: set one global daily budget.
- **Logs and analytics:** requests, tokens, cost, errors; attach `metadata` per call (`providerOptions.cloudflare.metadata`).
- **Fallback:** the `fallback: [...]` array in `createAI` model options (primary must fail before producing output). Dynamic routes (`ai("dynamic/name")`) give gateway-side fallback, percentages and conditions.
- **Guardrails:** uses `llama-guard-3-8b`, billed as Workers AI inference. Probably unnecessary for a constrained 1-3 sentence engineer, since the system prompt plus the token cap handle it.
- **Unified Billing:** prepaid gateway credits that give paid models higher rate limits and allow non-Workers-AI models (e.g. `anthropic/claude-opus-5.5` via `createAI`). It requires gateway authentication.
- **Gateway cost:** core features are free on all plans.

## 7. Abuse prevention checklist for a public demo

1. **Turnstile once per session** (section 5.2/5.4) to get an HMAC cookie. Siteverify is `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`.
2. **Rate Limiting binding**, a burst limit (10 s) and a sustained limit (60 s), keyed by IP. Counts are per Cloudflare location and approximate; use a Durable Object counter if you need strict global limits.
3. **Hard output cap** (`maxOutputTokens` 160), a 280-character question cap, at most 6 history turns of 600 characters, and zod validation with clamped numeric ranges. This bounds both cost and prompt-injection surface.
4. **Capability whitelist:** tools have no `execute`, and the client dispatches only named actions. Enums in the schema stop the model from inventing targets. Clamp slow-motion scale client-side too.
5. **AI Gateway spend limit and rate limit** as the backstop. Handle 429 with a friendly canned line.
6. **Free-tier ceiling:** 10k neurons/day is about 225 answers. Past that, behaviour depends on plan. I believe Free-plan requests error rather than bill, but this is UNVERIFIED. Catch it and fall back to prewritten explanations per `event` label, so the experience degrades gracefully.
7. **No PII in prompts or logs.** The telemetry is just physics.

## 8. Streaming, voice and realtime

- **SSE:** Workers AI returns `text/event-stream`. The AI SDK route turns it into the small custom event stream in 5.2. The reader in 5.3 works in any framework. Time-to-first-token is the metric to watch (UNVERIFIED, measure it).
- **Optional TTS narration (recommended order):**
  1. Browser `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`: free, instant, platform-quality voice.
  2. Pre-rendered static MP3 per canned `event` label, generated once at build time with aura-2-en: free at runtime and cinematic.
  3. On-demand Workers AI TTS (`@cf/deepgram/aura-1` or `aura-2-en`), whose input is `{ text, speaker, encoding:"mp3" }` and which returns audio. Gate it behind a toggle and a per-session cap because of the cost in section 3. Cache by hash in the Workers Cache API or KV; AI Gateway caching covers text and images only.
- **Realtime voice (stretch/skip):** `agents/voice` (`withVoice`, `WorkersAIFluxSTT`, `WorkersAITTS`, `useVoiceAgent`) streams 16 kHz PCM over a WebSocket to a Durable Object, with STT → `onTurn()` → sentence-chunked TTS and interruption handling. It is beta and needs a Durable Object per call. Flux STT costs $0.0077 per audio minute, but it is not needed for a "tap a button" UX. A cheaper voice-in option is push-to-talk with `whisper-large-v3-turbo`, or the browser `SpeechRecognition` API (Chrome-only, audio goes to Google).
- **Browser-side alternatives:**
  - Chrome Prompt API (Gemini Nano): reported stable from Chrome 148 per a secondary Japanese article and the Chrome docs; desktop only, needs large local storage and a model download, no confirmed native tool calling. Not reliable enough for a public demo.
  - WebLLM `@mlc-ai/web-llm` 0.2.89 (Apache-2.0) and `@huggingface/transformers` 4.3.2 (Apache-2.0) run small models on WebGPU, but they compete with Three.js for the GPU and need a multi-hundred-MB download. Skip.
  - Zero-LLM fallback: a rule-based explainer that maps `event` labels to prewritten sentences. Ship it anyway as the offline and error path.

## 9. Agents SDK, Vectorize, AI Search: where they fit

- **Agents SDK (`agents`, MIT):** a Durable Object per session with SQLite persistence, WebSocket chat (`useAgent`, `useAgentChat`), state sync to clients, scheduling, MCP client/server, client-side tools via `onToolCall`, and the `Think` and Pi harnesses. Worth adopting only if you want conversation memory across reloads or multi-tab sync. The stateless Worker above is simpler, cheaper and easier to rate-limit. If you go that route, tools without `execute` on the server are routed to the browser, and the `onToolCall` flow in the Think docs gives you the same "drive the UI" pattern.
- **Vectorize:** index limits and pricing are fine, but it is unnecessary here (section 4).
- **AI Search:** a managed index, MCP endpoint and UI snippet; billing starts 2026-12-01. Revisit only if the knowledge base grows or becomes editable by non-devs.
- **MCP:** you could expose the simulator as an MCP server so external agents can drive it. That is a novelty, not part of the minimal build.

## 10. Open-source examples to read (licences verified from the repos' LICENSE files; star counts and last-commit dates UNVERIFIED because the GitHub API was blocked)

| Repo | Licence | What is reusable |
|---|---|---|
| https://github.com/cloudflare/agents-starter | MIT | `src/server.ts` (AIChatAgent with server-side, client-side and approval tools plus scheduling), `src/app.tsx` chat UI, `wrangler.jsonc`. Uses `workers-ai-provider` and `kimi-k2.7-code`, so swap the model for a non-deprecated one. |
| https://github.com/cloudflare/agents | MIT | The SDK itself, plus `examples/` and docs. `npm i agents` is at 0.34.0. |
| https://github.com/cloudflare/ai | MIT | `packages/workers-ai-provider`, `packages/ai-search-provider`, `packages/ai-gateway-provider`, `examples/workers-ai` (chat with tools, embeddings, transcription, TTS), `demos/` (tool calling, structured output, agents, MCP). |

I did not open the individual demo files, so name them to your implementer only after listing the `demos/` directory.

## 11. Honest evaluation

- **Latency:** the first token needs one model round trip plus a short prompt. Expect on the order of a few hundred ms to about a second with reasoning off. UNVERIFIED, no measurements were possible. With reasoning on, expect several seconds. Show the sentence as it streams and fire tools as soon as they arrive, so the 3D reaction can land before the sentence finishes.
- **Quality risks:** small MoE models can still misattribute causes. Mitigate with the `event` label, a `derived` block, a temperature of 0.2 and the number-quoting rule. Keep gpt-oss-120b as an opt-in "deep" mode if answers disappoint.
- **Tool-call reliability:** sentence-first-then-tool ordering depends on the model. If it calls tools without text, make the client show a generic caption from the tool args. Also test `tool_choice: "auto"` and `parallel_tool_calls`.
- **Platform churn:** several models and packages changed within the last weeks (deprecations dated today, `workers-ai-provider` deprecation notice, Agents SDK restructuring). Pin versions, put the model id in a `var` (done above), and keep the fallback model.
- **Cost:** negligible at demo scale (about $0.0005 per answer). The free tier covers about 225 answers/day; Workers Paid removes the daily ceiling, and a gateway spend limit bounds the downside.
- **Complexity:** the minimal version is about 150 lines of Worker, a small client reader, and three markdown-sized fact cards.

## Recommendations for Suspension Lab

1. **Build `ai-engineer` as a swappable module** with a tiny interface: `ask(question, telemetrySnapshot) → AsyncIterable<{text|tool|done}>`, plus an `actions` registry the sim registers. Provide a second implementation, a rule-based explainer keyed by `event` label, used for offline, error and over-quota cases.
2. **Model:** `@cf/google/gemma-4-26b-a4b-it` with reasoning disabled; fallback `@cf/zai-org/glm-4.7-flash`; optional "deep" toggle `@cf/openai/gpt-oss-120b`. Never use the models deprecated today (kimi-k2.6/k2.7-code, glm-5.3-flash, nemotron-3-120b, melotts).
3. **Grounding:** write three suspension fact cards of about 1k tokens each plus a common card, and select by type in the Worker. Make the client compute and send every number (camber, travel, load, roll) and a human-readable `event` label. No RAG.
4. **Tools:** the five whitelisted tools in 5.2, executed in the browser only. Cap at 2 tool calls per answer.
5. **Abuse controls:** Turnstile once, the rate-limit binding, `maxOutputTokens` 160, a gateway spend limit and a gateway rate limit. Test the over-quota path.
6. **Voice:** ship browser `speechSynthesis` first; add pre-rendered aura-2-en MP3s for canned lines as a polish step. Skip realtime voice input and `agents/voice`.
7. **Defer:** Agents SDK / Durable Objects (only for cross-session memory), Vectorize, AI Search.
8. **Before shipping, measure:** time-to-first-token, how often the model emits text before the tool call, and whether Free-plan overage errors or bills. Then record the results in this file.
9. **Dev note:** `wrangler dev` calls Workers AI remotely, needs `wrangler login` or `CLOUDFLARE_API_TOKEN`, and counts against limits.

### Source URLs
- Models and pricing: https://developers.cloudflare.com/workers-ai/models/ and https://developers.cloudflare.com/workers-ai/platform/pricing/
- AI SDK / `createAI`: https://developers.cloudflare.com/agents/models/ai-sdk/ and https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/
- Binding: https://developers.cloudflare.com/workers-ai/configuration/bindings/
- AI Gateway: https://developers.cloudflare.com/ai-gateway/ (caching, rate-limiting, spend-limits, usage/providers/workersai)
- Rate Limiting binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Turnstile: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Voice: https://developers.cloudflare.com/agents/agent-class/communication-channels/voice/
- Think / client tools: https://developers.cloudflare.com/agents/harnesses/think/client-tools/
- AI Search pricing: https://developers.cloudflare.com/ai-search/platform/limits-pricing/
- Vectorize pricing: https://developers.cloudflare.com/vectorize/platform/pricing/
- Chrome Prompt API: https://developer.chrome.com/docs/ai/prompt-api
