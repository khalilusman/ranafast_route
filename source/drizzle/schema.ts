import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Route ────────────────────────────────────────────────────────────────────
export const routes = mysqlTable("routes", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  shareToken: varchar("shareToken", { length: 64 }).unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Route = typeof routes.$inferSelect;
export type InsertRoute = typeof routes.$inferInsert;

// ─── Section ──────────────────────────────────────────────────────────────────
export const sections = mysqlTable("sections", {
  id: int("id").autoincrement().primaryKey(),
  routeId: int("routeId").notNull(),
  position: int("position").notNull(), // box number / display order
  name: varchar("name", { length: 255 }).notNull(),
  boxNumber: int("boxNumber").notNull(),
});

export type Section = typeof sections.$inferSelect;
export type InsertSection = typeof sections.$inferInsert;

// ─── Stop ─────────────────────────────────────────────────────────────────────
export const stops = mysqlTable("stops", {
  id: int("id").autoincrement().primaryKey(),
  sectionId: int("sectionId").notNull(),
  routeId: int("routeId").notNull(),
  stopOrder: int("stopOrder").notNull(),
  propertyType: varchar("propertyType", { length: 64 }),
  side: varchar("side", { length: 8 }),        // L / R / ""
  road: varchar("road", { length: 255 }),
  houseName: varchar("houseName", { length: 255 }),  // Address / House Name (e.g. Seaview, Tigh Mháire)
  businessName: varchar("businessName", { length: 255 }),  // Primary callback target for business stops
  houseNumber: varchar("houseNumber", { length: 64 }),
  eircode: varchar("eircode", { length: 16 }),
  // Pipe-separated strings stored as TEXT
  residents: text("residents"),                 // "James McCullagh | Fr. Michael McCullagh"
  aliases: text("aliases"),                     // "MacCullagh | McCullagh"
  searchTags: text("searchTags"),               // "cluney house"
  hasDog: boolean("hasDog").default(false),
  safePlace: text("safePlace"),
  notes: text("notes"),
  lat: varchar("lat", { length: 32 }),
  lng: varchar("lng", { length: 32 }),
});

export type Stop = typeof stops.$inferSelect;
export type InsertStop = typeof stops.$inferInsert;

// ─── Learned Mapping ──────────────────────────────────────────────────────────
// Shared, server-side counterpart to the per-device IndexedDB learning cache
// (client/src/lib/routeIntelligencePersistentLearning.ts) — lets voice-search
// corrections sync across postmen and devices on the same route.
export const learnedMappings = mysqlTable(
  "learnedMappings",
  {
    id: int("id").autoincrement().primaryKey(),
    routeId: int("routeId").notNull(),
    stopId: int("stopId").notNull(),
    originalTranscript: varchar("originalTranscript", { length: 255 }).notNull(),
    normalizedTranscript: varchar("normalizedTranscript", { length: 255 }).notNull(),
    firstConfirmedAt: timestamp("firstConfirmedAt").defaultNow().notNull(),
    lastConfirmedAt: timestamp("lastConfirmedAt").defaultNow().notNull(),
    confirmationCount: int("confirmationCount").default(1).notNull(),
    tags: json("tags").$type<string[]>(),
  },
  table => ({
    routeStopTranscriptIdx: uniqueIndex("learnedMappings_route_stop_transcript_idx").on(
      table.routeId,
      table.stopId,
      table.normalizedTranscript
    ),
  })
);

export type LearnedMappingRow = typeof learnedMappings.$inferSelect;
export type InsertLearnedMappingRow = typeof learnedMappings.$inferInsert;
