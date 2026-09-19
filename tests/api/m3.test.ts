import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, it, expect } from "vitest";
import type { Env } from "../../src/api/env";
import { seedResearch } from "../../src/api/importers/research";
import {
  listRecords,
  saveRecord,
  patchManaged,
  today,
} from "../../src/api/services/records";
import { upsertClaim } from "../../src/api/services/claims";
import { readClaims } from "../../src/db/repo/claims";
import { reconcileTasks, workspace } from "../../src/api/services/workspace";
import { runDailyDigest, buildDigest } from "../../src/api/jobs/digest";
const b = env as unknown as Env & { TEST_MIGRATIONS: never[] };
beforeEach(async () => {
  await reset();
  await applyD1Migrations(b.DB, b.TEST_MIGRATIONS);
  await seedResearch(b.DB);
});
const shift = (days: number) => {
  const d = new Date(today() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
async function order(extra: Record<string, unknown> = {}) {
  const product = (await listRecords(b.DB, "products"))[0];
  const channel = (await listRecords(b.DB, "channels"))[0];
  return await saveRecord(
    b.DB,
    "orders",
    {
      channel_id: channel.id,
      product_id: product.id,
      order_no: "2026091900" + Math.floor(Math.random() * 1000),
      ordered_at: today(),
      qty: 1,
      status: "received",
      customs_code_collected: "unknown",
      ...extra,
    },
    "테스트 주문 접수",
  );
}
// saveRecord는 카탈로그 필드만 받는다(created_at 같은 시스템 필드는 거절). 갱신용으로 골라낸다.
const editable = (o: Record<string, unknown>) => {
  const { created_at, updated_at, deleted_at, ...rest } = o;
  void created_at;
  void updated_at;
  void deleted_at;
  return rest;
};
const derived = async (rule: string) =>
  (await listRecords(b.DB, "tasks")).filter(
    (t) => t.rule_key === rule && !["done", "cancelled"].includes(t.status),
  );

it("M3 order pipeline derives purchase, tracking and settlement tasks, and resolves them when the record moves on", async () => {
  const o = await order({ ordered_at: shift(-2) });
  await reconcileTasks(b.DB);
  expect(await derived("order_needs_purchase")).toHaveLength(1);
  // 발주하면 발주 작업은 사라지고, 발송인데 송장이 없으면 송장 작업이 생긴다.
  const afterOrdered = await saveRecord(
    b.DB,
    "orders",
    { ...editable(o), status: "shipped_cn", supplier_order_no: "TAO-1" },
    "발주·발송 기록",
  );
  await reconcileTasks(b.DB);
  expect(await derived("order_needs_purchase")).toHaveLength(0);
  expect(await derived("order_needs_tracking")).toHaveLength(1);
  await saveRecord(
    b.DB,
    "orders",
    { ...editable(afterOrdered), tracking_no: "SF-2026" },
    "송장 기록",
  );
  await reconcileTasks(b.DB);
  expect(await derived("order_needs_tracking")).toHaveLength(0);
  // 배송완료 14일이 지나도 정산이 없으면 정산 확인이 뜬다.
  const delivered = await saveRecord(
    b.DB,
    "orders",
    {
      ...editable(afterOrdered),
      tracking_no: "SF-2026",
      status: "delivered",
      delivered_at: shift(-15),
    },
    "배송완료",
  );
  await reconcileTasks(b.DB);
  expect(await derived("order_needs_settlement")).toHaveLength(1);
  await saveRecord(
    b.DB,
    "orders",
    { ...editable(delivered), status: "settled", settled_at: today() },
    "정산 확인",
  );
  await reconcileTasks(b.DB);
  expect(await derived("order_needs_settlement")).toHaveLength(0);
});

it("M3 keeps customer PII out: the record stores only whether the customs code was collected", async () => {
  const def = (await import("../../src/domain/records/catalog")).catalog.orders;
  expect(Object.keys(def.fields)).not.toContain("customs_code");
  expect(def.fields.customs_code_collected.options).toEqual([
    "unknown",
    "collected",
    "not_needed",
  ]);
  const o = await order();
  await expect(
    saveRecord(
      b.DB,
      "orders",
      { ...editable(o), customs_code: "P123456789012" },
      "통관부호 저장 시도",
    ),
  ).rejects.toThrow();
});

it("M3 money on an order needs a capture: supplier payment without an attachment is downgraded to estimate", async () => {
  const o = await order();
  const saved = await upsertClaim(
    b.DB,
    {
      owner_type: "orders",
      owner_id: o.id,
      field_key: "supplier_paid",
      kind: "money",
      status: "confirmed",
      value_json: { amount_minor: 3800, currency: "CNY" },
      source_type: "url",
      source_ref: "https://item.taobao.com/x",
      checked_at: new Date().toISOString(),
      recheck_by: shift(30),
      note: "",
      basis_json: {},
      attachment_ids: [],
    },
    "발주 결제 기록",
  );
  expect(saved.downgraded).toBe(true);
  expect(saved.data.status).toBe("estimated");
});

it("daily digest counts overdue evidence and open orders, records a job run, and skips email without config", async () => {
  await order({ ordered_at: shift(-3) });
  // 기한이 지난 근거 하나를 만든다.
  const claim = (await readClaims(b.DB)).find(
    (c) => c.status !== "unknown" && c.owner_type === "products",
  );
  if (claim)
    await upsertClaim(
      b.DB,
      { ...claim, recheck_by: shift(-5) },
      "테스트: 재확인 기한 경과",
    );
  const summary = await buildDigest(b.DB);
  expect(summary.date).toBe(today());
  expect(summary.counts.orders).toBeGreaterThanOrEqual(1);
  expect(summary.orders_waiting.some((o) => o.status === "received")).toBe(
    true,
  );
  const { summary: ran } = await runDailyDigest(b as unknown as Env);
  expect(ran.email).toBe("skipped");
  const runs = (
    await b.DB.prepare(
      "SELECT * FROM job_runs WHERE job_key='daily_digest'",
    ).all<Record<string, unknown>>()
  ).results;
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe("ok");
  expect(JSON.parse(String(runs[0].summary_json)).counts.orders).toBe(
    ran.counts.orders,
  );
  // 홈이 마지막 요약을 보여준다. (workspace()는 파생 작업을 재계산하므로 기준선은 그 뒤에 잡는다.)
  const ws = await workspace(b.DB);
  expect(ws.last_digest?.summary?.counts.orders).toBe(ran.counts.orders);
  // Job은 집계·기록만 할 뿐 데이터를 바꾸지 않는다.
  const before = await listRecords(b.DB, "tasks");
  await runDailyDigest(b as unknown as Env);
  const after = await listRecords(b.DB, "tasks");
  expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
});

it("an order for a paused product still reconciles; derived order tasks point at the order record", async () => {
  const p = (await listRecords(b.DB, "products"))[0];
  await patchManaged(
    b.DB,
    "products",
    p,
    { status: "on_hold" },
    "테스트 보류",
    "rule:test",
  );
  const o = await order({ ordered_at: shift(-2) });
  await reconcileTasks(b.DB);
  const [task] = await derived("order_needs_purchase");
  expect(task.entity_type).toBe("orders");
  expect(task.entity_id).toBe(o.id);
  expect(task.title).toContain(o.order_no);
});
