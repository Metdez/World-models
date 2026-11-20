/**
 * Audio (plan 07-03): engine loop pitched by speed and throttle (car / motorcycle loops crossfaded by vehicle
 * class), tyre noise from grip use, a thump on kerbs, bumps and bump-stop hits, a quiet tick on a suspension swap.
 * Muted by default; M or the HUD button toggles it and the choice is remembered. No AudioContext exists before a
 * user gesture, nothing is downloaded until sound is first switched on, and attract mode is silent unless this is
 * the presenter's screen. The WebAudio graph is built once; update() does not allocate.
 */
import type { Assets, FeatureContext, FeatureModule, FrameInfo } from '../../contracts/app';
import type { VehicleClass } from '../../contracts/suspension';
import { h, mount } from '../../ui/dom';
import { engineTone, MASTER_GAIN, ramp, skidTone, THUMP_RATE, thumpGain, type Tone } from './mix';
import './audio.css';

const STORAGE_KEY = 'sl-audio';
const THUMP_COOLDOWN_S = 0.14;
const SUSPEND_AFTER_MS = 600;
const CLASSES: readonly VehicleClass[] = ['car', 'motorcycle'];
const ENGINE_ASSET: Readonly<Record<VehicleClass, string>> = { car: 'audio/engine', motorcycle: 'audio/engine-motorcycle' };

const icon = (body: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8v4h3l4 3.5v-11l-4 3.5z"/>${body}</svg>`;
const ICON_ON = icon('<path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10"/>');
const ICON_OFF = icon('<path d="M13.5 8l4 4M17.5 8l-4 4"/>');

interface Voice {
  readonly gain: GainNode;
  readonly src: AudioBufferSourceNode | null;
  readonly g: { v: number };
  readonly r: { v: number };
}

interface Graph {
  readonly ac: AudioContext;
  readonly master: GainNode;
  readonly m: { v: number };
  readonly engines: Readonly<Record<VehicleClass, Voice>>;
  readonly skid: Voice;
  readonly impact: AudioBuffer | null;
  readonly tick: AudioBuffer;
}

function readSaved(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function save(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked (private mode, policy): the choice lasts for this visit only
  }
}

async function buildGraph(ac: AudioContext, assets: Assets): Promise<Graph> {
  const load = async (id: string): Promise<AudioBuffer | null> => {
    try {
      const res = await fetch(assets.url(id));
      return await ac.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null; // missing asset or codec: that voice stays silent
    }
  };
  const [car, motorcycle, skid, impact] = await Promise.all([load(ENGINE_ASSET.car), load(ENGINE_ASSET.motorcycle), load('audio/skid'), load('audio/impact')]);
  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(ac.destination);
  const loop = (buffer: AudioBuffer | null): Voice => {
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    let src: AudioBufferSourceNode | null = null;
    if (buffer) {
      src = ac.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(gain);
      src.start();
    }
    return { gain, src, g: { v: 0 }, r: { v: 1 } };
  };
  // UI tick: 30 ms of a 1.8 kHz sine with a 6 ms decay (synthesised once; there is no tick asset).
  const tick = ac.createBuffer(1, Math.round(ac.sampleRate * 0.03), ac.sampleRate);
  const d = tick.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const t = i / ac.sampleRate;
    d[i] = Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-t / 0.006) * Math.min(1, t / 0.001);
  }
  return { ac, master, m: { v: 0 }, engines: { car: loop(car), motorcycle: loop(motorcycle) }, skid: loop(skid), impact, tick };
}

let frameHandler: ((frame: FrameInfo) => void) | undefined;

