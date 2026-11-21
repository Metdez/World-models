import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { NET_LIMITS, PROTOCOL_VERSION, type ClientMessage, type PresenterControls } from '../../src/contracts/net';
import {
  clientMessageSchema,
  isCurrentProtocol,
  parseClientMessage,
  parseUpgradeQuery,
  presenterControlsSchema,
} from '../../worker/schemas/room';

describe('schema types match contracts/net.ts', () => {
  it('ClientMessage and PresenterControls are mutually assignable with the schema output', () => {
    expectTypeOf<z.output<typeof clientMessageSchema>>().toEqualTypeOf<ClientMessage>();
    expectTypeOf<z.output<typeof presenterControlsSchema>>().toEqualTypeOf<PresenterControls>();
    // Every contract message is accepted by the schema's input type.
    expectTypeOf<ClientMessage>().toExtend<z.input<typeof clientMessageSchema>>();
  });
});

describe('parseUpgradeQuery', () => {
  const p = (s: string) => parseUpgradeQuery(new URLSearchParams(s));

  it('accepts a full query and coerces pv', () => {
    const query = p(`id=3f1c-ab&role=viewer&v=gt-coupe&s=double-wishbone&pv=${PROTOCOL_VERSION}`);
    expect(query).toEqual({ id: '3f1c-ab', role: 'viewer', v: 'gt-coupe', s: 'double-wishbone', pv: PROTOCOL_VERSION });
    expect(query && isCurrentProtocol(query)).toBe(true);
    expect(isCurrentProtocol({ id: 'a', role: 'viewer', pv: 0 })).toBe(false);
  });

  it('treats empty params as absent', () => {
    expect(p('id=a&role=audience&k=&v=&s=&pv=1')).toEqual({ id: 'a', role: 'audience', pv: 1 });
  });

  it('rejects missing/oversized ids, unknown roles, non-numeric pv', () => {
    expect(p('role=viewer&pv=1')).toBeNull();
    expect(p(`id=${'a'.repeat(37)}&role=viewer&pv=1`)).toBeNull();
    expect(p('id=a b&role=viewer&pv=1')).toBeNull();
    expect(p('id=a&role=admin&pv=1')).toBeNull();
    expect(p('id=a&role=driver&pv=3')).toEqual({ id: 'a', role: 'driver', pv: 3 });
    expect(p('id=a&role=viewer&pv=x')).toBeNull();
    expect(p('id=a&role=viewer&s=Bad Id&pv=1')).toBeNull();
  });
});

describe('parseClientMessage', () => {
  const ok = (m: unknown) => parseClientMessage(JSON.stringify(m));

  it('accepts every message kind of the contract', () => {
    const messages: ClientMessage[] = [
      { t: 'sync', c0: 1234.5 },
      { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'multilink' },
      { t: 'auth', k: 'abcdefghijklmnopqrstuvwxyz012345' },
      { t: 'ctl', set: { vehicleId: 'gt-coupe', view: 'closeup', xray: true, overlay: 'engineer', timeScale: 0.25, amplification: 2.5, attract: false, section: 'carousel' } },
      { t: 'ctl', set: {} },
      { t: 'cue', cue: 'focus-front-left' },
      { t: 'poll', poll: { question: 'Which handles the kerb best?', options: ['A', 'B', 'C', 'D'] } },
      { t: 'poll', poll: null },
      { t: 'vote', pollId: crypto.randomUUID(), choice: 3 },
      { t: 'in', n: 0, s: -1000, th: 0, br: 1000, f: 0 },
      { t: 'in', n: 4294967295, s: 1000, th: 1000, br: 0, f: 7 },
      { t: 'tel', v: 0, g: -1, m: 3, k: 3 },
      { t: 'tel', v: 241, g: 6, m: 1, k: 0 },
    ];
    for (const m of messages) expect(ok(m)).toEqual(m);
  });

  it('trims poll text', () => {
    expect(ok({ t: 'poll', poll: { question: '  Q?  ', options: [' A', 'B '] } })).toEqual({ t: 'poll', poll: { question: 'Q?', options: ['A', 'B'] } });
  });

  it('rejects garbage, unknown kinds, extra keys and out-of-range values', () => {
    const bad: unknown[] = [
      { t: 'sync' },
      { t: 'sync', c0: 'now' },
      { t: 'hello' },
      { t: 'pick', vehicleId: 'gt-coupe' },
      { t: 'auth', k: 'short' },
      { t: 'pick', vehicleId: 'GT', suspensionId: 'x' },
      { t: 'pick', vehicleId: 'gt-coupe', suspensionId: 'x', x: 1, y: 2 },
      { t: 'ctl', set: { timeScale: 0 } },
      { t: 'ctl', set: { amplification: 50 } },
      { t: 'ctl', set: { view: 'cockpit' } },
      { t: 'ctl', set: { admin: true } },
      { t: 'cue', cue: 'explode' },
      { t: 'poll', poll: { question: 'Q', options: ['only one'] } },
      { t: 'poll', poll: { question: 'Q', options: ['a', 'b', 'c', 'd', 'e'] } },
      { t: 'poll', poll: { question: 'x'.repeat(NET_LIMITS.pollQuestionChars + 1), options: ['a', 'b'] } },
      { t: 'poll', poll: { question: 'Q', options: ['a', 'x'.repeat(NET_LIMITS.pollOptionChars + 1)] } },
      { t: 'poll', poll: { question: '   ', options: ['a', 'b'] } },
      { t: 'vote', pollId: 'p', choice: 1.5 },
      { t: 'vote', pollId: 'p', choice: -1 },
      { t: 'vote', pollId: 'p', choice: NET_LIMITS.pollOptionsMax },
      { t: 'in', n: -1, s: 0, th: 0, br: 0, f: 0 },
      { t: 'in', n: 4294967296, s: 0, th: 0, br: 0, f: 0 },
      { t: 'in', n: 1, s: 1001, th: 0, br: 0, f: 0 },
      { t: 'in', n: 1, s: 0.5, th: 0, br: 0, f: 0 },
      { t: 'in', n: 1, s: 0, th: -1, br: 0, f: 0 },
      { t: 'in', n: 1, s: 0, th: 0, br: 1001, f: 0 },
      { t: 'in', n: 1, s: 0, th: 0, br: 0, f: 8 },
      { t: 'in', n: 1, s: 0, th: 0, br: 0 },
      { t: 'in', n: 1, s: 0, th: 0, br: 0, f: 0, c: 12.5 },
      { t: 'in', n: 1, s: 0, th: 0, br: 0, f: 0, r: 1 },
      { t: 'tel', v: -1, g: 0, m: 0, k: 0 },
      { t: 'tel', v: 10, g: 0, m: 4, k: 0 },
      { t: 'tel', v: 10, g: 0, m: 0, k: 4 },
      { t: 'tel', v: 10.5, g: 0, m: 0, k: 0 },
      { t: 'gst', x: 0, y: 0, h: 0, v: 0 },
      null,
      [],
      42,
    ];
    for (const m of bad) expect(ok(m), JSON.stringify(m)).toBeNull();
    expect(parseClientMessage('{not json')).toBeNull();
    expect(parseClientMessage('ping')).toBeNull();
  });
});
