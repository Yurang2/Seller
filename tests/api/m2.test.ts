import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, it, expect } from "vitest";
import type { Env } from "../../src/api/env";
import { seedResearch } from "../../src/api/importers/research";
import {
  listRecords,
  getRecord,
  saveRecord,
  deleteRecord,
  restoreRecord,
  listDeleted,
  patchManaged,
} from "../../src/api/services/records";
import { transitionProduct } from "../../src/api/services/research";
import { upsertClaim } from "../../src/api/services/claims";
import { readClaims } from "../../src/db/repo/claims";
import { workspace, setSetting } from "../../src/api/services/workspace";
const b = env as unknown as Env & { TEST_MIGRATIONS: never[] };
beforeEach(async () => {
  await reset();
  await applyD1Migrations(b.DB, b.TEST_MIGRATIONS);
  await seedResearch(b.DB);
});
const money = (n: number) => ({ amount_minor: n, currency: "KRW" });
async function readyProduct() {
  // 규칙 검증이 아니라 M2 검증이므로 상품을 등록 준비 단계로 직접 올린다.
  const p = (await listRecords(b.DB, "products"))[0];
  await patchManaged(
    b.DB,
    "products",
    p,
    { status: "listing_ready" },
    "테스트 사전 조건",
  );
  const decided = (await readClaims(b.DB)).find(
    (c) =>
      c.owner_type === "products" &&
      c.owner_id === p.id &&
      c.field_key === "decided_price",
  )!;
  await upsertClaim(
    b.DB,
    {
      ...decided,
      status: "estimated",
      value_json: money(22000),
      source_type: "self_estimate",
      source_ref: "테스트 결정",
      checked_at: "2026-09-16T00:00:00Z",
    },
    "user",
    { priceDecision: true },
  );
  return (await getRecord(b.DB, "products", p.id))!;
}
it("M2 listing: live needs external id, decided price match, image source and a verified date", async () => {
  const p = await readyProduct();
  const channel = (await listRecords(b.DB, "channels"))[0];
  const draft = await saveRecord(
    b.DB,
    "listings",
    { channel_id: channel.id, product_id: p.id, status: "draft" },
    "등록 준비",
  );
  expect(draft.status).toBe("draft");
  const live = (extra: Record<string, unknown>) =>
    saveRecord(
      b.DB,
      "listings",
      {
        id: draft.id,
        channel_id: channel.id,
        product_id: p.id,
        status: "live",
        external_id: "123456",
        listed_price: money(22000),
        assets_source: "own_photo",
        last_verified_at: "2026-09-18",
        ...extra,
      },
      "채널 노출 확인",
    );
  await expect(live({ assets_source: "unknown" })).rejects.toThrow(
    "이미지 출처",
  );
  await expect(live({ listed_price: money(25000) })).rejects.toThrow(
    "결정 판매가",
  );
  await expect(live({ external_id: null, url: null })).rejects.toThrow(
    "상품 번호",
  );
  await expect(
    live({ listed_price: { amount_minor: 100, currency: "CNY" } }),
  ).rejects.toThrow("KRW");
  const ok = await live({});
  expect(ok.status).toBe("live");
  await expect(
    saveRecord(
      b.DB,
      "listings",
      {
        ...draft,
        product_id: (await listRecords(b.DB, "products"))[1].id,
        status: "live",
        external_id: "1",
        listed_price: money(1),
        assets_source: "own_photo",
        last_verified_at: "2026-09-18",
      },
      "다른 상품",
    ),
  ).rejects.toThrow();
});
it("M2 product goes live only with a live listing and completed readiness; pause and resume keep the rule", async () => {
  const p = await readyProduct();
  await setSetting(b.DB, "business_model", "purchase_agency", "테스트");
  // 선행 항목부터 완료돼야 하므로 여러 번 돌며 완료한다.
  for (let pass = 0; pass < 6; pass++)
    for (const r of await listRecords(b.DB, "readiness_items"))
      if (r.status !== "done")
        try {
          await saveRecord(
            b.DB,
            "readiness_items",
            { id: r.id, status: "done", notes: "테스트 완료 근거" },
            "테스트",
            "user",
            true,
          );
        } catch {
          /* 선행 미완료 → 다음 회차 */
        }
  expect(
    (await listRecords(b.DB, "readiness_items")).every(
      (r) => r.status === "done",
    ),
  ).toBe(true);
  await expect(
    transitionProduct(b.DB, p.id, { status: "live", reason: "판매 시작" }),
  ).rejects.toThrow("등록 상품");
  const channel = (await listRecords(b.DB, "channels"))[0];
  await saveRecord(
    b.DB,
    "listings",
    {
      channel_id: channel.id,
      product_id: p.id,
      status: "live",
      external_id: "123456",
      listed_price: money(22000),
      assets_source: "own_photo",
      last_verified_at: "2026-09-18",
    },
    "채널 노출 확인",
  );
  const live = await transitionProduct(b.DB, p.id, {
    status: "live",
    reason: "판매 시작",
  });
  expect(live.status).toBe("live");
  expect((await workspace(b.DB)).mode).toBe("operations");
  await expect(
    transitionProduct(b.DB, (await listRecords(b.DB, "products"))[1].id, {
      status: "paused",
      reason: "x",
    }),
  ).rejects.toThrow("판매 중인 상품");
  const paused = await transitionProduct(b.DB, p.id, {
    status: "paused",
    reason: "재고 확인",
  });
  expect(paused.status).toBe("paused");
  const resumed = await transitionProduct(b.DB, p.id, {
    status: "live",
    reason: "재개",
  });
  expect(resumed.status).toBe("live");
});
it("M2 derived task asks for a listing when a product is ready, and manual SOPs exist for the unconnected channel", async () => {
  const p = await readyProduct();
  const w = await workspace(b.DB);
  expect(
    w.records.tasks.some(
      (t) =>
        t.rule_key === "product_needs_listing" &&
        t.entity_id === p.id &&
        t.status === "todo",
    ),
  ).toBe(true);
  expect(w.records.sops.map((s) => s.key)).toEqual(
    expect.arrayContaining(["listing_manual", "orders_manual"]),
  );
  expect(
    w.records.tasks
      .filter((t) => t.rule_key === "profile_gate_unknown")
      .every((t) => t.status === "blocked" && t.blocked_reason && t.recheck_at),
  ).toBe(true);
  expect(w.stale.every((c) => c.status !== "unknown")).toBe(true);
});
it("R-14 soft-deleted records can be listed and restored with a reason and an audit row", async () => {
  const note = await saveRecord(
    b.DB,
    "notes",
    { title: "임시 메모", type: "journal" },
    "테스트",
  );
  await deleteRecord(b.DB, "notes", note.id, "잘못 만듦", "user");
  expect(await getRecord(b.DB, "notes", note.id)).toBeNull();
  expect((await listDeleted(b.DB, "notes")).some((r) => r.id === note.id)).toBe(
    true,
  );
  await expect(
    restoreRecord(b.DB, "notes", note.id, "", "user"),
  ).rejects.toThrow("복구 이유");
  const back = await restoreRecord(
    b.DB,
    "notes",
    note.id,
    "필요해서 복구",
    "user",
  );
  expect(back.deleted_at).toBeNull();
  expect((await getRecord(b.DB, "notes", note.id))?.title).toBe("임시 메모");
  const log = await b.DB.prepare(
    "SELECT action, actor FROM activity_log WHERE entity_type='notes' AND entity_id=? ORDER BY at",
  )
    .bind(note.id)
    .all<{ action: string; actor: string }>();
  expect(log.results.map((r) => r.action)).toEqual([
    "create",
    "delete",
    "restore",
  ]);
});
