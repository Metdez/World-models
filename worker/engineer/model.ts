/**
 * Workers AI call + response normalisation for the Race Engineer.
 * Shape recorded from real calls (tests/fixtures/06-02-ai-response-*.json): OpenAI chat completion,
 * `choices[0].message.content` + `tool_calls[].function.{name, arguments: "<json string>"}`. The legacy Workers AI
 * shape `{ response, tool_calls: [{ name, arguments }] }` is accepted too.
 */
import { ENGINEER_FALLBACK_MODEL, ENGINEER_MAX_OUTPUT_TOKENS, ENGINEER_MODEL, type ToolSchema } from '../../src/contracts/engineer';

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface RawToolCall {
  readonly name: string;
  readonly args: unknown;
}

export interface ModelReply {
  readonly text: string;
  readonly toolCalls: readonly RawToolCall[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function parseArgs(args: unknown): unknown {
  if (typeof args !== 'string') return args;
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return undefined;
  }
}

function toolCall(raw: unknown): RawToolCall | null {
  if (!isObj(raw)) return null;
  const fn = isObj(raw.function) ? raw.function : raw;
  return typeof fn.name === 'string' ? { name: fn.name, args: parseArgs(fn.arguments) } : null;
}

/** Any Workers AI text-generation output -> plain text + tool calls (never throws). */
export function normaliseReply(raw: unknown): ModelReply {
  const r = isObj(raw) && isObj(raw.result) ? raw.result : raw; // REST wraps the binding's object in `result`
  if (!isObj(r)) return { text: '', toolCalls: [] };
  const choice = Array.isArray(r.choices) ? (r.choices[0] as unknown) : undefined;
  const msg = isObj(choice) && isObj(choice.message) ? choice.message : r;
  const text = typeof msg.content === 'string' ? msg.content : typeof r.response === 'string' ? r.response : '';
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : Array.isArray(r.tool_calls) ? r.tool_calls : [];
  return { text, toolCalls: calls.map(toolCall).filter((c): c is RawToolCall => c !== null) };
}

/** Plain caption text: no markdown, single spaces, at most 3 sentences and 420 characters. */
export function cleanText(text: string): string {
  const plain = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_#`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
  return sentences.length <= 420 ? sentences : `${sentences.slice(0, 417).replace(/\s+\S*$/, '')}…`;
}

export const MODEL_TIMEOUT_MS = { primary: 8000, fallback: 6000 } as const;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export interface ModelRun {
  readonly reply: ModelReply;
  readonly model: string;
}

/** Primary model, then once the fallback model on error/timeout. Throws when both fail (caller answers by rule). */
export async function runEngineerModel(ai: Ai, messages: readonly ChatMessage[], tools: readonly ToolSchema[], timeouts: { readonly primary: number; readonly fallback: number } = MODEL_TIMEOUT_MS): Promise<ModelRun> {
  // The generated Ai typings key inputs by model name; this call uses the shared chat-completion input shape.
  const run = ai.run.bind(ai) as unknown as (model: string, inputs: Record<string, unknown>) => Promise<unknown>;
  const inputs = {
    messages,
    tools,
    max_tokens: ENGINEER_MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    chat_template_kwargs: { enable_thinking: false },
  };
  try {
    return { reply: normaliseReply(await withTimeout(run(ENGINEER_MODEL, inputs), timeouts.primary)), model: ENGINEER_MODEL };
  } catch (e) {
    console.warn('engineer: primary model failed', e instanceof Error ? e.message : String(e));
    return { reply: normaliseReply(await withTimeout(run(ENGINEER_FALLBACK_MODEL, inputs), timeouts.fallback)), model: ENGINEER_FALLBACK_MODEL };
  }
}
