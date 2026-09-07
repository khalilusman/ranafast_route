/**
 * Seed script: reads data/sections.json and data/stops.json and inserts
 * 1 route, all sections, and all stops into the database.
 *
 * Run: node scripts/seed-from-json.mjs
 */
import { readFileSync } from "fs";
import { createConnection } from "mysql2/promise";
import { nanoid } from "nanoid";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env") });

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL not set");

// ── Parse JSON ─────────────────────────────────────────────────────────────────
const sectionsPath = resolve(__dirname, "../data/sections.json");
const stopsPath = resolve(__dirname, "../data/stops.json");

const sectionRows = JSON.parse(readFileSync(sectionsPath, "utf-8"));
const stopRows = JSON.parse(readFileSync(stopsPath, "utf-8"));

console.log(`Found ${sectionRows.length} sections, ${stopRows.length} stops`);

// ── Connect ───────────────────────────────────────────────────────────────────
const conn = await createConnection(DB_URL);

// ── Wipe existing data (FK-safe order: stops → sections → routes) ────────────
await conn.execute("DELETE FROM stops");
await conn.execute("DELETE FROM sections");
await conn.execute("DELETE FROM routes");
console.log("Cleared existing data");

// ── Insert route ──────────────────────────────────────────────────────────────
const shareToken = nanoid(32);
const [routeResult] = await conn.execute(
  "INSERT INTO routes (name, description, shareToken) VALUES (?, ?, ?)",
  ["Maghery Route", "An Post delivery route — Maghery, Co. Donegal", shareToken]
);
const routeId = routeResult.insertId;
console.log(`Route inserted: id=${routeId}, shareToken=${shareToken}`);

// ── Insert sections ───────────────────────────────────────────────────────────
const sectionIdMap = {}; // old id (from sections.json) → new db id
for (const section of sectionRows) {
  const [res] = await conn.execute(
    "INSERT INTO sections (routeId, position, name, boxNumber) VALUES (?, ?, ?, ?)",
    [routeId, section.position, section.name, section.boxNumber]
  );
  sectionIdMap[section.id] = res.insertId;
}
console.log(`Sections inserted: ${Object.keys(sectionIdMap).length}`);

// ── Insert stops ──────────────────────────────────────────────────────────────
let stopCount = 0;
let skipped = 0;
const batch = [];

for (const stop of stopRows) {
  const newSectionId = sectionIdMap[stop.sectionId];
  if (!newSectionId) {
    console.warn(`  Unknown sectionId for stop ${stop.id}: ${stop.sectionId}`);
    skipped++;
    continue;
  }

  batch.push([
    newSectionId,
    routeId,
    stop.stopOrder,
    stop.propertyType,
    stop.side,
    stop.road,
    stop.houseName,
    stop.businessName,
    stop.houseNumber,
    stop.eircode,
    stop.residents,
    stop.aliases,
    stop.searchTags,
    stop.hasDog ? 1 : 0,
    stop.safePlace,
    stop.notes,
    stop.lat,
    stop.lng,
  ]);
  stopCount++;
}

// Insert in batches of 100
const BATCH_SIZE = 100;
for (let b = 0; b < batch.length; b += BATCH_SIZE) {
  const chunk = batch.slice(b, b + BATCH_SIZE);
  const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
  const values = chunk.flat();
  await conn.execute(
    `INSERT INTO stops
      (sectionId, routeId, stopOrder, propertyType, side, road, houseName,
       businessName, houseNumber, eircode, residents, aliases, searchTags,
       hasDog, safePlace, notes, lat, lng)
     VALUES ${placeholders}`,
    values
  );
  console.log(`  Inserted stops ${b + 1}–${Math.min(b + BATCH_SIZE, batch.length)}`);
}

if (skipped > 0) {
  console.warn(`Skipped ${skipped} stop(s) with an unresolved sectionId`);
}

await conn.end();
console.log(`\n✅ Seed complete:`);
console.log(`   Route id: ${routeId}`);
console.log(`   Sections: ${Object.keys(sectionIdMap).length}`);
console.log(`   Stops: ${stopCount}`);
console.log(`   Share token: ${shareToken}`);
