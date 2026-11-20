import type { AppContext, FeatureContext, FeatureModule, FrameInfo, FramePhase, Registries, Services } from '../contracts/app';

export interface FeatureRecord {
  readonly module: FeatureModule;
  readonly id: string;
  readonly phase: FramePhase;
  enabled: boolean;
  /** Last failure (init/update/contribute), recorded when the feature was disabled because of it. */
  error?: string;
  /** Service ids provided through the scoped context. */
  readonly provides: string[];
  readonly disposers: (() => void)[];
  /** Consecutive update() throws. */
  throws: number;
}

export interface FeatureManager {
  /** Enabled features in init order (dependencies first, ties alphabetical), then disabled ones alphabetically. */
  readonly records: readonly FeatureRecord[];
  contribute(registries: Registries): void;
  init(base: AppContext, afterInit?: (record: FeatureRecord) => void): Promise<void>;
  update(phase: FramePhase, frame: FrameInfo): void;
  /** Disposes the feature and, transitively, every enabled feature that requires it. */
  disable(id: string, error?: string): void;
  /** Disposes every enabled feature in reverse init order. */
  disposeAll(beforeDispose?: (record: FeatureRecord) => void): void;
}

const PHASES: readonly FramePhase[] = ['scene', 'camera', 'render', 'overlay'];
const MAX_UPDATE_THROWS = 3;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Boot step 4 (§6.2): resolve enabled set (override > ?debug for `debug` > defaultEnabled > true), cascade-disable
 * features whose `requires` are disabled/unknown, topologically sort. A dependency cycle throws.
 */
export function createFeatureManager(
  modules: readonly FeatureModule[],
  overrides: Readonly<Record<string, boolean>>,
  debug: boolean,
  warn: (msg: string) => void,
  onError: (msg: string) => void,
): FeatureManager {
  const byId = new Map<string, FeatureModule>();
  for (const m of modules) {
    if (byId.has(m.id)) throw new Error(`Duplicate feature id "${m.id}"`);
    byId.set(m.id, m);
  }
  for (const id of Object.keys(overrides)) if (!byId.has(id)) warn(`?features: unknown feature "${id}"`);

  const enabled = new Set<string>();
  for (const m of modules) if (overrides[m.id] ?? ((debug && m.id === 'debug') || (m.defaultEnabled ?? true))) enabled.add(m.id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of enabled) {
      const missing = byId.get(id)?.requires?.find((r) => !enabled.has(r));
      if (missing === undefined) continue;
      warn(`Feature "${id}" disabled: requires ${byId.has(missing) ? 'disabled' : 'unknown'} feature "${missing}"`);
      enabled.delete(id);
      changed = true;
    }
  }

  const order = topoSort([...enabled].sort(), (id) => byId.get(id)?.requires ?? []);
  const disabledIds = [...byId.keys()].filter((id) => !enabled.has(id)).sort();
  const records: FeatureRecord[] = [...order, ...disabledIds].map((id) => {
    const module = byId.get(id)!;
    return { module, id, phase: module.phase ?? 'scene', enabled: enabled.has(id), provides: [], disposers: [], throws: 0 };
  });
  const byPhase = new Map(PHASES.map((p) => [p, records.filter((r) => r.enabled && r.phase === p && r.module.update)]));

  function dispose(rec: FeatureRecord): void {
    try {
      rec.module.dispose?.();
    } catch (e) {
      onError(`${rec.id} dispose: ${message(e)}`);
    }
    for (let fn = rec.disposers.pop(); fn; fn = rec.disposers.pop()) {
      try {
        fn();
      } catch (e) {
        onError(`${rec.id} disposer: ${message(e)}`);
      }
    }
  }

  function disable(id: string, error?: string): void {
    const rec = records.find((r) => r.id === id);
    if (!rec?.enabled) return;
    rec.enabled = false;
    if (error !== undefined) rec.error = error;
    dispose(rec);
    for (const other of records) if (other.enabled && other.module.requires?.includes(id)) {
      warn(`Feature "${other.id}" disabled: requires failed feature "${id}"`);
      disable(other.id);
    }
  }

  function fail(rec: FeatureRecord, stage: string, e: unknown): void {
    const msg = `Feature "${rec.id}" ${stage} failed: ${message(e)}`;
    onError(msg);
    disable(rec.id, msg);
  }

  function scopedContext(base: AppContext, rec: FeatureRecord): FeatureContext {
    const addDisposer = (fn: () => void) => void rec.disposers.push(fn);
    const services: Services = {
      provide(key, impl) {
        const off = base.services.provide(key, impl);
        rec.provides.push(key.id);
        addDisposer(off);
        return off;
      },
      get: (key) => base.services.get(key),
      tryGet: (key) => base.services.tryGet(key),
    };
    return {
      ...base,
      services,
      featureId: rec.id,
      addDisposer,
      on(type, handler) {
        base.bus.on(type, handler);
        addDisposer(() => base.bus.off(type, handler));
      },
      watch(handler) {
        addDisposer(base.store.subscribe((state) => handler(state)));
      },
    };
  }

  return {
    records,
    contribute(registries) {
      for (const rec of records) {
        if (!rec.enabled || !rec.module.contribute) continue;
        try {
          rec.module.contribute(registries);
        } catch (e) {
          fail(rec, 'contribute', e);
        }
      }
    },
    async init(base, afterInit) {
      for (const rec of records) {
        if (!rec.enabled) continue; // a failed dependency may have disabled it meanwhile
        try {
          await rec.module.init?.(scopedContext(base, rec));
          afterInit?.(rec);
        } catch (e) {
          fail(rec, 'init', e);
        }
      }
    },
    update(phase, frame) {
      for (const rec of byPhase.get(phase)!) {
        if (!rec.enabled) continue;
        try {
          rec.module.update!(frame);
          rec.throws = 0;
        } catch (e) {
          if (++rec.throws >= MAX_UPDATE_THROWS) fail(rec, 'update', e);
          else onError(`Feature "${rec.id}" update threw: ${message(e)}`);
        }
      }
    },
    disable,
    disposeAll(beforeDispose) {
      for (let i = records.length - 1; i >= 0; i--) {
        const rec = records[i]!;
        if (!rec.enabled) continue;
        beforeDispose?.(rec);
        rec.enabled = false;
        dispose(rec);
      }
    },
  };
}

/** Kahn's algorithm, ready set kept alphabetical. `ids` sorted; requires outside `ids` are ignored. */
export function topoSort(ids: readonly string[], requires: (id: string) => readonly string[]): string[] {
  const inSet = new Set(ids);
  const pending = new Map(ids.map((id) => [id, requires(id).filter((r) => inSet.has(r)).length]));
  const ready = ids.filter((id) => pending.get(id) === 0);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const other of ids) {
      if (!requires(other).includes(id)) continue;
      const n = pending.get(other)! - 1;
      pending.set(other, n);
      if (n === 0) {
        ready.push(other);
        ready.sort();
      }
    }
  }
  if (order.length < ids.length) throw new Error(`Feature dependency cycle among: ${ids.filter((id) => !order.includes(id)).join(', ')}`);
  return order;
}
