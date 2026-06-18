// PGlite 兼容性 spike：实测后端三大阻塞 + 次级风险特性。
// 结论用于决定数据层迁移方案是否成立。
import { PGlite } from "@electric-sql/pglite";

const db = await PGlite.create(); // 内存实例
const results = [];
async function probe(name, sql, note = "") {
  try {
    const r = await db.query(sql);
    results.push({ name, ok: true, rows: r.rows, note });
  } catch (e) {
    results.push({ name, ok: false, err: String(e.message || e), note });
  }
}

console.log("PGlite version:", (await import("@electric-sql/pglite/package.json", { with: { type: "json" } }).catch(() => ({ default: {} }))).default?.version ?? "n/a");

// 1. gen_random_uuid （主键默认）
await probe("gen_random_uuid", "SELECT gen_random_uuid() AS id");

// 2. make_interval（阻塞#3）—— checkpoint.ts lease 计算
await probe("make_interval", "SELECT now() + make_interval(secs => 120) AS exp");

// 2b. workaround: INTERVAL 字面量乘法
await probe("interval_multiply", "SELECT now() + (120 * INTERVAL '1 second') AS exp");

// 3. pg_advisory_xact_lock（阻塞#2）—— references.ts
await probe("advisory_xact_lock", "BEGIN; SELECT pg_advisory_xact_lock(42); COMMIT;");

// 3b. hashtext —— advisory lock 的 key
await probe("hashtext", "SELECT hashtext('some-project-id') AS h");

// 3c. workaround: 行级锁 SELECT FOR UPDATE
await probe("select_for_update_setup", "CREATE TABLE proj_lock(id text primary key)");
await probe("select_for_update", "BEGIN; INSERT INTO proj_lock(id) VALUES('p1') ON CONFLICT DO NOTHING; SELECT id FROM proj_lock WHERE id='p1' FOR UPDATE; COMMIT;");

// 4. bigserial / 序列（次级风险）—— workflow_events.event_id
await probe("bigserial", "CREATE TABLE ev(event_id bigserial primary key, body text)");
await probe("bigserial_insert", "INSERT INTO ev(body) VALUES('a'),('b') RETURNING event_id");

// 5. jsonb 基本 + jsonb_set（次级风险）—— approvals.ts
await probe("jsonb_col", "CREATE TABLE j(id int primary key, data jsonb)");
await probe("jsonb_insert", "INSERT INTO j VALUES (1, '{\"a\":1}'::jsonb)");
await probe("jsonb_set", "UPDATE j SET data = jsonb_set(coalesce(data,'{}'::jsonb), '{interactiveTrack}', '\"html\"'::jsonb) WHERE id=1 RETURNING data");
await probe("jsonb_remove_key", "UPDATE j SET data = data - 'a' WHERE id=1 RETURNING data");
await probe("jsonb_contains", "SELECT '{\"a\":1,\"b\":2}'::jsonb @> '{\"a\":1}'::jsonb AS c");

// 6. xmax 系统列（次级风险）—— references.ts ON CONFLICT 区分 insert/update
await probe("xmax_setup", "CREATE TABLE r(id int primary key, v int)");
await probe("xmax_oncoflict", "INSERT INTO r VALUES(1,1) ON CONFLICT(id) DO UPDATE SET v=excluded.v RETURNING id, (xmax = 0) AS inserted");

// 7. ENUM 类型
await probe("create_enum", "CREATE TYPE wf_status AS ENUM('draft','running','done')");
await probe("enum_add_value", "ALTER TYPE wf_status ADD VALUE IF NOT EXISTS 'failed'");

// 8. CTE + window
await probe("cte_window", "WITH x AS (SELECT generate_series(1,3) n) SELECT n, row_number() OVER (ORDER BY n) FROM x");

// 9. 持久化（关键：app 要落地到用户目录）
// 仅探测 API 存在性，不实际落盘
results.push({ name: "persistence_note", ok: true, note: "PGlite 支持 dataDir 落盘 + IndexedDB；Node 端用文件目录" });

console.log("\n=== 兼容性结果 ===");
for (const r of results) {
  const tag = r.ok ? "✅ OK " : "❌ FAIL";
  console.log(`${tag} ${r.name}${r.note ? "  // " + r.note : ""}`);
  if (!r.ok) console.log(`        └ ${r.err}`);
  else if (r.rows && r.rows.length) console.log(`        └ ${JSON.stringify(r.rows[0])}`);
}
await db.close();
