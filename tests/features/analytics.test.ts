import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '../../src/contracts/net';
import { initialState, type AppState } from '../../src/contracts/store';
import { BATCH_MAX, createBatcher, FLUSH_DELAY_MS } from '../../src/features/analytics/batcher';
import { trackingAllowed } from '../../src/features/analytics/privacy';
import { createTracker, DRIVE_MIN_S, PICK_DWELL_MS, SESSION_AFTER_MS, STATION_REPEAT_MS } from '../../src/features/analytics/tracker';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const view = (v: 'follow' | 'explore' | 'closeup'): AnalyticsEvent => ({ type: 'view-changed', view: v });

describe('privacy signals', () => {
  it('allows tracking only without DNT and GPC', () => {
    expect(trackingAllowed({ doNotTrack: null })).toBe(true);
    expect(trackingAllowed({ doNotTrack: '0' })).toBe(true);
    expect(trackingAllowed({ doNotTrack: 'unspecified' })).toBe(true);
    expect(trackingAllowed({ doNotTrack: '1' })).toBe(false);
    expect(trackingAllowed({ doNotTrack: 'yes' })).toBe(false);
    expect(trackingAllowed({}, { doNotTrack: '1' })).toBe(false);
    expect(trackingAllowed({ globalPrivacyControl: true })).toBe(false);
    expect(trackingAllowed({ globalPrivacyControl: false, doNotTrack: null })).toBe(true);
    expect(trackingAllowed(undefined)).toBe(false);
  });
});

describe('batcher', () => {
  it('sends one batch after the delay', () => {
    const sent: string[] = [];
    const b = createBatcher((body) => sent.push(body));
    b.push(view('explore'));
    b.push(view('closeup'));
    vi.advanceTimersByTime(FLUSH_DELAY_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent.map((s) => JSON.parse(s))).toEqual([[view('explore'), view('closeup')]]);
    vi.advanceTimersByTime(FLUSH_DELAY_MS * 3);
    expect(sent).toHaveLength(1);
  });

  it('sends immediately when the batch is full, never exceeding the route limit', () => {
    const sent: string[] = [];
    const b = createBatcher((body) => sent.push(body));
    for (let i = 0; i < BATCH_MAX * 2 + 1; i++) b.push(view('follow'));
    expect(sent.map((s) => (JSON.parse(s) as unknown[]).length)).toEqual([BATCH_MAX, BATCH_MAX]);
    b.flush();
    expect(sent).toHaveLength(3);
    b.flush();
    expect(sent).toHaveLength(3);
  });

  it('swallows send failures and keeps working', () => {
    let fail = true;
    const sent: string[] = [];
    const b = createBatcher((body) => {
      if (fail) throw new Error('offline');
      sent.push(body);
    });
    b.push(view('follow'));
    expect(() => b.flush()).not.toThrow();
    fail = false;
    b.push(view('explore'));
    b.flush();
    expect(sent.map((s) => JSON.parse(s))).toEqual([[view('explore')]]);
  });
});

describe('tracker', () => {
  function setup(fps: () => number | undefined = () => 59.94) {
    const events: AnalyticsEvent[] = [];
    const t = createTracker({ push: (e) => events.push(e), fps });
    let s: AppState = initialState();
    t.onState(s);
    const set = (patch: Partial<AppState>) => {
      s = { ...s, ...patch };
      t.onState(s);
    };
    return { events, set, t };
  }

  it('does not report the boot state', () => {
    const { events } = setup();
    vi.advanceTimersByTime(PICK_DWELL_MS * 2);
    expect(events).toEqual([]);
  });

  it('reports a suspension pick only after the dwell, and only the last of a click-through', () => {
    const { events, set } = setup();
    set({ suspensionId: 'macpherson' });
    vi.advanceTimersByTime(PICK_DWELL_MS / 2);
    set({ suspensionId: 'multilink' });
    vi.advanceTimersByTime(PICK_DWELL_MS - 1);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual([{ type: 'suspension-picked', vehicle: 'gt-coupe', suspension: 'multilink' }]);
  });

  it('reports a vehicle switch as a pick of the new vehicle and its suspension', () => {
    const { events, set } = setup();
    set({ vehicleId: 'cafe-racer', suspensionId: 'moto-classic' });
    vi.advanceTimersByTime(PICK_DWELL_MS);
    expect(events).toEqual([{ type: 'suspension-picked', vehicle: 'cafe-racer', suspension: 'moto-classic' }]);
  });

  it('reports view changes immediately', () => {
    const { events, set } = setup();
    set({ view: 'closeup' });
    set({ xray: true });
    expect(events).toEqual([view('closeup')]);
  });

  it('ignores attract mode and the presenter screen', () => {
    const { events, set } = setup();
    set({ suspensionId: 'macpherson' });
    set({ attract: true });
    set({ suspensionId: 'multilink', view: 'explore' });
    vi.advanceTimersByTime(PICK_DWELL_MS * 2);
    set({ attract: false, room: { ...initialState().room, role: 'screen' } });
    set({ suspensionId: 'double-wishbone', view: 'closeup' });
    vi.advanceTimersByTime(PICK_DWELL_MS * 2);
    expect(events).toEqual([]);
  });

  it('sends one session event after a minute with the tier and rounded fps', () => {
    const { events, set } = setup();
    set({ quality: 'medium' });
    vi.advanceTimersByTime(SESSION_AFTER_MS);
    expect(events).toEqual([{ type: 'session', quality: 'medium', fps: 59.9 }]);
    vi.advanceTimersByTime(SESSION_AFTER_MS * 3);
    expect(events).toHaveLength(1);
  });

  it('skips the session event without a renderer, and stops on dispose', () => {
    const noRenderer = setup(() => undefined);
    vi.advanceTimersByTime(SESSION_AFTER_MS);
    expect(noRenderer.events).toEqual([]);
    const { events, set, t } = setup();
    set({ suspensionId: 'macpherson' });
    t.dispose();
    vi.advanceTimersByTime(SESSION_AFTER_MS * 2);
    expect(events).toEqual([]);
  });
});

