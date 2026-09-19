import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, it, expect } from "vitest";
import type { Env } from "../../src/api/env";
import { seedResearch, researchImport } from "../../src/api/importers/research";
import seedWorkbook from "../../src/domain/seedWorkbook.json";
import { listRecords } from "../../src/api/services/records";
import { readClaims } from "../../src/db/repo/claims";
const b = env as unknown as Env & { TEST_MIGRATIONS: never[] };
// Workers 요청당 D1 호출(부속 요청) 상한 1,000회. 조각 하나가 그 절반을 넘지 않아야 여유가 있다.
const MAX_CALLS_PER_REQUEST = 500;
function counting(db: D1Database) {
  const n = { calls: 0 };
  const proxy = new Proxy(db, {
    get(t, k, r) {
      if (k === "prepare")
        return (...a: unknown[]) => {
          const stmt = (t.prepare as (...x: unknown[]) => D1PreparedStatement)(
            ...a,
          );
          return new Proxy(stmt, {
            get(st, sk, sr) {
              if (["run", "first", "all", "raw"].includes(String(sk)))
                return (...x: unknown[]) => {
                  n.calls++;
                  return (st[sk as "run"] as (...y: unknown[]) => unknown)(
                    ...x,
                  );
                };
              if (sk === "bind")
                return (...x: unknown[]) => {
                  const bound = st.bind(...x);
                  return new Proxy(bound, this as ProxyHandler<D1PreparedStatement>);
                };
              return Reflect.get(st, sk, sr);
            },
          });
        };
      if (k === "batch")
        return (s: D1PreparedStatement[]) => {
          n.calls++;
          return t.batch(s);
        };
      return Reflect.get(t, k, r);
    },
  });
  return { db: proxy, n };
}
beforeEach(async () => {
  await reset();
  await applyD1Migrations(b.DB, b.TEST_MIGRATIONS);
});
it("seed in chunks stays under the per-request D1 call budget and ends in the same state", async () => {
  let from: number | null = 0,
    batch: string | undefined,
    last: Awaited<ReturnType<typeof seedResearch>> | undefined,
    worst = 0,
    requests = 0;
  while (from !== null) {
    const { db, n } = counting(b.DB);
    last = await seedResearch(db, { from, limit: 10, batch_id: batch });
    requests++;
    worst = Math.max(worst, n.calls);
    expect(n.calls, `chunk from=${from}`).toBeLessThan(MAX_CALLS_PER_REQUEST);
    from = "next" in last ? (last.next ?? null) : null;
    batch = "batch_id" in last ? last.batch_id : batch;
  }
  expect(requests).toBeGreaterThan(1);
  expect(last).toMatchObject({ done: true, failed: 0 });
  expect(await listRecords(b.DB, "products")).toHaveLength(4);
  expect(await listRecords(b.DB, "requirement_items")).toHaveLength(26);
  const batches = await b.DB.prepare("SELECT * FROM import_batches").all();
  expect(batches.results).toHaveLength(1);
  expect(batches.results[0]).toMatchObject({ applied: 1, rows_failed: 0 });
  const rights = (await readClaims(b.DB)).find(
    (c) => c.field_key === "rights_holder",
  );
  expect(rights?.status).toBe("confirmed");
  const flag = await b.DB.prepare(
    "SELECT key FROM settings WHERE key='seed_research_v1'",
  ).first();
  expect(flag).toBeTruthy();
  // 다시 부르면 이미 적용됨
  expect(await seedResearch(b.DB, { from: 0, limit: 10 })).toMatchObject({
    already_seeded: true,
  });
  // 전체 한 번에 실행한 결과와 기록·근거 수가 같다
  const chunked = {
    claims: (await readClaims(b.DB)).length,
    notes: (await listRecords(b.DB, "notes")).length,
  };
  await reset();
  await applyD1Migrations(b.DB, b.TEST_MIGRATIONS);
  await seedResearch(b.DB);
  expect({
    claims: (await readClaims(b.DB)).length,
    notes: (await listRecords(b.DB, "notes")).length,
  }).toEqual(chunked);
  void worst;
});
it("excel import preview and apply work chunk by chunk with a shared batch row", async () => {
  await seedResearch(b.DB);
  const before = (await readClaims(b.DB)).length;
  const wb = seedWorkbook as Parameters<typeof researchImport>[1];
  const preview: Row[] = [];
  let from: number | null = 0,
    hash = "";
  while (from !== null) {
    const r = await researchImport(b.DB, wb, "research.xlsx", false, undefined, false, {
      from,
      limit: 10,
    });
    hash = r.hash;
    preview.push(...(r.results as Row[]));
    from = r.next;
  }
  expect(preview.filter((r) => r.status === "failed")).toHaveLength(0);
  expect(preview.filter((r) => r.status === "ready").length).toBe(64);
  from = 0;
  let batch: string | undefined,
    last: Awaited<ReturnType<typeof researchImport>> | undefined;
  while (from !== null) {
    last = await researchImport(b.DB, wb, "research.xlsx", true, hash, false, {
      from,
      limit: 10,
      batch_id: batch,
    });
    batch = last.batch_id;
    from = last.next;
  }
  expect(last).toMatchObject({ done: true, failed: 0, ready: 64 });
  expect((last!.results as Row[]).length).toBe(preview.length);
  expect((await readClaims(b.DB)).length).toBe(before);
  const rows = await b.DB.prepare("SELECT id, applied, rows_ok FROM import_batches").all();
  expect(rows.results).toHaveLength(2);
  expect(rows.results.every((r) => r.applied === 1)).toBe(true);
  // 존재하지 않는 배치로 이어서 적용하면 거절
  await expect(
    researchImport(b.DB, wb, "research.xlsx", true, hash, false, {
      from: 10,
      limit: 10,
      batch_id: "nope",
    }),
  ).rejects.toThrow("이어서 적용할 가져오기 배치가 없습니다");
});
type Row = Record<string, unknown>;