function init(c: FeatureContext): void {
  let on = readSaved();
  let ac: AudioContext | null = null;
  let graph: Graph | null = null;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;

  const audible = () => {
    const s = c.store.get();
    return on && !document.hidden && (!s.attract || c.flags.screen);
  };

  /** Only ever called from a user gesture (click, key): browsers allow audio to start there. */
  const ensure = () => {
    if (typeof AudioContext !== 'function') return;
    clearTimeout(suspendTimer);
    if (ac) {
      void ac.resume().catch(() => undefined);
      return;
    }
    ac = new AudioContext();
    void buildGraph(ac, c.assets).then(
      (g) => {
        if (ac === g.ac) graph = g;
      },
      () => undefined,
    );
  };

  const oneShot = (buffer: AudioBuffer | null, gain: number, rate = 1) => {
    const g = graph;
    if (!g || !buffer || g.m.v === 0) return;
    const src = g.ac.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const amp = g.ac.createGain();
    amp.gain.value = gain;
    src.connect(amp).connect(g.master);
    src.onended = () => amp.disconnect();
    src.start();
  };

  // --- HUD button: sits in the controls' Display group when there is one, else its own pill.
  const btn = h('button', { type: 'button', class: 'sl-controls-btn sl-audio-btn', 'aria-label': 'Sound', 'aria-keyshortcuts': 'M' });
  let solo: HTMLElement | null = null;
  const sync = () => {
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Sound on (M)' : 'Sound off (M)';
    btn.innerHTML = on ? ICON_ON : ICON_OFF;
  };
  sync();
  const place = () => {
    if (btn.isConnected) return;
    const group = c.dom.overlay.querySelector('.sl-controls-tr [role="group"][aria-label="Display"]');
    if (group) group.insertBefore(btn, group.lastElementChild);
    else {
      solo = h('div', { class: 'sl-audio' }, btn);
      c.dom.overlay.append(solo);
    }
  };
  if (c.dom.overlay.querySelector('.sl-controls-tr')) place();
  else c.on('app:ready', place);
  c.addDisposer(() => {
    btn.remove();
    solo?.remove();
  });

  const toggle = () => {
    on = !on;
    save(on);
    sync();
    if (on) ensure();
    else {
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => {
        if (!on) void ac?.suspend().catch(() => undefined);
      }, SUSPEND_AFTER_MS);
    }
  };
  btn.addEventListener('click', (e) => {
    if (e.detail > 0) btn.blur(); // pointer click: keep Space for pause (as the other HUD buttons)
    toggle();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.key.toLowerCase() !== 'm') return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t.matches('input, textarea, select'))) return;
    e.preventDefault();
    toggle();
  };
  window.addEventListener('keydown', onKey);
  c.addDisposer(() => window.removeEventListener('keydown', onKey));

  // Sound remembered as on: start at the visitor's first gesture, never before.
  const gesture = () => {
    if (on) ensure();
    window.removeEventListener('pointerdown', gesture, true);
    window.removeEventListener('keydown', gesture, true);
  };
  if (on) {
    window.addEventListener('pointerdown', gesture, true);
    window.addEventListener('keydown', gesture, true);
  }
  c.addDisposer(() => {
    window.removeEventListener('pointerdown', gesture, true);
    window.removeEventListener('keydown', gesture, true);
  });

  // A hidden tab renders no frames (no ramps), so the context itself pauses.
  const onVisibility = () => {
    if (document.hidden) void ac?.suspend().catch(() => undefined);
    else if (on) void ac?.resume().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisibility);
  c.addDisposer(() => document.removeEventListener('visibilitychange', onVisibility));

  c.on('sim:suspension', () => oneShot(graph?.tick ?? null, 0.12));
  c.on('sim:event', (e) => {
    if (e.kind === 'bump-stop' && !c.store.get().paused) thump(1, 0);
  });

  let lastThump = -Infinity;
  const thump = (stop: number, rate: number) => {
    const g = graph;
    if (!g || g.ac.currentTime - lastThump < THUMP_COOLDOWN_S) return;
    lastThump = g.ac.currentTime;
    oneShot(g.impact, thumpGain(rate, stop), 0.85 + 0.3 * Math.random());
  };

  const tone: Tone = { rate: 1, gain: 0 };
  const armed = new Uint8Array(8).fill(1);
  frameHandler = ({ t }) => {
    const g = graph;
    if (!g) return;
    const now = g.ac.currentTime;
    const s = c.store.get();
    ramp(g.master.gain, g.m, audible() ? MASTER_GAIN : 0, now);
    if (g.m.v === 0) return;

    engineTone(tone, t.vehicleClass, t.speed, t.ax, s.timeScale, s.paused);
    for (let i = 0; i < CLASSES.length; i++) {
      const cls = CLASSES[i]!;
      const v = g.engines[cls];
      const active = cls === t.vehicleClass;
      ramp(v.gain.gain, v.g, active ? tone.gain : 0, now);
      if (active && v.src) ramp(v.src.playbackRate, v.r, tone.rate, now);
    }

    let grip = 0;
    for (let i = 0; i < t.corners.length; i++) {
      const corner = t.corners[i]!;
      if (corner.gripUse > grip) grip = corner.gripUse;
      const rate = Math.abs(corner.travelRate);
      if (armed[i] === 1 && rate > THUMP_RATE && !s.paused) {
        armed[i] = 0;
        thump(0, rate);
      } else if (rate < THUMP_RATE / 2) armed[i] = 1;
    }
    skidTone(tone, grip, t.speed, s.paused);
    ramp(g.skid.gain.gain, g.skid.g, tone.gain, now);
    if (g.skid.src) ramp(g.skid.src.playbackRate, g.skid.r, tone.rate, now);
  };

  c.addDisposer(() => {
    frameHandler = undefined;
    clearTimeout(suspendTimer);
    graph = null;
    void ac?.close().catch(() => undefined);
    ac = null;
  });
}

export default {
  id: 'audio',
  requires: [],
  phase: 'scene',
  init,
  update(frame) {
    frameHandler?.(frame);
  },
} satisfies FeatureModule;
