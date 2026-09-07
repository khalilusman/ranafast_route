/**
 * Persistent Learning System for Route Intelligence
 *
 * Stores explicit user corrections (speech transcript → stop ID) with confirmation counts.
 * The server (`corrections` tRPC router) is the source of truth, so corrections sync
 * across every postman/device on a route. IndexedDB is kept only as a local cache that
 * this module falls back to when a network request fails (e.g. no signal in the field).
 *
 * Learning is triggered ONLY when:
 * 1. Voice search finds no exact match (level 0 or low confidence)
 * 2. User manually selects a stop from the results
 * 3. System records: original transcript, normalized transcript, stop ID, route ID, timestamp
 *
 * On future searches:
 * 1. Check learned mappings first (highest priority)
 * 2. If no learned mapping, run fuzzy matching
 * 3. Learned mappings are separate from the permanent route dictionary
 */

import { trpcVanilla } from "./trpc";

export interface LearnedMapping {
  id: number;
  routeId: number;
  stopId: number;
  originalTranscript: string; // Raw speech-to-text output
  normalizedTranscript: string; // Normalized for comparison
  firstConfirmedAt: number; // Timestamp (ms)
  lastConfirmedAt: number; // Timestamp (ms)
  confirmationCount: number; // How many times user confirmed this mapping
  tags?: string[]; // Optional: "pronunciation", "abbreviation", "alias", etc.
}

export interface LearnedMappingLookupResult {
  stopId: number;
  confidence: number; // 0-1, based on confirmationCount
  confirmationCount: number;
  lastConfirmedAt: number;
}

const DB_NAME = "RouteIntelligence";
const DB_VERSION = 2;
const STORE_NAME = "learnedMappings";

// Local-only fallback records (created while offline) get negative ids so they
// never collide with a real server-assigned (positive, autoincrement) id. A
// monotonic counter (rather than -Date.now()) keeps ids unique even when two
// corrections are recorded within the same millisecond.
let localIdCounter = 0;
function localOnlyId(): number {
  localIdCounter -= 1;
  return localIdCounter;
}

/**
 * Initialize IndexedDB and create schema if needed
 */
export async function initializeLearningDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }

      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("routeId", "routeId", { unique: false });
      store.createIndex("stopId", "stopId", { unique: false });
      store.createIndex("normalizedTranscript", "normalizedTranscript", {
        unique: false,
      });
      store.createIndex("routeId_stopId", ["routeId", "stopId"], {
        unique: false,
      });
    };
  });
}

// ── Local IndexedDB helpers (offline cache / fallback only) ──────────────────

