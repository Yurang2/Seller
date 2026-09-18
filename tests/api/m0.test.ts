import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, it, expect } from "vitest";
import type { Env } from "../../src/api/env";
import {
  seedResearch,
  researchImport,
  parseWorkbook,
} from "../../src/api/importers/research";
import seedWorkbook from "../../src/domain/seedWorkbook.json";
import { saveRecord, listRecords } from "../../src/api/services/records";
import {
  workspace,
  setSetting,
  reconcileTasks,
} from "../../src/api/services/workspace";
import { upsertClaim } from "../../src/api/services/claims";
import { readClaims } from "../../src/db/repo/claims";
import { exportArchive, restoreArchive } from "../../src/api/exporters/archive";
const b = env as unknown as Env & {
  TEST_MIGRATIONS: never[];
  RESTORED_DB: D1Database;
  RESTORED_ATTACHMENTS: R2Bucket;
};
beforeEach(async () => {
  await reset();
  await applyD1Migrations(b.DB, b.TEST_MIGRATIONS);
  await applyD1Migrations(b.RESTORED_DB, b.TEST_MIGRATIONS);
});
it("M0 imports all seed rows, no fake prices or examples; repeated import is idempotent", async () => {
  const r = await seedResearch(b.DB);
  expect(r).toHaveProperty("failed", 0);
  expect(await listRecords(b.DB, "products")).toHaveLength(4);
  expect(await listRecords(b.DB, "suppliers")).toHaveLength(3);
  expect(await listRecords(b.DB, "offers")).toHaveLength(4);
  expect(await listRecords(b.DB, "requirement_items")).toHaveLength(26);
  const before = (await readClaims(b.DB)).length;
  const p = await researchImport(b.DB, seedWorkbook, "research.xlsx");
  expect(
    p.failed,
    p.results.filter((r) => r.status === "failed"),
  ).toBe(0);
  const applied = await researchImport(
    b.DB,
    seedWorkbook,
    "research.xlsx",
    true,
    p.hash,
  );
  expect(
    applied.failed,
    applied.results.filter((r) => r.status === "failed"),
  ).toBe(0);
  expect(await listRecords(b.DB, "products")).toHaveLength(4);
  expect((await readClaims(b.DB)).length).toBe(before);
  const claims = await readClaims(b.DB);
  expect(
    claims
      .filter((c) => c.field_key === "checkout_price")
      .every((c) => c.status === "unknown" && c.value_json === null),
  ).toBe(true);
  expect(
    (await listRecords(b.DB, "decisions")).find((d) => d.code === "D-03")
      ?.status,
  ).toBe("accepted");
  expect(
    (await workspace(b.DB)).records.tasks.some(
      (t) => t.rule_key === "decide_business_model" && t.status === "blocked",
    ),
  ).toBe(true);
});
it("M0 reasons required; overdue claims become one task and resolve when rechecked", async () => {
  await expect(
    saveRecord(
      b.DB,
      "decisions",
      { title: "test", decision: "choose" },
      "reason",
    ),
  ).rejects.toThrow();
  await seedResearch(b.DB);
  const c = (await readClaims(b.DB)).find(
    (c) => c.field_key === "checkout_price",
  )!;
  // 미확인 자리표시 값은 신선도 대상이 아니다. 값이 있는 추정 근거만 기한이 지나면 재확인 작업이 생긴다.
  await upsertClaim(b.DB, { ...c, recheck_by: "2020-01-01" }, "user");
  await reconcileTasks(b.DB);
  expect((await workspace(b.DB)).stale.some((s) => s.id === c.id)).toBe(false);
  await upsertClaim(
    b.DB,
    {
      ...c,
      status: "estimated",
      value_json: { amount_minor: 5990, currency: "CNY" },
      source_type: "self_estimate",
      source_ref: "테스트 가정",
      checked_at: "2020-01-01T00:00:00Z",
      recheck_by: "2020-01-01",
    },
    "user",
  );
  await reconcileTasks(b.DB);
  await reconcileTasks(b.DB);
  expect((await workspace(b.DB)).stale.some((s) => s.id === c.id)).toBe(true);
  expect(
    (await listRecords(b.DB, "tasks")).filter(
      (t) =>
        t.rule_key === "claim_stale" &&
        t.entity_id === c.id &&
        t.status === "todo",
    ),
  ).toHaveLength(1);
  await upsertClaim(
    b.DB,
    {
      ...c,
      status: "estimated",
      value_json: { amount_minor: 5990, currency: "CNY" },
      source_type: "self_estimate",
      source_ref: "테스트 가정",
      checked_at: "2020-01-01T00:00:00Z",
      recheck_by: "2099-01-01",
    },
    "user",
  );
  await reconcileTasks(b.DB);
  expect(
    (await listRecords(b.DB, "tasks")).find(
      (t) => t.rule_key === "claim_stale" && t.entity_id === c.id,
    )?.status,
  ).toBe("done");
  await setSetting(b.DB, "business_model", "purchase_agency", "test");
  await reconcileTasks(b.DB);
  expect(
    (await listRecords(b.DB, "tasks")).find(
      (t) => t.rule_key === "decide_business_model",
    )?.status,
  ).toBe("done");
});
it("M0 full research archive restores into empty database with all relationships and claims", async () => {
  await seedResearch(b.DB);
  const bytes = await exportArchive(b);
  const dest = { ...b, DB: b.RESTORED_DB, ATTACHMENTS: b.RESTORED_ATTACHMENTS };
  const preview = await restoreArchive(dest, bytes, false);
  await restoreArchive(dest, bytes, true, preview.archive_hash);
  for (const type of [
    "products",
    "requirement_items",
    "offers",
    "shipping_scenarios",
    "shipping_legs",
    "decisions",
    "readiness_items",
  ])
    expect(await listRecords(dest.DB, type)).toEqual(
      await listRecords(b.DB, type),
    );
  expect(await readClaims(dest.DB)).toEqual(await readClaims(b.DB));
});
