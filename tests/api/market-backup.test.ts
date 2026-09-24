import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { ulid } from "ulid";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import type { Env } from "../../src/api/env";
import { seedResearch } from "../../src/api/importers/research";
import { listRecords, saveRecord } from "../../src/api/services/records";
import { readClaims } from "../../src/db/repo/claims";
import { upsertClaim } from "../../src/api/services/claims";
import { saveAttachment } from "../../src/api/services/attachments";
import { exportArchive, restoreArchive } from "../../src/api/exporters/archive";
import worker from "../../src/api/index";
const b = env as unknown as Env & {
  TEST_MIGRATIONS: never[];
  RESTORED_DB: D1Database;
  RESTORED_ATTACHMENTS: Env["ATTACHMENTS"];
};
beforeEach(async () => {
  await reset();
  await applyD1Migrations(b.DB, b.TEST_MIGRATIONS);
  await applyD1Migrations(b.RESTORED_DB, b.TEST_MIGRATIONS);
  await seedResearch(b.DB);
});
async function market(extra: Record<string, unknown> = {}) {
  return saveRecord(
    b.DB,
    "market_offers",
    {
      product_id: (await listRecords(b.DB, "products"))[0].id,
      name: "한국 판매처",
      url: "https://example.com/item",
      option_desc: "동일 규격 2개",
      match_kind: "same",
      pack_quantity: 2,
      notes: "모델 번호와 구성 사진 일치, 제주 추가 배송 별도",
      ...extra,
    },
    "판매 페이지 관찰",
  );
}
const price = (id: string) => ({
  owner_type: "market_offers",
  owner_id: id,
  field_key: "market_price",
  kind: "money",
  status: "confirmed",
  value_json: { amount_minor: 15000, currency: "KRW" },
  source_type: "competitor_observation",
  source_ref: "https://example.com/item",
  checked_at: "2026-09-24T00:00:00Z",
  recheck_by: "2026-10-24",
});
async function evidence(id: string) {
  const f = new FormData();
  f.set("owner_type", "market_offers");
  f.set("owner_id", id);
  f.set(
    "file",
    new File(["captured price evidence"], "price.png", { type: "image/png" }),
  );
  return saveAttachment(b, f, "user");
}
it("links multiple sellers to one product, preserves source and requires same-owner evidence", async () => {
  const a = await market(),
    second = await market({ name: "다른 판매처", match_kind: "similar" });
  expect(second.product_id).toBe(a.product_id);
  expect(
    (await readClaims(b.DB)).filter((c) => c.owner_id === a.id),
  ).toHaveLength(2);
  expect((await upsertClaim(b.DB, price(a.id), "user")).data.status).toBe(
    "estimated",
  );
  const attachment = await evidence(a.id);
  const saved = await upsertClaim(
    b.DB,
    { ...price(a.id), attachment_ids: [attachment.id] },
    "user",
  );
  expect(saved.data.status).toBe("confirmed");
  expect(saved.data.source_type).toBe("competitor_observation");
  await expect(
    upsertClaim(
      b.DB,
      { ...price(second.id), attachment_ids: [attachment.id] },
      "user",
    ),
  ).rejects.toThrow();
  expect(
    (await readClaims(b.DB)).find(
      (c) => c.owner_id === a.id && c.field_key === "market_shipping",
    )?.status,
  ).toBe("unknown");
});
it("rejects misleading quantities, unsafe links, unsupported price types and reasonless changes", async () => {
  for (const extra of [
    { pack_quantity: 0 },
    { pack_quantity: 1.5 },
    { notes: "" },
    { url: "javascript:alert(1)" },
  ])
    await expect(market(extra)).rejects.toThrow();
  const a = await market();
  for (const extra of [
    { value_json: { amount_minor: 100, currency: "CNY" } },
    { value_json: { amount_minor: -1, currency: "KRW" } },
    { source_type: "self_estimate" },
  ])
    await expect(
      upsertClaim(b.DB, { ...price(a.id), ...extra }, "user"),
    ).rejects.toThrow();
  await expect(
    saveRecord(b.DB, "market_offers", { id: a.id, name: "changed" }, ""),
  ).rejects.toThrow();
  const otherProduct = (await listRecords(b.DB, "products")).find(
    (p) => p.id !== a.product_id,
  )!;
  await expect(
    saveRecord(
      b.DB,
      "market_offers",
      { id: a.id, product_id: otherProduct.id },
      "이동",
    ),
  ).rejects.toThrow();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/records/market_offers"),
    b,
  );
  expect(response.status).toBe(200);
  expect(((await response.json()) as { data: unknown[] }).data).toHaveLength(1);
});
it("roundtrips orders, job runs, soft-deleted market records, claims and evidence in v3 ZIP", async () => {
  const a = await market(),
    attachment = await evidence(a.id);
  await upsertClaim(
    b.DB,
    { ...price(a.id), attachment_ids: [attachment.id] },
    "user",
  );
  await saveRecord(
    b.DB,
    "orders",
    {
      product_id: a.product_id,
      channel_id: (await listRecords(b.DB, "channels"))[0].id,
      order_no: "backup-roundtrip",
      ordered_at: "2026-09-24",
      qty: 2,
    },
    "실제 ZIP 왕복 검사",
  );
  await b.DB.prepare(
    "INSERT INTO job_runs (id,job_key,started_at,status,summary_json) VALUES (?,?,?,?,?)",
  )
    .bind(
      ulid(),
      "daily_digest",
      "2026-09-24T00:00:00Z",
      "ok",
      '{"sent":false}',
    )
    .run();
  await b.DB.prepare("UPDATE market_offers SET deleted_at=? WHERE id=?")
    .bind("2026-09-24T01:00:00Z", a.id)
    .run();
  const bytes = await exportArchive(b);
  const manifest = JSON.parse(strFromU8(unzipSync(bytes)["manifest.json"]));
  expect(manifest.schema_version).toBe(3);
  expect(manifest.counts.orders).toBe(1);
  expect(manifest.counts.market_offers).toBe(1);
  const target = {
    ...b,
    DB: b.RESTORED_DB,
    ATTACHMENTS: b.RESTORED_ATTACHMENTS,
  };
  const preview = await restoreArchive(target, bytes, false);
  expect(
    (await target.DB.prepare("SELECT * FROM orders").all()).results,
  ).toHaveLength(0);
  await restoreArchive(target, bytes, true, preview.archive_hash);
  for (const table of [
    "orders",
    "job_runs",
    "market_offers",
    "claims",
    "claim_attachments",
    "attachments",
  ])
    expect(
      (await target.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
        .results,
    ).toEqual(
      (await b.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,
    );
  expect(await (await target.ATTACHMENTS.get(attachment.r2_key))!.text()).toBe(
    "captured price evidence",
  );
  expect(await restoreArchive(target, bytes, false)).toMatchObject({
    added: 0,
    updated: 0,
  });
});
it("restores old v2 ZIPs without newly introduced tables but rejects incomplete v3", async () => {
  const files = unzipSync(await exportArchive(b));
  for (const table of ["orders", "job_runs", "market_offers"])
    delete files[`entities/${table}.json`];
  await expect(restoreArchive(b, zipSync(files), false)).rejects.toThrow();
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  manifest.schema_version = 2;
  for (const table of ["orders", "job_runs", "market_offers"])
    delete manifest.counts[table];
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  const target = {
    ...b,
    DB: b.RESTORED_DB,
    ATTACHMENTS: b.RESTORED_ATTACHMENTS,
  };
  const preview = await restoreArchive(target, zipSync(files), false);
  await restoreArchive(target, zipSync(files), true, preview.archive_hash);
  expect((await listRecords(target.DB, "products")).length).toBeGreaterThan(0);
});
