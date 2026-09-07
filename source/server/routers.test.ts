import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { COOKIE_NAME } from "../shared/const";

// ── Minimal mock context ──────────────────────────────────────────────────────
function makeCtx(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    ...overrides,
  };
}

// ── Mock DB so tests don't need a live database ───────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

describe("auth.logout", () => {
  it("clears the session cookie and returns success", async () => {
    const clearedCookies: Array<{ name: string; opts: Record<string, unknown> }> = [];
    const ctx = makeCtx({
      user: {
        id: 1,
        openId: "test-user",
        email: "test@example.com",
        name: "Test User",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      res: {
        clearCookie: (name: string, opts: Record<string, unknown>) => {
          clearedCookies.push({ name, opts });
        },
      } as unknown as TrpcContext["res"],
    });

    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.opts).toMatchObject({ maxAge: -1 });
  });
});

describe("auth.me", () => {
  it("returns null when not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });
});

describe("sections.list", () => {
  it("returns empty array when DB is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.sections.list({ routeId: 1 });
    expect(result).toEqual([]);
  });
});

describe("stops.listBySection", () => {
  it("returns empty array when DB is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.stops.listBySection({ sectionId: 1 });
    expect(result).toEqual([]);
  });
});

describe("stops.search", () => {
  it("returns empty array when DB is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.stops.search({ sectionId: 1, query: "Gallagher" });
    expect(result).toEqual([]);
  });
});

describe("corrections.lookup", () => {
  it("returns null when DB is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.corrections.lookup({
      routeId: 1,
      normalizedTranscript: "michael",
    });
    expect(result).toBeNull();
  });
});

describe("corrections.listForRoute", () => {
  it("returns empty array when DB is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.corrections.listForRoute({ routeId: 1 });
    expect(result).toEqual([]);
  });
});

describe("corrections.record", () => {
  it("is public (no auth required) but throws when DB is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.corrections.record({
        routeId: 1,
        stopId: 10,
        originalTranscript: "Michael",
        normalizedTranscript: "michael",
      })
    ).rejects.toThrow("DB unavailable");
  });

  it("rejects an empty normalizedTranscript", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.corrections.record({
        routeId: 1,
        stopId: 10,
        originalTranscript: "Michael",
        normalizedTranscript: "",
      })
    ).rejects.toThrow();
  });
});

describe("corrections.delete", () => {
  it("throws UNAUTHORIZED when not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.corrections.delete({ id: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws DB error when DB unavailable but user is authenticated", async () => {
    const ctx = makeCtx({
      user: {
        id: 1,
        openId: "owner",
        email: "owner@example.com",
        name: "Owner",
        loginMethod: "manus",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.corrections.delete({ id: 1 })).rejects.toThrow("DB unavailable");
  });
});

describe("corrections.clearForRoute", () => {
  it("throws UNAUTHORIZED when not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.corrections.clearForRoute({ routeId: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws DB error when DB unavailable but user is authenticated", async () => {
    const ctx = makeCtx({
      user: {
        id: 1,
        openId: "owner",
        email: "owner@example.com",
        name: "Owner",
        loginMethod: "manus",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.corrections.clearForRoute({ routeId: 1 })).rejects.toThrow(
      "DB unavailable"
    );
  });
});

describe("routes.getPublicSummary", () => {
  it("returns null for unknown token when DB is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.routes.getPublicSummary({ token: "invalid-token" });
    expect(result).toBeNull();
  });
});

describe("stops.update", () => {
  it("throws UNAUTHORIZED when not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.stops.update({ id: 1, notes: "Test note" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws DB error when DB unavailable but user is authenticated", async () => {
    const ctx = makeCtx({
      user: {
        id: 1,
        openId: "owner",
        email: "owner@example.com",
        name: "Owner",
        loginMethod: "manus",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.stops.update({ id: 1, notes: "Test note" })
    ).rejects.toThrow("DB unavailable");
  });
});

describe("stops.add", () => {
  it("throws UNAUTHORIZED when not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.stops.add({ sectionId: 1, routeId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("throws DB error when DB unavailable but user is authenticated", async () => {
    const ctx = makeCtx({
      user: {
        id: 1,
        openId: "owner",
        email: "owner@example.com",
        name: "Owner",
        loginMethod: "manus",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.stops.add({ sectionId: 1, routeId: 1 })
    ).rejects.toThrow("DB unavailable");
  });

  it("throws DB error when inserting with insertAfterOrder and DB unavailable", async () => {
    const ctx = makeCtx({
      user: {
        id: 1,
        openId: "owner",
        email: "owner@example.com",
        name: "Owner",
        loginMethod: "manus",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
    });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.stops.add({ sectionId: 1, routeId: 1, insertAfterOrder: 3 })
    ).rejects.toThrow("DB unavailable");
  });
});

describe("stops.delete", () => {
  it("throws UNAUTHORIZED when not authenticated", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.stops.delete({ id: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
