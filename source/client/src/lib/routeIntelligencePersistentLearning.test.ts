import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock the vanilla tRPC client so we can drive the server-first/fallback
// behavior deterministically without a real network or backend. Vitest hoists
// vi.mock factories above other module code, so the referenced variable must
// be prefixed with "mock" to be usable inside the factory. ──────────────────
const mockCorrections = {
  record: { mutate: vi.fn() },
  lookup: { query: vi.fn() },
  listForRoute: { query: vi.fn() },
  delete: { mutate: vi.fn() },
  clearForRoute: { mutate: vi.fn() },
};

vi.mock("./trpc", () => ({
  trpcVanilla: { corrections: mockCorrections },
}));

const corrections = mockCorrections;

// ── Minimal fake IndexedDB, just enough to back the module's local-cache
// fallback (put / delete / index.getAll / index.openCursor). ────────────────
function createFakeIndexedDB() {
  const store = new Map<number, any>();
  const request = () => ({ onsuccess: null as any, onerror: null as any, result: undefined as any });
  const resolve = (req: any, result: any) => {
    req.result = result;
    queueMicrotask(() => req.onsuccess?.({ target: req }));
  };
  const matches = (item: any, indexName: string, value: any) => {
    if (indexName === "routeId_stopId") {
      const [routeId, stopId] = value;
      return item.routeId === routeId && item.stopId === stopId;
    }
    return item[indexName] === value;
  };

  const fakeDb: any = {
    objectStoreNames: { contains: () => true },
    deleteObjectStore: () => {},
    createObjectStore: () => ({ createIndex: () => {} }),
    transaction: () => ({
      objectStore: () => ({
        put: (value: any) => {
          const req = request();
          store.set(value.id, value);
          resolve(req, value.id);
          return req;
        },
        delete: (id: number) => {
          const req = request();
          store.delete(id);
          resolve(req, undefined);
          return req;
        },
        index: (indexName: string) => ({
          getAll: (range?: { only: any }) => {
            const req = request();
            const all = Array.from(store.values());
            resolve(req, range ? all.filter(item => matches(item, indexName, range.only)) : all);
            return req;
          },
          openCursor: (range?: { only: any }) => {
            const req = request();
            const entries = Array.from(store.entries()).filter(([, item]) =>
              range ? matches(item, indexName, range.only) : true
            );
            let i = 0;
            const step = () => {
              if (i < entries.length) {
                const [key, value] = entries[i]!;
                req.result = {
                  value,
                  delete: () => store.delete(key),
                  continue: () => {
                    i++;
                    queueMicrotask(() => req.onsuccess?.({ target: req }));
                  },
                };
              } else {
                req.result = null;
              }
              queueMicrotask(() => req.onsuccess?.({ target: req }));
            };
            step();
            return req;
          },
        }),
      }),
    }),
  };

  return {
    open: () => {
      const req: any = { onsuccess: null, onerror: null, onupgradeneeded: null, result: fakeDb };
      queueMicrotask(() => {
        req.onupgradeneeded?.({ target: { result: fakeDb } });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}

(globalThis as any).IDBKeyRange = {
  only: (value: any) => ({ only: value }),
};

describe("routeIntelligencePersistentLearning", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as any).indexedDB = createFakeIndexedDB();
    // Force a fresh IndexedDB connection (and thus a fresh in-memory store) per test.
    vi.resetModules();
  });

  describe("recordCorrection (server-first)", () => {
    it("saves via the server and returns its response", async () => {
      const { recordCorrection } = await import("./routeIntelligencePersistentLearning");
      const serverMapping = {
        id: 42,
        routeId: 1,
        stopId: 10,
        originalTranscript: "Michael",
        normalizedTranscript: "michael",
        firstConfirmedAt: 1000,
        lastConfirmedAt: 1000,
        confirmationCount: 1,
        tags: ["pronunciation"],
      };
      corrections.record.mutate.mockResolvedValue(serverMapping);

      const result = await recordCorrection(1, 10, "Michael", "michael", ["pronunciation"]);

      expect(corrections.record.mutate).toHaveBeenCalledWith({
        routeId: 1,
        stopId: 10,
        originalTranscript: "Michael",
        normalizedTranscript: "michael",
        tags: ["pronunciation"],
      });
      expect(result).toEqual(serverMapping);
    });

    it("falls back to the local cache when the server request fails", async () => {
      const { recordCorrection, lookupLearnedMapping } = await import(
        "./routeIntelligencePersistentLearning"
      );
      corrections.record.mutate.mockRejectedValue(new Error("network down"));
      corrections.lookup.query.mockRejectedValue(new Error("network down"));

      const mapping = await recordCorrection(1, 10, "Michael", "michael");

      expect(mapping.routeId).toBe(1);
      expect(mapping.stopId).toBe(10);
      expect(mapping.confirmationCount).toBe(1);

      // The local fallback should now be able to find it too.
      const result = await lookupLearnedMapping(1, "michael");
      expect(result?.stopId).toBe(10);
      expect(result?.confirmationCount).toBe(1);
    });

    it("increments confirmation count on a repeated offline correction", async () => {
      const { recordCorrection } = await import("./routeIntelligencePersistentLearning");
      corrections.record.mutate.mockRejectedValue(new Error("network down"));

      const first = await recordCorrection(1, 10, "Michael", "michael");
      const second = await recordCorrection(1, 10, "Michael", "michael");

      expect(second.confirmationCount).toBe(2);
      expect(second.firstConfirmedAt).toBe(first.firstConfirmedAt);
    });
  });

  describe("lookupLearnedMapping (server-first)", () => {
    it("returns the server result", async () => {
      const { lookupLearnedMapping } = await import("./routeIntelligencePersistentLearning");
      corrections.lookup.query.mockResolvedValue({
        stopId: 10,
        confidence: 0.6,
        confirmationCount: 1,
        lastConfirmedAt: 1000,
      });

      const result = await lookupLearnedMapping(1, "michael");

      expect(corrections.lookup.query).toHaveBeenCalledWith({
        routeId: 1,
        normalizedTranscript: "michael",
      });
      expect(result?.stopId).toBe(10);
    });

    it("treats a null server response (no mapping found) as authoritative", async () => {
      const { lookupLearnedMapping } = await import("./routeIntelligencePersistentLearning");
      corrections.lookup.query.mockResolvedValue(null);

      const result = await lookupLearnedMapping(1, "nonexistent");

      expect(result).toBeNull();
    });

    it("falls back to the local cache when the server request fails", async () => {
      const { recordCorrection, lookupLearnedMapping } = await import(
        "./routeIntelligencePersistentLearning"
      );
      corrections.record.mutate.mockRejectedValue(new Error("network down"));
      await recordCorrection(1, 10, "Michael", "michael");

      corrections.lookup.query.mockRejectedValue(new Error("network down"));
      const result = await lookupLearnedMapping(1, "michael");

      expect(result?.stopId).toBe(10);
    });
  });

  describe("getAllLearnedMappingsForRoute (server-first)", () => {
    it("returns the server list", async () => {
      const { getAllLearnedMappingsForRoute } = await import(
        "./routeIntelligencePersistentLearning"
      );
      const serverMappings = [
        { id: 1, routeId: 1, stopId: 10, originalTranscript: "Michael", normalizedTranscript: "michael", firstConfirmedAt: 1, lastConfirmedAt: 1, confirmationCount: 2, tags: [] },
      ];
      corrections.listForRoute.query.mockResolvedValue(serverMappings);

      const result = await getAllLearnedMappingsForRoute(1);

      expect(corrections.listForRoute.query).toHaveBeenCalledWith({ routeId: 1 });
      expect(result).toEqual(serverMappings);
    });

    it("falls back to the local cache when the server request fails", async () => {
      const { recordCorrection, getAllLearnedMappingsForRoute } = await import(
        "./routeIntelligencePersistentLearning"
      );
      corrections.record.mutate.mockRejectedValue(new Error("network down"));
      await recordCorrection(1, 10, "Michael", "michael");
      await recordCorrection(1, 20, "Patrick", "patrick");

      corrections.listForRoute.query.mockRejectedValue(new Error("network down"));
      const result = await getAllLearnedMappingsForRoute(1);

      expect(result.length).toBe(2);
      expect(result.map(m => m.stopId).sort()).toEqual([10, 20]);
    });
  });

  describe("deleteLearnedMapping / clearLearnedMappingsForRoute", () => {
    it("deletes via the server", async () => {
      const { deleteLearnedMapping } = await import("./routeIntelligencePersistentLearning");
      corrections.delete.mutate.mockResolvedValue({ success: true });

      await deleteLearnedMapping(42);

      expect(corrections.delete.mutate).toHaveBeenCalledWith({ id: 42 });
    });

    it("propagates a server error instead of silently succeeding", async () => {
      const { deleteLearnedMapping } = await import("./routeIntelligencePersistentLearning");
      corrections.delete.mutate.mockRejectedValue(new Error("network down"));

      await expect(deleteLearnedMapping(42)).rejects.toThrow("network down");
    });

    it("clears via the server", async () => {
      const { clearLearnedMappingsForRoute } = await import("./routeIntelligencePersistentLearning");
      corrections.clearForRoute.mutate.mockResolvedValue({ success: true });

      await clearLearnedMappingsForRoute(1);

      expect(corrections.clearForRoute.mutate).toHaveBeenCalledWith({ routeId: 1 });
    });
  });

  describe("getLearnedMappingsStats", () => {
    it("derives stats from the (server-backed) mapping list", async () => {
      const { getLearnedMappingsStats } = await import("./routeIntelligencePersistentLearning");
      corrections.listForRoute.query.mockResolvedValue([
        { id: 1, routeId: 1, stopId: 10, originalTranscript: "Michael", normalizedTranscript: "michael", firstConfirmedAt: 1, lastConfirmedAt: 1, confirmationCount: 2, tags: [] },
        { id: 2, routeId: 1, stopId: 20, originalTranscript: "Patrick", normalizedTranscript: "patrick", firstConfirmedAt: 1, lastConfirmedAt: 1, confirmationCount: 1, tags: [] },
      ]);

      const stats = await getLearnedMappingsStats(1);

      expect(stats.totalMappings).toBe(2);
      expect(stats.totalConfirmations).toBe(3);
      expect(stats.mostConfirmedTranscript).toBe("michael");
      expect(stats.mostConfirmedCount).toBe(2);
    });

    it("returns zero stats when no mappings exist", async () => {
      const { getLearnedMappingsStats } = await import("./routeIntelligencePersistentLearning");
      corrections.listForRoute.query.mockResolvedValue([]);

      const stats = await getLearnedMappingsStats(1);

      expect(stats.totalMappings).toBe(0);
      expect(stats.totalConfirmations).toBe(0);
      expect(stats.mostConfirmedTranscript).toBeNull();
      expect(stats.mostConfirmedCount).toBe(0);
    });
  });
});
