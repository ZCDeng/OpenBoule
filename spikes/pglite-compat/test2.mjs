import { PGlite } from "@electric-sql/pglite";
const db = await PGlite.create();
const out = [];
async function t(name, fn){ try{ const r=await fn(); out.push(`✅ ${name} ${r?'// '+JSON.stringify(r):''}`);}catch(e){ out.push(`❌ ${name} :: ${String(e.message||e)}`);} }

// advisory lock via exec (multi-statement allowed)
await t("advisory_xact_lock(exec)", async()=>{ await db.exec("BEGIN; SELECT pg_advisory_xact_lock(42); COMMIT;"); return null; });
// advisory lock via transaction API
await t("advisory_xact_lock(tx)", async()=>{ await db.transaction(async(tx)=>{ await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",["proj-1"]); }); return null; });
// session-level advisory + unlock
await t("advisory_lock/unlock", async()=>{ await db.query("SELECT pg_advisory_lock(7)"); const r=await db.query("SELECT pg_advisory_unlock(7) AS u"); return r.rows[0]; });
// FOR UPDATE inside transaction
await t("select_for_update(tx)", async()=>{
  await db.exec("CREATE TABLE pl(id text primary key)");
  await db.transaction(async(tx)=>{ await tx.query("INSERT INTO pl VALUES('p1') ON CONFLICT DO NOTHING"); await tx.query("SELECT id FROM pl WHERE id='p1' FOR UPDATE"); });
  return "locked+committed";
});
console.log(out.join("\n"));
await db.close();
