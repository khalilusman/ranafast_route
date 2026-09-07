import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { learnedMappings, routes, sections, stops } from "../drizzle/schema";
import { eq, and, like, or, asc, gt, desc, sql } from "drizzle-orm";
import { z } from "zod";

function toLearnedMapping(row: typeof learnedMappings.$inferSelect) {
  return {
    id: row.id,
    routeId: row.routeId,
    stopId: row.stopId,
    originalTranscript: row.originalTranscript,
    normalizedTranscript: row.normalizedTranscript,
    firstConfirmedAt: row.firstConfirmedAt.getTime(),
    lastConfirmedAt: row.lastConfirmedAt.getTime(),
    confirmationCount: row.confirmationCount,
    tags: row.tags ?? [],
  };
}

// ── Route helpers ─────────────────────────────────────────────────────────────
// ── Demo Data Fallback for offline/local testing without MySQL DB ──────────────
const DEMO_ROUTE = {
  id: 1,
  name: "Maghery Delivery Route",
  description: "An Post delivery route — Maghery, Co. Donegal (Voice Test Enabled)",
  shareToken: "demo-share-token",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const DEMO_SECTIONS = [
  { id: 1, routeId: 1, position: 1, name: "Section 1: Lower Main St", boxNumber: 1 },
  { id: 2, routeId: 1, position: 2, name: "Section 2: Maghery Road", boxNumber: 2 },
];

const DEMO_STOPS = [
  {
    id: 1,
    sectionId: 1,
    routeId: 1,
    stopOrder: 1,
    residents: "John Ward | Mary Ward",
    aliases: "Johnny Ward",
    road: "Lower Main St",
    houseNumber: "12",
    houseName: null,
    businessName: null,
    eircode: "F94 A1B2",
    side: "Left",
    propertyType: "Residential",
    hasDog: false,
    safePlace: "Back Porch",
    notes: "Leave parcel behind gate",
    searchTags: "ward|john|mary",
    lat: null,
    lng: null,
  },
  {
    id: 2,
    sectionId: 1,
    routeId: 1,
    stopOrder: 2,
    residents: "Stevie McGowan | Patrick McGowan",
    aliases: "Paddy Mac | MacGowan",
    road: "Lower Main St",
    houseNumber: "14",
    houseName: null,
    businessName: null,
    eircode: "F94 C3D4",
    side: "Left",
    propertyType: "Residential",
    hasDog: true,
    safePlace: "Shed",
    notes: "Beware of dog",
    searchTags: "mcgowan|stevie|patrick",
    lat: null,
    lng: null,
  },
  {
    id: 3,
    sectionId: 1,
    routeId: 1,
    stopOrder: 3,
    residents: "Hugh Maghery | Sean Maghery",
    aliases: "McGarry House",
    road: "Lower Main St",
    houseNumber: "16",
    houseName: "Maghery House",
    businessName: null,
    eircode: "F94 E5F6",
    side: "Right",
    propertyType: "Residential",
    hasDog: false,
    safePlace: null,
    notes: null,
    searchTags: "maghery|mcgarry|hugh",
    lat: null,
    lng: null,
  },
  {
    id: 4,
    sectionId: 2,
    routeId: 1,
    stopOrder: 4,
    residents: "Arthur Smith",
    aliases: "Smyth Residence",
    road: "Maghery Road",
    houseNumber: "1",
    houseName: null,
    businessName: null,
    eircode: "F94 G7H8",
    side: "Left",
    propertyType: "Residential",
    hasDog: false,
    safePlace: "Garage",
    notes: null,
    searchTags: "smith|smyth|arthur",
    lat: null,
    lng: null,
  },
  {
    id: 5,
    sectionId: 2,
    routeId: 1,
    stopOrder: 5,
    residents: "Kelly's Pharmacy",
    aliases: "Chemist | Drugstore",
    road: "Maghery Road",
    houseNumber: "5",
    houseName: null,
    businessName: "Kelly's Pharmacy",
    eircode: "F94 J9K0",
    side: "Right",
    propertyType: "Commercial",
    hasDog: false,
    safePlace: "Counter",
    notes: "Deliver during opening hours (9-6)",
    searchTags: "kellys|pharmacy|chemist",
    lat: null,
    lng: null,
  },
  {
    id: 6,
    sectionId: 2,
    routeId: 1,
    stopOrder: 6,
    residents: "Patrick Doherty | James Doherty",
    aliases: "Dougherty Farm",
    road: "Maghery Road",
    houseNumber: "10",
    houseName: "Greenhill Farm",
    businessName: null,
    eircode: "F94 L1M2",
    side: "Left",
    propertyType: "Farm",
    hasDog: true,
    safePlace: "Milk Stand",
    notes: null,
    searchTags: "doherty|dougherty|patrick",
    lat: null,
    lng: null,
  },
];

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ── Corrections (shared learned-mapping cache) ───────────────────────────────
  // Public: same trust model as sections/stops/routes below — postmen record
  // and look up voice-search corrections without logging in.
  corrections: router({
    record: publicProcedure
      .input(z.object({
        routeId: z.number(),
        stopId: z.number(),
        originalTranscript: z.string().min(1),
        normalizedTranscript: z.string().min(1),
        tags: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        const now = new Date();
        await db
          .insert(learnedMappings)
          .values({
            routeId: input.routeId,
            stopId: input.stopId,
            originalTranscript: input.originalTranscript,
            normalizedTranscript: input.normalizedTranscript,
            firstConfirmedAt: now,
            lastConfirmedAt: now,
            confirmationCount: 1,
            tags: input.tags ?? [],
          })
          .onDuplicateKeyUpdate({
            set: {
              lastConfirmedAt: now,
              confirmationCount: sql`${learnedMappings.confirmationCount} + 1`,
            },
          });

        const [row] = await db
          .select()
          .from(learnedMappings)
          .where(
            and(
              eq(learnedMappings.routeId, input.routeId),
              eq(learnedMappings.stopId, input.stopId),
              eq(learnedMappings.normalizedTranscript, input.normalizedTranscript)
            )
          )
          .limit(1);

        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save correction" });
        return toLearnedMapping(row);
      }),

    lookup: publicProcedure
      .input(z.object({
        routeId: z.number(),
        normalizedTranscript: z.string().min(1),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;

        const rows = await db
          .select()
          .from(learnedMappings)
          .where(
            and(
              eq(learnedMappings.routeId, input.routeId),
              eq(learnedMappings.normalizedTranscript, input.normalizedTranscript)
            )
          );

        if (rows.length === 0) return null;

        const best = rows.reduce((a, b) => (a.confirmationCount > b.confirmationCount ? a : b));
        const confidence = Math.min(0.5 + best.confirmationCount * 0.1, 0.85);

        return {
          stopId: best.stopId,
          confidence,
          confirmationCount: best.confirmationCount,
          lastConfirmedAt: best.lastConfirmedAt.getTime(),
        };
      }),

    listForRoute: publicProcedure
      .input(z.object({ routeId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];

        const rows = await db
          .select()
          .from(learnedMappings)
          .where(eq(learnedMappings.routeId, input.routeId));

        return rows.map(toLearnedMapping).sort((a, b) => {
          if (b.confirmationCount !== a.confirmationCount) {
            return b.confirmationCount - a.confirmationCount;
          }
          return b.lastConfirmedAt - a.lastConfirmedAt;
        });
      }),

    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        await db.delete(learnedMappings).where(eq(learnedMappings.id, input.id));
        return { success: true } as const;
      }),

    clearForRoute: publicProcedure
      .input(z.object({ routeId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        await db.delete(learnedMappings).where(eq(learnedMappings.routeId, input.routeId));
        return { success: true } as const;
      }),
  }),

  // ── Sections ────────────────────────────────────────────────────────────────
  sections: router({
    list: publicProcedure
      .input(z.object({ routeId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(sections)
          .where(eq(sections.routeId, input.routeId))
          .orderBy(asc(sections.position));
      }),
  }),

  // ── Stops ───────────────────────────────────────────────────────────────────
  stops: router({
    listBySection: publicProcedure
      .input(z.object({ sectionId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(stops)
          .where(eq(stops.sectionId, input.sectionId))
          .orderBy(asc(stops.stopOrder));
      }),

    search: publicProcedure
      .input(z.object({
        sectionId: z.number(),
        query: z.string().min(1),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const q = `%${input.query}%`;
        return db
          .select()
          .from(stops)
          .where(
            and(
              eq(stops.sectionId, input.sectionId),
              or(
                like(stops.residents, q),
                like(stops.aliases, q),
                like(stops.searchTags, q),
                like(stops.road, q),
                like(stops.notes, q),
              )
            )
          )
          .orderBy(asc(stops.stopOrder));
      }),

    searchAll: publicProcedure
      .input(z.object({
        routeId: z.number(),
        query: z.string().min(1),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        const q = `%${input.query}%`;
        return db
          .select()
          .from(stops)
          .where(
            and(
              eq(stops.routeId, input.routeId),
              or(
                like(stops.residents, q),
                like(stops.aliases, q),
                like(stops.searchTags, q),
                like(stops.road, q),
                like(stops.notes, q),
              )
            )
          )
          .orderBy(asc(stops.stopOrder));
      }),

    listAll: publicProcedure
      .input(z.object({ routeId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(stops)
          .where(eq(stops.routeId, input.routeId))
          .orderBy(asc(stops.sectionId), asc(stops.stopOrder));
      }),

    reorder: protectedProcedure
    .input(z.object({
      sectionId: z.number(),
      orderedIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Update each stop's stopOrder based on its position in the array
      for (let i = 0; i < input.orderedIds.length; i++) {
        await db.update(stops)
          .set({ stopOrder: i + 1 })
          .where(and(eq(stops.id, input.orderedIds[i]!), eq(stops.sectionId, input.sectionId)));
      }
      return { success: true };
    }),

  add: protectedProcedure
    .input(z.object({
      sectionId: z.number(),
      routeId: z.number(),
      // If provided, insert after this stopOrder value (shifting subsequent stops up)
      insertAfterOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      let nextOrder: number;

      if (input.insertAfterOrder !== undefined) {
        // Shift all stops with stopOrder > insertAfterOrder up by 1
        const toShift = await db
          .select({ id: stops.id, stopOrder: stops.stopOrder })
          .from(stops)
          .where(
            and(
              eq(stops.sectionId, input.sectionId),
              gt(stops.stopOrder, input.insertAfterOrder)
            )
          )
          .orderBy(desc(stops.stopOrder));

        // Update in descending order to avoid unique constraint conflicts
        for (const s of toShift) {
          await db
            .update(stops)
            .set({ stopOrder: s.stopOrder + 1 })
            .where(eq(stops.id, s.id));
        }
        nextOrder = input.insertAfterOrder + 1;
      } else {
        // Append at end
        const existing = await db
          .select({ stopOrder: stops.stopOrder })
          .from(stops)
          .where(eq(stops.sectionId, input.sectionId))
          .orderBy(desc(stops.stopOrder))
          .limit(1);
        nextOrder = (existing[0]?.stopOrder ?? 0) + 1;
      }

      const inserted = await db.insert(stops).values({
        sectionId: input.sectionId,
        routeId: input.routeId,
        stopOrder: nextOrder,
        residents: null,
        aliases: null,
        road: null,
        houseNumber: null,
        houseName: null,
        businessName: null,
        eircode: null,
        side: null,
        propertyType: "Residential",
        hasDog: false,
        safePlace: null,
        notes: null,
        searchTags: null,
        lat: null,
        lng: null,
      }).$returningId();
      const insertedId = inserted[0]?.id;
      if (!insertedId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Insert failed" });
      const [newStop] = await db.select().from(stops).where(eq(stops.id, insertedId)).limit(1);
      return newStop;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      
      // Get the stop to find its section and stopOrder
      const [deletedStop] = await db.select().from(stops).where(eq(stops.id, input.id)).limit(1);
      if (!deletedStop) throw new TRPCError({ code: "NOT_FOUND", message: "Stop not found" });
      
      const { sectionId, stopOrder } = deletedStop;
      
      // Delete the stop
      await db.delete(stops).where(eq(stops.id, input.id));
      
      // Shift all subsequent stops down by 1
      const toShift = await db
        .select({ id: stops.id, stopOrder: stops.stopOrder })
        .from(stops)
        .where(
          and(
            eq(stops.sectionId, sectionId),
            gt(stops.stopOrder, stopOrder)
          )
        )
        .orderBy(asc(stops.stopOrder));
      
      for (const s of toShift) {
        await db
          .update(stops)
          .set({ stopOrder: s.stopOrder - 1 })
          .where(eq(stops.id, s.id));
      }
      
      return { success: true };
    }),

  update: protectedProcedure
      .input(z.object({
        id: z.number(),
        side: z.string().nullable().optional(),
        residents: z.string().nullable().optional(),
        aliases: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        safePlace: z.string().nullable().optional(),
        propertyType: z.string().nullable().optional(),
        hasDog: z.boolean().optional(),
        houseName: z.string().nullable().optional(),
        businessName: z.string().nullable().optional(),
        houseNumber: z.string().nullable().optional(),
        road: z.string().nullable().optional(),
        eircode: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const { id, ...fields } = input;
        // Only include defined fields in the update
        const updateData: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined) updateData[k] = v;
        }
        await db.update(stops).set(updateData).where(eq(stops.id, id));
        const rows = await db.select().from(stops).where(eq(stops.id, id)).limit(1);
        return rows[0] ?? null;
      }),
  }),

// ── Routes ──────────────────────────────────────────────────────────────────
routes: router({
  list: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [DEMO_ROUTE];
    const list = await db.select().from(routes).orderBy(asc(routes.name));
    return list.length > 0 ? list : [DEMO_ROUTE];
  }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return input.id === 1 ? DEMO_ROUTE : null;
      const rows = await db.select().from(routes).where(eq(routes.id, input.id)).limit(1);
      return rows[0] ?? (input.id === 1 ? DEMO_ROUTE : null);
    }),

  getDefault: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return DEMO_ROUTE;
    const rows = await db.select().from(routes).limit(1);
    return rows[0] ?? DEMO_ROUTE;
  }),

  getPublicSummary: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (db) {
        const routeRows = await db
          .select()
          .from(routes)
          .where(eq(routes.shareToken, input.token))
          .limit(1);
        const route = routeRows[0];
        if (route) {
          const sectionRows = await db
            .select()
            .from(sections)
            .where(eq(sections.routeId, route.id))
            .orderBy(asc(sections.position));

          const stopRows = await db
            .select()
            .from(stops)
            .where(eq(stops.routeId, route.id))
            .orderBy(asc(stops.stopOrder));

          return { route, sections: sectionRows, stops: stopRows };
        }
      }

      if (input.token === "demo-share-token") {
        return { route: DEMO_ROUTE, sections: DEMO_SECTIONS, stops: DEMO_STOPS };
      }

      return null;
    }),
}),
});

export type AppRouter = typeof appRouter;
