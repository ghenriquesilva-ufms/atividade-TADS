export class CacheStore {
  constructor({ ttlMs, staleTtlMs }) {
    this.ttlMs = ttlMs;
    this.staleTtlMs = staleTtlMs;
    this.store = new Map();
  }

  set(key, value) {
    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + this.ttlMs,
      staleExpiresAt: now + this.staleTtlMs
    });
  }

  getFresh(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt < Date.now()) {
      return null;
    }

    return entry.value;
  }

  getStale(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (entry.staleExpiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }
}
