import { z } from "zod";
import { ulid } from "ulid";
import { readClaims } from "../../db/repo/claims";
import { upsertClaim } from "./claims";
import { calculate, type CalcInput } from "../../domain/calculate";
import { stages } from "../../domain/records/catalog";
import { claimSchema } from "../../domain/types/claim";
import {
  getRecord,
  listRecords,
  saveRecord,
  patchManaged,
  fail,
  audit,
  type Row,
} from "./records";
import { reconcileTasks } from "./workspace";
export async function costingInput(
  db: D1Database,
  productId: string,
  offerId: string,
  scenarioId: string,
  channelId: string | null,
  fxId: string | null,
): Promise<CalcInput> {
  const p = await getRecord(db, "products", productId),
    o = await getRecord(db, "offers", offerId),
    s = await getRecord(db, "shipping_scenarios", scenarioId);
  if (
    !p ||
    !o ||
    !s ||
    o.product_id !== p.id ||
    s.product_id !== p.id ||
    (s.offer_id && s.offer_id !== o.id)
  )
    fail(
      "상품 연결" +
        "이 맞지 않습니다. 같은 상품·오퍼의 배송 경로를 선택하세요.",
    );
  if (channelId && !(await getRecord(db, "channels", channelId)))
    fail("판매 채널이 없습니다.");
  const all = (await readClaims(db)).map((c) => claimSchema.parse(c));
  const find = (type: string, id: string | null, key: string) =>
    all.find(
      (c) => c.owner_type === type && c.owner_id === id && c.field_key === key,
    ) ?? null;
  const claims: CalcInput["claims"] = {
    checkout_price: find("offers", o.id, "checkout_price"),
  };
  for (const k of ["parcel_items", "parcel_weight_g", "duty", "vat"])
    claims[k] = find("shipping_scenarios", s.id, k);
  for (const k of [
    "sale_price",
    "customer_shipping_fee",
    "items_per_order",
    "payment_fx_fee",
    "inspection_packaging",
    "returns_reserve",
    "ads",
    "fixed_costs",
    "monthly_units",
  ])
    claims[k] = find("products", p.id, k);
  for (const [k, field] of [
    ["commission_rate", "commission_rate"],
    ["payment_fee_rate", "payment_fee_rate"],
    ["fee_applies_to_shipping", "fee_applies_to_shipping"],
  ])
    claims[k] = find("channels", channelId, field);
  const legs = (await listRecords(db, "shipping_legs"))
    .filter((l) => l.scenario_id === s.id)
    .sort((a, b) => a.seq - b.seq);
  for (const l of legs)
    claims["leg:" + l.id] = find("shipping_legs", l.id, "cost");
  const fx = fxId ? await getRecord(db, "fx_rates", fxId) : null;
  if (fxId && !fx) fail("저장한 환율이 없습니다.");
  return {
    claims,
    legs: legs.map((l) => ({ id: l.id, code: l.cost_code, basis: l.basis })),
    fx: fx as CalcInput["fx"],
  };
}
const requestSchema = z.object({
  product_id: z.string().ulid(),
  offer_id: z.string().ulid(),
  scenario_id: z.string().ulid(),
  channel_id: z.string().ulid().nullable(),
  fx_rate_id: z.string().ulid().nullable(),
  note: z.string().default(""),
  reason: z.string().optional(),
});
export async function previewCosting(db: D1Database, input: unknown) {
  const req = requestSchema.parse(input),
    frozen = await costingInput(
      db,
      req.product_id,
      req.offer_id,
      req.scenario_id,
      req.channel_id,
      req.fx_rate_id,
    );
  let result;
  try {
    result = calculate(frozen);
  } catch (e) {
    fail(e instanceof Error ? e.message : "계산 입력을 확인하세요.");
  }
  return {
    ...req,
    inputs_frozen: frozen,
    ...result,
    warnings:
      (await getRecord(db, "shipping_scenarios", req.scenario_id))?.warnings ??
      [],
  };
}
export async function saveCosting(db: D1Database, input: unknown) {
  const r = await previewCosting(db, input);
  if (!r.reason?.trim()) fail("스냅샷 저장 이유가 필요합니다.");
  const row = await saveRecord(
    db,
    "costings",
    {
      product_id: r.product_id,
      offer_id: r.offer_id,
      scenario_id: r.scenario_id,
      channel_id: r.channel_id,
      fx_rate_id: r.fx_rate_id,
      qty_assumption:
        typeof r.inputs_frozen.claims.parcel_items?.value_json === "number"
          ? r.inputs_frozen.claims.parcel_items.value_json
          : null,
      items_per_order:
        typeof r.inputs_frozen.claims.items_per_order?.value_json === "number"
          ? r.inputs_frozen.claims.items_per_order.value_json
          : null,
      inputs_frozen: r.inputs_frozen,
      lines: r.lines,
      outputs: r.outputs ? { ...r.outputs, ranges: r.ranges } : null,
      overall_status: r.overall_status,
      unknown_keys: r.unknown_keys,
      note: r.note,
    },
    r.reason,
    "user",
    true,
  );
  const p = (await getRecord(db, "products", r.product_id))!;
  if (p.current_costing_id) {
    const old = await getRecord(db, "costings", p.current_costing_id);
    if (old)
      await patchManaged(
        db,
        "costings",
        old,
        { is_current: 0 },
        "새 현재 스냅샷 선택",
      );
  }
  await patchManaged(
    db,
    "products",
    p,
    { current_costing_id: row.id, chosen_scenario_id: r.scenario_id },
    r.reason,
  );
  await reconcileTasks(db);
  return row;
}
export async function snapshotChanged(db: D1Database, id: string) {
  const s = await getRecord(db, "costings", id);
  if (!s) fail("스냅샷이 없습니다.");
  const current = await costingInput(
    db,
    s.product_id,
    s.offer_id,
    s.scenario_id,
    s.channel_id,
    s.fx_rate_id,
  );
  return {
    data: s,
    changed: JSON.stringify(current) !== JSON.stringify(s.inputs_frozen),
  };
}
export async function transitionProduct(
  db: D1Database,
  id: string,
  input: unknown,
) {
  const { status, reason, recheck_at } = z
    .object({
      status: z.enum(stages as [string, ...string[]]),
      reason: z.string().trim().min(1),
      recheck_at: z.iso.date().optional().nullable(),
    })
    .parse(input);
  const p = await getRecord(db, "products", id);
  if (!p) fail("상품이 없습니다.");
  if (status === p.status) return p;
  if (["live", "paused"].includes(status))
    fail("판매 등록·운영 단계는 후속 M2에서 연결합니다.");
  if (status === "on_hold" && !recheck_at)
    fail("보류에는 재검토 날짜가 필요합니다.");
  const special = ["on_hold", "rejected", "discontinued"].includes(status),
    order = [
      "discovered",
      "researching",
      "costing",
      "pricing",
      "listing_ready",
    ];
  const current = order.indexOf(p.status),
    target = order.indexOf(status);
  if (!special && target > current) {
    if (target > current + 1 && current >= 0)
      fail("단계별 요건을 확인하며 순서대로 진행하세요.");
    if (!p.character_id || !p.category || !p.profile_id)
      fail("캐릭터·카테고리·판매 요건 프로필을 먼저 연결하세요.");
    const profile = await getRecord(db, "compliance_profiles", p.profile_id);
    if (!profile) fail("판매 요건 프로필이 없습니다.");
    if (target >= 2) {
      const offers = (await listRecords(db, "offers")).filter(
        (o) => o.product_id === id && o.status !== "rejected",
      );
      const claims = await readClaims(db);
      const attached = (
        await db
          .prepare(
            "SELECT owner_id FROM attachments WHERE owner_type='offers' AND deleted_at IS NULL",
          )
          .all<Row>()
      ).results;
      if (
        !offers.some(
          (o) =>
            attached.some((a) => a.owner_id === o.id) ||
            claims.some(
              (c) =>
                c.owner_type === "offers" &&
                c.owner_id === o.id &&
                c.attachment_ids.length,
            ),
        )
      )
        fail("실제 증빙이 첨부된 오퍼가 필요합니다.");
      if (
        !(await listRecords(db, "shipping_scenarios")).some(
          (s) => s.product_id === id,
        )
      )
        fail("배송 시나리오가 필요합니다.");
      if (profile.gate_result === "fail")
        fail(
          "판매 요건 실패: " +
            (profile.gate_reason || "요건 판정을 확인하세요."),
        );
    }
    if (target >= 3) {
      if (!["pass", "conditional"].includes(profile.gate_result))
        fail(
          "가격 결정 전 판매 요건이 통과 또는 조건부여야 합니다. 현재: " +
            profile.gate_result,
        );
      const s = p.current_costing_id
        ? await getRecord(db, "costings", p.current_costing_id)
        : null;
      if (!s || s.unknown_keys.length || !s.outputs)
        fail("미확인 항목이 없는 원가 스냅샷이 필요합니다.");
      if ((await snapshotChanged(db, s.id)).changed)
        fail("현재 값과 원가 스냅샷이 다릅니다. 다시 계산·저장하세요.");
    }
    if (target >= 4) {
      const model = await db
        .prepare("SELECT value_json FROM settings WHERE key='business_model'")
        .first<Row>();
      if (!model || JSON.parse(model.value_json) === "undecided")
        fail("사업 모델 D-01이 미결정입니다.");
      if (!p.pricing_decision_id)
        fail("가격 결정 이유·대안·재검토 조건을 기록하세요.");
      const incomplete = (await listRecords(db, "readiness_items")).filter(
        (r) =>
          r.blocks?.includes("product:listing_ready") &&
          !["done", "not_applicable"].includes(r.status),
      );
      if (incomplete.length)
        fail("사업 준비 미완료: " + incomplete.map((r) => r.title).join(", "));
    }
  }
  const r = await patchManaged(
    db,
    "products",
    p,
    {
      status,
      status_reason: reason,
      stage_entered_at: new Date().toISOString(),
      hold_recheck_at: status === "on_hold" ? recheck_at : null,
    },
    reason,
  );
  await reconcileTasks(db);
  return r;
}
export async function decidePrice(db: D1Database, id: string, input: unknown) {
  const { reason, alternatives, revisit_when } = z
    .object({
      reason: z.string().trim().min(1),
      alternatives: z
        .array(
          z.object({ option: z.string().min(1), why_not: z.string().min(1) }),
        )
        .min(1),
      revisit_when: z.string().trim().min(1),
    })
    .parse(input);
  const p = await getRecord(db, "products", id);
  if (!p || p.status !== "pricing") fail("가격 결정 단계에서 진행하세요.");
  const profile = p.profile_id
    ? await getRecord(db, "compliance_profiles", p.profile_id)
    : null;
  if (!profile || !["pass", "conditional"].includes(profile.gate_result))
    fail("판매 요건이 통과·조건부여야 합니다.");
  const snap = p.current_costing_id
    ? await snapshotChanged(db, p.current_costing_id)
    : null;
  if (
    !snap ||
    snap.changed ||
    !snap.data.outputs ||
    snap.data.unknown_keys.length
  )
    fail("현재 값과 일치하는 완전한 원가 스냅샷이 필요합니다.");
  const claims = await readClaims(db),
    sale = claims.find(
      (c) =>
        c.owner_type === "products" &&
        c.owner_id === id &&
        c.field_key === "sale_price",
    ),
    shipping = claims.find(
      (c) =>
        c.owner_type === "products" &&
        c.owner_id === id &&
        c.field_key === "customer_shipping_fee",
    );
  if (
    !sale ||
    !shipping ||
    sale.status === "unknown" ||
    shipping.status === "unknown"
  )
    fail("가정 판매가와 청구 배송비를 먼저 입력하세요.");
  if (
    sale.source_type === "competitor_observation" ||
    shipping.source_type === "competitor_observation"
  )
    fail(
      "경쟁사 관찰만으로 가격·배송비를 확정할 수 없습니다. 자체 비용과 정책 근거를 기록하세요.",
    );
  const decision = await saveRecord(
    db,
    "decisions",
    {
      title: `${p.name} · 가격 결정`,
      decision: `판매가 ${JSON.stringify(sale.value_json)}, 청구 배송비 ${JSON.stringify(shipping.value_json)}`,
      rationale: reason,
      alternatives_json: alternatives,
      revisit_when,
      status: "accepted",
      context: `원가 스냅샷 ${snap.data.id}`,
    },
    reason,
  );
  for (const [c, key] of [
    [sale, "decided_price"],
    [shipping, "decided_customer_shipping_fee"],
  ] as const) {
    const { id: unused, ...v } = c;
    await upsertClaim(
      db,
      { ...v, field_key: key, note: `${c.note} · 결정 ${decision.id}` },
      "user",
      { priceDecision: true },
    );
  }
  await saveRecord(
    db,
    "links",
    {
      from_type: "products",
      from_id: id,
      to_type: "decisions",
      to_id: decision.id,
      relation: "decided_by",
      note: reason,
    },
    reason,
  );
  const result = await patchManaged(
    db,
    "products",
    p,
    { pricing_decision_id: decision.id },
    reason,
  );
  await reconcileTasks(db);
  return result;
}