async function cacheMappingLocally(mapping: LearnedMapping): Promise<void> {
  const db = await initializeLearningDB();
  return new Promise((resolve, reject) => {
    const store = db.transaction([STORE_NAME], "readwrite").objectStore(STORE_NAME);
    const request = store.put(mapping);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function cacheMappingsLocally(mappings: LearnedMapping[]): Promise<void> {
  if (mappings.length === 0) return;
  const db = await initializeLearningDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    mappings.forEach(mapping => store.put(mapping));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function recordCorrectionLocally(
  routeId: number,
  stopId: number,
  originalTranscript: string,
  normalizedTranscript: string,
  tags?: string[]
): Promise<LearnedMapping> {
  const db = await initializeLearningDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("normalizedTranscript");

    const query = IDBKeyRange.only(normalizedTranscript);
    const findRequest = index.getAll(query);

    findRequest.onsuccess = () => {
      const existing = findRequest.result.find(
        (m: LearnedMapping) => m.routeId === routeId && m.stopId === stopId
      );

      const now = Date.now();
      let mapping: LearnedMapping;

      if (existing) {
        mapping = {
          ...existing,
          lastConfirmedAt: now,
          confirmationCount: existing.confirmationCount + 1,
        };
      } else {
        mapping = {
          id: localOnlyId(),
          routeId,
          stopId,
          originalTranscript,
          normalizedTranscript,
          firstConfirmedAt: now,
          lastConfirmedAt: now,
          confirmationCount: 1,
          tags: tags || [],
        };
      }

      const putRequest = store.put(mapping);
      putRequest.onsuccess = () => resolve(mapping);
      putRequest.onerror = () => reject(putRequest.error);
    };

    findRequest.onerror = () => reject(findRequest.error);
  });
}

async function lookupLearnedMappingLocally(
  routeId: number,
  normalizedTranscript: string
): Promise<LearnedMappingLookupResult | null> {
  const db = await initializeLearningDB();

  return new Promise((resolve, reject) => {
    const store = db.transaction([STORE_NAME], "readonly").objectStore(STORE_NAME);
    const index = store.index("normalizedTranscript");

    const query = IDBKeyRange.only(normalizedTranscript);
    const request = index.getAll(query);

    request.onsuccess = () => {
      const mappings = request.result.filter(
        (m: LearnedMapping) => m.routeId === routeId
      );

      if (mappings.length === 0) {
        resolve(null);
        return;
      }

      const best = mappings.reduce((a: LearnedMapping, b: LearnedMapping) =>
        a.confirmationCount > b.confirmationCount ? a : b
      );

      const confidence = Math.min(0.5 + best.confirmationCount * 0.1, 0.85);

      resolve({
        stopId: best.stopId,
        confidence,
        confirmationCount: best.confirmationCount,
        lastConfirmedAt: best.lastConfirmedAt,
      });
    };

    request.onerror = () => reject(request.error);
  });
}

async function getAllLearnedMappingsForRouteLocally(
  routeId: number
): Promise<LearnedMapping[]> {
  const db = await initializeLearningDB();

  return new Promise((resolve, reject) => {
    const store = db.transaction([STORE_NAME], "readonly").objectStore(STORE_NAME);
    const index = store.index("routeId");

    const query = IDBKeyRange.only(routeId);
    const request = index.getAll(query);

    request.onsuccess = () => {
      const mappings = request.result as LearnedMapping[];
      mappings.sort((a, b) => {
        if (b.confirmationCount !== a.confirmationCount) {
          return b.confirmationCount - a.confirmationCount;
        }
        return b.lastConfirmedAt - a.lastConfirmedAt;
      });
      resolve(mappings);
    };

    request.onerror = () => reject(request.error);
  });
}

async function deleteLearnedMappingLocally(mappingId: number): Promise<void> {
  const db = await initializeLearningDB();

  return new Promise((resolve, reject) => {
    const store = db.transaction([STORE_NAME], "readwrite").objectStore(STORE_NAME);
    const request = store.delete(mappingId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearLearnedMappingsForRouteLocally(routeId: number): Promise<void> {
  const db = await initializeLearningDB();

  return new Promise((resolve, reject) => {
    const store = db.transaction([STORE_NAME], "readwrite").objectStore(STORE_NAME);
    const index = store.index("routeId");

    const query = IDBKeyRange.only(routeId);
    const request = index.openCursor(query);

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };

    request.onerror = () => reject(request.error);
  });
}

// ── Public API: server is the source of truth, IndexedDB is the fallback ────

/**
 * Record a user correction: when user manually selects a stop after no exact match.
 * Saves to the server first (so it syncs to every device on the route); if that
 * request fails, falls back to the local IndexedDB cache.
 */
export async function recordCorrection(
  routeId: number,
  stopId: number,
  originalTranscript: string,
  normalizedTranscript: string,
  tags?: string[]
): Promise<LearnedMapping> {
  try {
    const mapping = await trpcVanilla.corrections.record.mutate({
      routeId,
      stopId,
      originalTranscript,
      normalizedTranscript,
      tags,
    });
    cacheMappingLocally(mapping).catch(err =>
      console.warn("[Learning] Failed to cache correction locally:", err)
    );
    return mapping;
  } catch (error) {
    console.warn("[Learning] Server record failed, falling back to local cache:", error);
    return recordCorrectionLocally(routeId, stopId, originalTranscript, normalizedTranscript, tags);
  }
}

/**
 * Look up a learned mapping for a given normalized transcript and route.
 * A `null` server response (no mapping found) is authoritative and returned
 * as-is; only a failed request falls back to the local cache.
 */
export async function lookupLearnedMapping(
  routeId: number,
  normalizedTranscript: string
): Promise<LearnedMappingLookupResult | null> {
  try {
    return await trpcVanilla.corrections.lookup.query({ routeId, normalizedTranscript });
  } catch (error) {
    console.warn("[Learning] Server lookup failed, falling back to local cache:", error);
    return lookupLearnedMappingLocally(routeId, normalizedTranscript);
  }
}

/**
 * Get all learned mappings for a specific route (for admin inspection).
 */
export async function getAllLearnedMappingsForRoute(
  routeId: number
): Promise<LearnedMapping[]> {
  try {
    const mappings = await trpcVanilla.corrections.listForRoute.query({ routeId });
    cacheMappingsLocally(mappings).catch(err =>
      console.warn("[Learning] Failed to cache mappings locally:", err)
    );
    return mappings;
  } catch (error) {
    console.warn("[Learning] Server listForRoute failed, falling back to local cache:", error);
    return getAllLearnedMappingsForRouteLocally(routeId);
  }
}

/**
 * Delete a learned mapping (for admin cleanup).
 */
export async function deleteLearnedMapping(mappingId: number): Promise<void> {
  await trpcVanilla.corrections.delete.mutate({ id: mappingId });
  await deleteLearnedMappingLocally(mappingId).catch(err =>
    console.warn("[Learning] Failed to delete cached copy locally:", err)
  );
}

/**
 * Clear all learned mappings for a specific route (for testing/reset).
 */
export async function clearLearnedMappingsForRoute(routeId: number): Promise<void> {
  await trpcVanilla.corrections.clearForRoute.mutate({ routeId });
  await clearLearnedMappingsForRouteLocally(routeId).catch(err =>
    console.warn("[Learning] Failed to clear cached copies locally:", err)
  );
}

/**
 * Get statistics about learned mappings for a route
 */
export async function getLearnedMappingsStats(routeId: number): Promise<{
  totalMappings: number;
  totalConfirmations: number;
  mostConfirmedTranscript: string | null;
  mostConfirmedCount: number;
}> {
  const mappings = await getAllLearnedMappingsForRoute(routeId);

  const totalConfirmations = mappings.reduce(
    (sum, m) => sum + m.confirmationCount,
    0
  );
  const mostConfirmed = mappings[0];

  return {
    totalMappings: mappings.length,
    totalConfirmations,
    mostConfirmedTranscript: mostConfirmed?.normalizedTranscript || null,
    mostConfirmedCount: mostConfirmed?.confirmationCount || 0,
  };
}
