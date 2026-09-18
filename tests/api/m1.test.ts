import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach, it, expect } from "vitest";
import type { Env } from "../../src/api/env";
import { seedResearch } from "../../src/api/importers/research";
import {
  listRecords,
  getRecord,
  saveRecord,
  patchManaged,
} from "../../src/api/services/records";
import {
  previewCosting,
  saveCosting,
  snapshotChanged,
  transitionProduct,
} from "../../src/api/services/research";
import { readClaims } from "../../src/db/repo/claims";
import { upsertClaim } from "../../src/api/services/claims";
import { saveAttachment } from "../../src/api/services/attachments";
const b = env as unknown as Env & { TEST_MIGRATIONS: never[] };
beforeEach(async () => {
  await reset();
  await applyD1Migrations(b.DB, b.TEST_MIGRATIONS);
  await seedResearch(b.DB);
});
it("M1 unknown outputs, immutable snapshot after edits, and saved duplicate shipping warnings", async () => {
  const scenarios = await listRecords(b.DB, "shipping_scenarios"),
    s = scenarios.find((s) => s.route_type === "forwarder")!;
  const req = {
    product_id: s.product_id,
    offer_id: s.offer_id,
    scenario_id: s.id,
    channel_id: null,
    fx_rate_id: null,
    reason: "테스트: 누락 조사",
  };
  const preview = await previewCosting(b.DB, req);
  expect(preview.outputs).toBeNull();
  expect(preview.unknown_keys).toContain("checkout_price");
  const snap = await saveCosting(b.DB, req);
  expect((await snapshotChanged(b.DB, snap.id)).changed).toBe(false);
  const c = (await readClaims(b.DB)).find(
    (c) =>
      c.owner_type === "offers" &&
      c.owner_id === s.offer_id &&
      c.field_key === "checkout_price",
  )!;
  await upsertClaim(
    b.DB,
    {
      ...c,
      status: "estimated",
      value_json: { amount_minor: 5990, currency: "CNY" },
      source_type: "self_estimate",
      source_ref: "테스트 가정",
      checked_at: "2026-09-16T00:00:00Z",
    },
    "user",
  );
  expect((await snapshotChanged(b.DB, snap.id)).changed).toBe(true);
  expect(
    (await getRecord(b.DB, "costings", snap.id))?.inputs_frozen.claims
      .checkout_price.status,
  ).toBe("unknown");
  await expect(
    saveRecord(b.DB, "costings", { id: snap.id, note: "overwrite" }, "test"),
  ).rejects.toThrow();
  const legs = (await listRecords(b.DB, "shipping_legs")).filter(
    (l) => l.scenario_id === s.id,
  );
  const intl = legs.find((l) => l.cost_code === "intl_shipping")!;
  await saveRecord(
    b.DB,
    "shipping_legs",
    { id: intl.id, includes: ["kr_domestic_shipping"] },
    "국내 택배 포함 견적",
  );
  expect(
    (await getRecord(b.DB, "shipping_scenarios", s.id))?.warnings,
  ).toHaveLength(1);
});
it("M1 rejects competitor-only gate evidence and blocks failed profile pricing", async () => {
  const p = (await listRecords(b.DB, "products"))[0],
    req = (await listRecords(b.DB, "requirement_items")).find(
      (i) => i.profile_id === p.profile_id,
    )!;
  const answer = (await readClaims(b.DB)).find(
    (c) => c.owner_type === "requirement_items" && c.owner_id === req.id,
  )!;
  await upsertClaim(
    b.DB,
    {
      ...answer,
      status: "estimated",
      value_json: "다른 판매자가 판매 중",
      source_type: "competitor_observation",
      source_ref: "경쟁사",
      checked_at: "2026-09-16T00:00:00Z",
    },
    "user",
  );
  await expect(
    saveRecord(
      b.DB,
      "requirement_items",
      { id: req.id, item_result: "pass", condition_text: "잘 팔아서" },
      "판정",
    ),
  ).rejects.toThrow("경쟁사");
  await upsertClaim(
    b.DB,
    {
      ...answer,
      status: "confirmed",
      value_json: "금지 요건에 해당",
      source_type: "document",
      source_ref: "테스트 기관 회신",
      checked_at: "2026-09-16T00:00:00Z",
    },
    "user",
  );
  await saveRecord(
    b.DB,
    "requirement_items",
    { id: req.id, item_result: "fail", condition_text: "판매할 수 없는 요건" },
    "회신 검토",
  );
  expect(
    (await getRecord(b.DB, "compliance_profiles", p.profile_id))?.gate_result,
  ).toBe("fail");
  await patchManaged(
    b.DB,
    "products",
    p,
    { status: "costing" },
    "테스트 사전 조건",
  );
  await expect(
    transitionProduct(b.DB, p.id, { status: "pricing", reason: "단계 검증" }),
  ).rejects.toThrow();
});
it("M1 transitions cannot be bypassed with generic product edit; blocked task fields are mandatory", async () => {
  const p = (await listRecords(b.DB, "products"))[0];
  await expect(
    saveRecord(b.DB, "products", { id: p.id, status: "pricing" }, "우회"),
  ).rejects.toThrow("전용");
  await expect(
    saveRecord(b.DB, "tasks", { title: "block", status: "blocked" }, "test"),
  ).rejects.toThrow();
  await expect(
    transitionProduct(b.DB, p.id, { status: "on_hold", reason: "검토" }),
  ).rejects.toThrow("재검토");
});
it("M1 complete input path: exact EX1 snapshot, gate review, pricing and price decision", async () => {
  const s = (await listRecords(b.DB, "shipping_scenarios")).find(
      (s) => s.route_type === "forwarder",
    )!,
    p = (await getRecord(b.DB, "products", s.product_id))!;
  const channel = (await listRecords(b.DB, "channels"))[0],
    fx = await saveRecord(
      b.DB,
      "fx_rates",
      {
        base_currency: "CNY",
        rate: "195",
        as_of_date: "2026-09-16",
        kind: "manual",
        source: "가상 검증 환율",
      },
      "EX1 테스트",
    );
  const money = (n: number, currency = "KRW") => ({
    amount_minor: n,
    currency,
  });
  const claims = await readClaims(b.DB);
  const put = async (
    type: string,
    id: string,
    key: string,
    value: unknown,
    extra: Record<string, unknown> = {},
  ) => {
    const c = claims.find(
      (c) => c.owner_type === type && c.owner_id === id && c.field_key === key,
    )!;
    return upsertClaim(
      b.DB,
      {
        ...c,
        status: "estimated",
        value_json: value,
        source_type: "self_estimate",
        source_ref: "CALC-EX1 가상 검증",
        checked_at: "2026-09-16T00:00:00Z",
        ...extra,
      },
      "user",
    );
  };
  const attach = async (
    owner_type: string,
    owner_id: string,
    name = "capture.png",
    type = "image/png",
  ) => {
    const fd = new FormData();
    fd.set("file", new File(["EX1 test evidence"], name, { type }));
    fd.set("owner_type", owner_type);
    fd.set("owner_id", owner_id);
    return (await saveAttachment(b, fd, "user")).id;
  };
  // 실결제가 근거에는 그 오퍼에 올린 캡처가 붙어야 확인이 된다. 다른 기록의 파일이나 텍스트 파일은 거부된다.
  const otherOffer = (await listRecords(b.DB, "offers")).find(
    (o) => o.id !== s.offer_id,
  )!;
  const foreign = await attach("offers", otherOffer.id);
  await expect(
    put("offers", s.offer_id, "checkout_price", money(5990, "CNY"), {
      status: "confirmed",
      source_type: "screenshot",
      attachment_ids: [foreign],
    }),
  ).rejects.toThrow("이 기록에 올린 증빙");
  const txt = await attach("offers", s.offer_id, "note.txt", "text/plain");
  await expect(
    put("offers", s.offer_id, "checkout_price", money(5990, "CNY"), {
      status: "confirmed",
      source_type: "screenshot",
      attachment_ids: [txt],
    }),
  ).rejects.toThrow("캡처");
  const capture = await attach("offers", s.offer_id);
  const confirmedPrice = await put(
    "offers",
    s.offer_id,
    "checkout_price",
    money(5990, "CNY"),
    {
      status: "confirmed",
      source_type: "screenshot",
      attachment_ids: [capture],
    },
  );
  expect(confirmedPrice.data.status).toBe("confirmed");
  for (const [k, v] of Object.entries({
    parcel_items: 4,
    duty: money(0),
    vat: money(0),
  }))
    await put("shipping_scenarios", s.id, k, v);
  for (const [k, v] of Object.entries({
    sale_price: money(22000),
    customer_shipping_fee: money(5000),
    items_per_order: 1,
    payment_fx_fee: 200,
    inspection_packaging: money(500),
    returns_reserve: 300,
    ads: money(100000),
    fixed_costs: money(30000),
    monthly_units: 50,
  }))
    await put("products", p.id, k, v);
  for (const [k, v] of Object.entries({
    commission_rate: 550,
    payment_fee_rate: 330,
    fee_applies_to_shipping: true,
  }))
    await put("channels", channel.id, k, v);
  const legs = (await listRecords(b.DB, "shipping_legs")).filter(
    (l) => l.scenario_id === s.id,
  );
  for (const l of legs)
    await put(
      "shipping_legs",
      l.id,
      "cost",
      l.cost_code === "intl_shipping" ? money(4500, "CNY") : money(0),
    );
  const items = (await listRecords(b.DB, "requirement_items")).filter(
    (i) => i.profile_id === p.profile_id,
  );
  // 위험도 높음 항목은 "직접 세운 가정"이나 추정 답변으로는 통과할 수 없다.
  const high = items.find((i) => i.risk_level === "high")!;
  await put("requirement_items", high.id, "answer", "내 생각에는 해당 없음");
  await expect(
    saveRecord(
      b.DB,
      "requirement_items",
      { id: high.id, item_result: "pass", condition_text: "가정" },
      "가상 판정",
    ),
  ).rejects.toThrow("확인 상태");
  await put("requirement_items", high.id, "answer", "기관 회신: 해당 없음", {
    status: "confirmed",
    source_type: "document",
  });
  await expect(
    saveRecord(
      b.DB,
      "requirement_items",
      { id: high.id, item_result: "pass", condition_text: "회신" },
      "가상 판정",
    ),
  ).rejects.toThrow("첨부");
  for (const item of items) {
    const evidence = await attach(
      "requirement_items",
      item.id,
      "reply.pdf",
      "application/pdf",
    );
    await put(
      "requirement_items",
      item.id,
      "answer",
      "테스트 목적의 기관 회신 가정",
      {
        status: "confirmed",
        source_type: "document",
        attachment_ids: [evidence],
      },
    );
    await saveRecord(
      b.DB,
      "requirement_items",
      { id: item.id, item_result: "pass", condition_text: "테스트 근거 검토" },
      "가상 판정",
    );
  }
  const snap = await saveCosting(b.DB, {
    product_id: p.id,
    offer_id: s.offer_id,
    scenario_id: s.id,
    channel_id: channel.id,
    fx_rate_id: fx.id,
    reason: "EX1 회귀 검증",
  });
  expect(snap.outputs.landed_per_unit).toBe("14607.86");
  expect(snap.outputs.contribution_per_unit).toBe("9356.14");
  for (const status of ["researching", "costing", "pricing"])
    await transitionProduct(b.DB, p.id, { status, reason: "수용 기준 검증" });
  const { decidePrice } = await import("../../src/api/services/research");
  const priced = await decidePrice(b.DB, p.id, {
    reason: "확인된 비용에서 결정",
    alternatives: [{ option: "25000원", why_not: "초기 판매 가정" }],
    revisit_when: "견적 변경",
  });
  expect(priced.pricing_decision_id).toBeTruthy();
  await expect(
    transitionProduct(b.DB, p.id, {
      status: "listing_ready",
      reason: "준비 검증",
    }),
  ).rejects.toThrow("사업");
});
