import type { ServiceKey, Services } from '../contracts/app';

export function createServices(): Services {
  const impls = new Map<string, unknown>();
  return {
    provide<T>(key: ServiceKey<T>, impl: T) {
      if (impls.has(key.id)) throw new Error(`Service "${key.id}" is already provided`);
      impls.set(key.id, impl);
      return () => {
        if (impls.get(key.id) === impl) impls.delete(key.id);
      };
    },
    get<T>(key: ServiceKey<T>) {
      if (!impls.has(key.id)) throw new Error(`Service "${key.id}" is not provided (is its feature enabled?)`);
      return impls.get(key.id) as T;
    },
    tryGet: <T>(key: ServiceKey<T>) => impls.get(key.id) as T | undefined,
  };
}
