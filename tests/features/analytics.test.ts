import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '../../src/contracts/net';
import { initialState, type AppState } from '../../src/contracts/store';
import { BATCH_MAX, createBatcher, FLUSH_DELAY_MS } from '../../src/features/analytics/batcher';
import { trackingAllowed } from '../../src/features/analytics/privacy';
import { createTracker, PICK_DWELL_MS, SESSION_AFTER_MS } from '../../src/features/analytics/tracker';

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
