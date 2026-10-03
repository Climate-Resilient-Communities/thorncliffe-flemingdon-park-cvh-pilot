// An in-memory Cache Storage for the service worker's unit tests (worker.test.ts, support.test.ts): enough of the browser's
// CacheStorage and Cache to store, match, list and delete by URL, and to fail on demand (a store that is full or blocked).

type Stored = { body: ArrayBuffer; status: number; headers: [string, string][] };

const urlOf = (request: RequestInfo | URL) => (typeof request === "string" ? request : request instanceof URL ? request.href : request.url);

export class FakeCache {
  readonly entries = new Map<string, Stored>();
  /** Set to make every put fail, like a full store. */
  failPuts = false;

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const stored = this.entries.get(urlOf(request));
    return stored ? new Response(stored.body.slice(0), { status: stored.status, headers: stored.headers }) : undefined;
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    if (this.failPuts) throw new DOMException("The store is full", "QuotaExceededError");
    const body = await response.arrayBuffer();
    this.entries.set(urlOf(request), { body, status: response.status, headers: [...response.headers.entries()] });
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(urlOf(request));
  }
}

export class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  /** Set to make every open fail, like a browser that blocks storage. */
  blocked = false;
  failPuts = false;

  async open(name: string): Promise<FakeCache> {
    if (this.blocked) throw new DOMException("Storage is blocked", "SecurityError");
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.stores.set(name, cache);
    }
    cache.failPuts = this.failPuts;
    return cache;
  }

  async keys(): Promise<string[]> {
    if (this.blocked) throw new DOMException("Storage is blocked", "SecurityError");
    return [...this.stores.keys()];
  }

  async has(name: string): Promise<boolean> {
    return this.stores.has(name);
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    for (const cache of this.stores.values()) {
      const found = await cache.match(request);
      if (found) return found;
    }
    return undefined;
  }

  /** Every URL stored in any cache, as `cache name: url`. */
  everything(): string[] {
    return [...this.stores].flatMap(([name, cache]) => [...cache.entries.keys()].map((url) => `${name}: ${url}`));
  }

  /** As the browser's CacheStorage, for code typed against it. */
  get asCacheStorage(): CacheStorage {
    return this as unknown as CacheStorage;
  }
}
