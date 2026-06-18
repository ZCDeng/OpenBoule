import { PGlite } from "@electric-sql/pglite";
const db = new PGlite("/tmp/boule-pglite-test");
await db.waitReady;
const r = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
console.log("tables:", r.rows.map(x=>x.tablename).join(", "));
const e = await db.query("SELECT typname FROM pg_type WHERE typtype='e' ORDER BY typname");
console.log("enums:", e.rows.map(x=>x.typname).join(", "));
await db.close();
