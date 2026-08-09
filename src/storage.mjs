/**
 * Persistence layer.
 *
 * The rest of the app only ever talks to a `Repository`, and a repository only
 * ever talks to an *adapter* with three async methods: read/write/clear.
 * Today the adapter is localStorage. To move The Barn onto a shared backend,
 * write a second adapter (below, commented) and pass it to `createRepository`.
 * No view code or domain rule has to change.
 */

export const STORAGE_KEY = 'the-barn-inventory/v1';

/* ------------------------------------------------------------------ *
 * Adapters
 * ------------------------------------------------------------------ */

export function createLocalStorageAdapter(key = STORAGE_KEY, storage = globalThis.localStorage) {
  return {
    name: 'localStorage',
    async read() {
      if (!storage) return null;
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    },
    async write(value) {
      if (!storage) return;
      storage.setItem(key, JSON.stringify(value));
    },
    async clear() {
      if (!storage) return;
      storage.removeItem(key);
    },
  };
}

/** In-memory fallback for private-mode browsers and for tests. */
export function createMemoryAdapter(initial = null) {
  let value = initial;
  return {
    name: 'memory',
    async read() { return value; },
    async write(next) { value = next; },
    async clear() { value = null; },
  };
}

/*
 * Future shared backend — drop in when credentials exist:
 *
 * export function createApiAdapter(baseUrl, token) {
 *   const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
 *   return {
 *     name: 'api',
 *     async read()        { const r = await fetch(`${baseUrl}/state`, { headers }); return r.ok ? r.json() : null; },
 *     async write(value)  { await fetch(`${baseUrl}/state`, { method: 'PUT', headers, body: JSON.stringify(value) }); },
 *     async clear()       { await fetch(`${baseUrl}/state`, { method: 'DELETE', headers }); },
 *   };
 * }
 */

/** Picks localStorage when it actually works, otherwise degrades to memory. */
export function defaultAdapter() {
  try {
    const probe = '__barn_probe__';
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return createLocalStorageAdapter();
  } catch {
    return createMemoryAdapter();
  }
}

/* ------------------------------------------------------------------ *
 * Repository
 * ------------------------------------------------------------------ */

export function createRepository(adapter = defaultAdapter()) {
  let pending = null;
  let queued = null;

  async function flush(state) {
    try {
      await adapter.write(state);
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      pending = null;
      if (queued) {
        const next = queued;
        queued = null;
        pending = flush(next);
      }
    }
  }

  return {
    name: adapter.name,

    async load() {
      try {
        return await adapter.read();
      } catch {
        return null;
      }
    },

    /** Coalesces rapid saves so a fast count doesn't thrash storage. */
    save(state) {
      if (pending) {
        queued = state;
        return pending;
      }
      pending = flush(state);
      return pending;
    },

    async clear() {
      await adapter.clear();
    },
  };
}