describe('drive analytics (12-03)', () => {
  function setup() {
    const events: AnalyticsEvent[] = [];
    let clock = 0;
    const t = createTracker({ push: (e) => events.push(e), fps: () => 60, now: () => clock });
    let s: AppState = initialState();
    t.onState(s);
    const set = (patch: Partial<AppState>) => {
      s = { ...s, ...patch };
      t.onState(s);
    };
    return { events, set, t, tick: (ms: number) => (clock += ms) };
  }
  const drives = (events: AnalyticsEvent[]) => events.filter((e) => e.type === 'drive-session' || e.type === 'station-visit');

  it('one drive-session in whole seconds when Manual ends (Returning, a cut or a replay); short takeovers are dropped', () => {
    const { events, set, tick } = setup();
    set({ driveMode: 'manual' });
    tick(95_700);
    set({ driveMode: 'returning' });
    set({ driveMode: 'auto' });
    set({ driveMode: 'manual' });
    tick((DRIVE_MIN_S - 1) * 1000 + 900);
    set({ driveMode: 'auto' });
    set({ driveMode: 'manual', suspensionId: 'multilink' });
    tick(12_000);
    set({ driveMode: 'replay' });
    expect(drives(events)).toEqual([
      { type: 'drive-session', vehicle: 'gt-coupe', suspension: 'double-wishbone', seconds: 95 },
      { type: 'drive-session', vehicle: 'gt-coupe', suspension: 'multilink', seconds: 12 },
    ]);
  });

  it('page hide closes the open session and starts a new one; dispose closes it', () => {
    const { events, set, t, tick } = setup();
    set({ driveMode: 'manual' });
    tick(20_000);
    t.endDrive();
    tick(7_000);
    t.dispose();
    expect(drives(events).map((e) => (e as { seconds: number }).seconds)).toEqual([20, 7]);
  });

  it('station-visit only while driving, speed rounded and bounded, once per station per half minute; never in attract', () => {
    const { events, set, t, tick } = setup();
    t.onStation('steering-pad', 14.4);
    set({ driveMode: 'manual', suspensionId: 'macpherson' });
    t.onStation('steering-pad', 14.4);
    t.onStation('steering-pad', 15);
    tick(STATION_REPEAT_MS);
    t.onStation('steering-pad', 140);
    t.onStation('Not An Id', 3);
    set({ attract: true });
    t.onStation('slalom', 8);
    expect(drives(events)).toEqual([
      { type: 'station-visit', station: 'steering-pad', suspension: 'macpherson', speed: 14 },
      { type: 'station-visit', station: 'steering-pad', suspension: 'macpherson', speed: 100 },
    ]);
  });

  it('events carry no inputs, positions or ids beyond the contract fields', () => {
    const { events, set, t, tick } = setup();
    set({ driveMode: 'manual' });
    t.onStation('slalom', 9.6);
    tick(30_000);
    set({ driveMode: 'auto' });
    for (const e of drives(events)) expect(Object.keys(e).sort()).toEqual(e.type === 'drive-session' ? ['seconds', 'suspension', 'type', 'vehicle'] : ['speed', 'station', 'suspension', 'type']);
  });
});
