/** Transactional, persistent storage double: concurrent transactions run serially. */
interface MemoryStorage {
 get<T>(key: string): Promise<T | undefined>;
 put(key: string, value: unknown): Promise<void>;
 delete(key: string): Promise<boolean>;
 transaction<T>(fn: (txn: MemoryStorage) => Promise<T>): Promise<T>;
}
export function memoryState() {
  const data = new Map<string, unknown>();
  let pending = Promise.resolve();
  const storage: MemoryStorage = {
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
    delete: async (key: string) => data.delete(key),
    transaction: <T>(fn: (txn: MemoryStorage) => Promise<T>): Promise<T> => {
      const next = pending.then(() => fn(storage));
      pending = next.then(() => {}, () => {});
      return next;
    },
  };
  let blocked = Promise.resolve();
  const blockConcurrencyWhile = <T>(fn: () => Promise<T>): Promise<T> => { const next = blocked.then(fn); blocked = next.then(() => {}, () => {}); return next; };
  return { state: { storage, blockConcurrencyWhile } as unknown as DurableObjectState, data };
}
