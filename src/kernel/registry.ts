import type { Registries, Registry } from '../contracts/app';

export function createRegistry<T extends { readonly id: string }>(kind: string): Registry<T> {
  const items = new Map<string, T>();
  return {
    register(item) {
      if (items.has(item.id)) throw new Error(`Duplicate ${kind} "${item.id}"`);
      items.set(item.id, item);
      return () => {
        if (items.get(item.id) === item) items.delete(item.id);
      };
    },
    get: (id) => items.get(id),
    require(id) {
      const item = items.get(id);
      if (!item) throw new Error(`Unknown ${kind} "${id}". Known: ${[...items.keys()].join(', ')}`);
      return item;
    },
    list: () => [...items.values()],
  };
}

export function createRegistries(): Registries {
  return {
    suspensions: createRegistry('suspension'),
    vehicles: createRegistry('vehicle'),
    tracks: createRegistry('track'),
    vehicleVisuals: createRegistry('vehicle visual'),
    suspensionVisuals: createRegistry('suspension visual'),
  };
}
