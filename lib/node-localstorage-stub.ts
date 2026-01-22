// Browser-safe stub for node-localstorage used by privacycash SDK
// Provides minimal getItem/setItem/removeItem backed by window.localStorage when available.

type Value = string | null;

class MemoryStore {
  private store = new Map<string, string>();
  getItem(key: string): Value {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

export class LocalStorage {
  private memory = new MemoryStore();
  constructor(_path?: string) {}

  private get backend() {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    return this.memory;
  }

  getItem(key: string): Value {
    return this.backend.getItem(key);
  }

  setItem(key: string, value: string) {
    this.backend.setItem(key, value);
  }

  removeItem(key: string) {
    this.backend.removeItem(key);
  }
}

export default LocalStorage;
