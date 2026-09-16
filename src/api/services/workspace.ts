import { ulid } from "ulid";
import { catalog, claimLabels } from "../../domain/records/catalog";
import { costLineTypes } from "../../domain/costLineTypes";
import { readClaims } from "../../db/repo/claims";
import {
  saveRecord,
  listRecords,
  getRecord,
  audit,
  today,
  fail,
  patchManaged,
  type Row,
} from "./records";
const readiness = [
  ["model_decided", "사업 모델 결정", "decision", []],
  [
    "category_gate_pingu_plush",
    "핑구 봉제인형 판매 요건",
    "legal",
    ["model_decided"],
  ],
  [
    "category_gate_pingu_keyring",
    "핑구 키링 판매 요건",
    "legal",
    ["model_decided"],
  ],
  ["biz_registration", "사업자 등록", "legal", ["model_decided"]],
  ["mail_order_report", "통신판매업 신고", "legal", ["biz_registration"]],
  [
    "customs_code_or_biz_customs",
    "통관 절차·부호 준비",
    "customs",
    ["model_decided"],
  ],
  ["channel_account", "판매 채널 계정", "channel", ["biz_registration"]],
  ["payment_settlement", "결제·정산 계좌", "finance", ["channel_account"]],
  [
    "logistics_route",
    "배송 경로 견적·검수 절차",
    "logistics",
    ["model_decided"],
  ],
  [
    "shipping_fee_policy",
    "고객 청구 배송비 정책",
    "policy",
    ["logistics_route"],
  ],
  ["return_policy_text", "반품·교환·랜덤 고지", "policy", ["channel_account"]],
  ["privacy_policy", "개인정보 처리·보관 정책", "policy", ["channel_account"]],
  ["tax_evidence_sop", "세무 증빙 절차", "tax", ["model_decided"]],
  ["backup_verified", "빈 DB 백업·복원 검증", "ops", []],
] as const;
export async function setSetting(
  db: D1Database,
  key: string,
  value: unknown,
  reason: string,
  actor = "user",
) {
  if (!reason?.trim()) fail("설정 변경 이유가 필요합니다.");
  const before = await db
    .prepare("SELECT * FROM settings WHERE key=?")
    .bind(key)
    .first();
  const after = {
    key,
    value_json: JSON.stringify(value),
    updated_at: new Date().toISOString(),
  };
  await db.batch([
    db
      .prepare(
        "INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
      )
      .bind(key, after.value_json, after.updated_at),
    audit(db, "settings", key, before, after, reason, actor),
  ]);
}
export async function initialize(db: D1Database) {
  const settings: Row = {
    business_model: "undecided",
    mode_override: "auto",
    default_fx_source: null,
    pii_retention_days: null,
    recheck_defaults_json: {
      price: 30,
      shipping: 30,
      fx: 1,
      requirements: 180,
      other: 90,
    },
    target_margin_rate: null,
    monthly_fixed_costs: null,
    expected_monthly_units: null,
  };
  for (const [key, v] of Object.entries(settings))
    if (
      !(await db
        .prepare("SELECT key FROM settings WHERE key=?")
        .bind(key)
        .first())
    )
      await setSetting(db, key, v, "초기 설정 · 미결정 유지", "import:seed");
  for (const [
    code,
    name,
    direction,
    stage,
    payer_default,
    basis,
  ] of costLineTypes) {
    if (
      await db
        .prepare("SELECT code FROM cost_line_types WHERE code=?")
        .bind(code)
        .first()
    )
      continue;
    const row = {
      code,
      name,
      direction,
      stage,
      payer_default,
      basis,
      is_system: 1,
      active: 1,
      sort_order: costLineTypes.findIndex((c) => c[0] === code),
    };
    await db.batch([
      db
        .prepare(
          "INSERT INTO cost_line_types(code,name,direction,stage,payer_default,basis,is_system,active,sort_order) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(...Object.values(row)),
      audit(
        db,
        "cost_line_types",
        code,
        null,
        row,
        "초기 비용 사전",
        "import:seed",
      ),
    ]);
  }
  for (const [key, title, category, depends_on] of readiness)
    if (
      !(await db
        .prepare("SELECT id FROM readiness_items WHERE key=?")
        .bind(key)
        .first())
    )
      await saveRecord(
        db,
        "readiness_items",
        {
          key,
          title,
          category,
          depends_on: [...depends_on],
          blocks: ["product:listing_ready"],
        },
        "사업 준비 체크리스트 초기화",
        "import:seed",
        true,
      );
}
export async function reconcileTasks(db: D1Database) {
  const wanted: Row[] = [];
  const add = (
    rule_key: string,
    entity_type: string,
    entity_id: string,
    title: string,
    priority: number,
    extra: Row = {},
  ) =>
    wanted.push({
      rule_key,
      entity_type,
      entity_id,
      title,
      priority,
      source: "derived",
      status: "todo",
      ...extra,
    });
  const model = await db
    .prepare("SELECT value_json FROM settings WHERE key='business_model'")
    .first<Row>();
  if (!model || JSON.parse(model.value_json) === "undecided")
    add(
      "decide_business_model",
      "settings",
      "business_model",
      "D-01 사업 모델 결정",
      1,
      {
        status: "blocked",
        blocked_kind: "decision",
        blocked_reason: "사업 모델이 아직 미결정입니다.",
        unblock_condition: "근거와 함께 사업 모델 선택",
        recheck_at: today(),
      },
    );
  const claims = await readClaims(db);
  const owners = new Map<string, Set<string>>();
  for (const type of new Set(claims.map((c) => c.owner_type)))
    if (catalog[type])
      owners.set(type, new Set((await listRecords(db, type)).map((r) => r.id)));
  for (const c of claims)
    if (
      c.recheck_by < today() &&
      (!owners.has(c.owner_type) || owners.get(c.owner_type)!.has(c.owner_id))
    )
      add(
        "claim_stale",
        "claims",
        c.id,
        `재확인: ${claimLabels[c.field_key] ?? c.field_key}`,
        2,
        { detail: `기한 ${c.recheck_by} · ${c.source_ref ?? "출처 미확인"}` },
      );
  const products = await listRecords(db, "products"),
    profiles = await listRecords(db, "compliance_profiles"),
    offers = await listRecords(db, "offers"),
    scenarios = await listRecords(db, "shipping_scenarios");
  for (const p of profiles)
    if (
      products.some((x) => x.profile_id === p.id) &&
      p.gate_result === "unknown"
    )
      add(
        "profile_gate_unknown",
        "compliance_profiles",
        p.id,
        `요건 확인: ${p.name}`,
        1,
      );
  for (const i of await listRecords(db, "requirement_items"))
    if (i.item_result === "conditional")
      add(
        "requirement_condition",
        "requirement_items",
        i.id,
        `조건 이행: ${i.question}`,
        1,
        { detail: i.condition_text },
      );
  for (const p of products) {
    if (!p.profile_id && p.status === "discovered")
      add(
        "product_needs_profile",
        "products",
        p.id,
        `${p.name} · 요건 프로필 연결`,
        3,
      );
    if (
      p.status === "researching" &&
      !offers.some((o) => o.product_id === p.id)
    )
      add("product_needs_offer", "products", p.id, `${p.name} · 오퍼 입력`, 3);
    if (
      p.status === "researching" &&
      !scenarios.some((s) => s.product_id === p.id)
    )
      add(
        "product_needs_scenario",
        "products",
        p.id,
        `${p.name} · 배송 경로 입력`,
        3,
      );
    if (p.status === "pricing" && !p.pricing_decision_id)
      add(
        "pricing_needs_decision",
        "products",
        p.id,
        `${p.name} · 가격 결정 이유 기록`,
        3,
      );
    if (p.current_costing_id) {
      const c = await getRecord(db, "costings", p.current_costing_id);
      if (c?.unknown_keys?.length)
        add(
          "costing_unknown",
          "costings",
          c.id,
          `${p.name} · 미확인 입력 ${c.unknown_keys.length}개`,
          1,
          { detail: c.unknown_keys.join(", ") },
        );
    }
  }
  for (const r of await listRecords(db, "readiness_items"))
    if (r.status === "blocked" && r.recheck_at && r.recheck_at < today())
      add(
        "readiness_recheck",
        "readiness_items",
        r.id,
        `재확인: ${r.title}`,
        2,
      );
  const existing = (await listRecords(db, "tasks")).filter(
    (t) => t.source === "derived" && !["done", "cancelled"].includes(t.status),
  );
  const key = (t: Row) => `${t.rule_key}:${t.entity_type}:${t.entity_id}`;
  for (const t of wanted) {
    const old = existing.find((o) => key(o) === key(t));
    if (!old)
      await saveRecord(
        db,
        "tasks",
        t,
        "현재 기록의 조건에서 생성",
        "rule:derive",
        true,
      );
  }
  const wantedKeys = new Set(wanted.map(key));
  for (const t of existing)
    if (!wantedKeys.has(key(t)))
      await patchManaged(
        db,
        "tasks",
        t,
        { status: "done", completed_at: new Date().toISOString() },
        "원본 조건 해소",
        "rule:derive",
      );
}
export async function workspace(db: D1Database) {
  await reconcileTasks(db);
  const records: Record<string, Row[]> = {};
  for (const type of Object.keys(catalog))
    records[type] = await listRecords(db, type);
  const claims = await readClaims(db);
  const settings = Object.fromEntries(
    (await db.prepare("SELECT * FROM settings").all<Row>()).results.map((r) => [
      r.key,
      JSON.parse(r.value_json),
    ]),
  );
  const activity = (
    await db
      .prepare("SELECT * FROM activity_log ORDER BY at DESC LIMIT 200")
      .all<Row>()
  ).results;
  const seen = new Set<string>();
  const recent = activity
    .filter(
      (a) =>
        a.actor === "user" &&
        catalog[a.entity_type] &&
        records[a.entity_type].some((r) => r.id === a.entity_id) &&
        !seen.has(a.entity_type + ":" + a.entity_id) &&
        (seen.add(a.entity_type + ":" + a.entity_id), true),
    )
    .slice(0, 3);
  return {
    records,
    claims,
    settings,
    activity,
    recent,
    stale: claims.filter((c) => c.recheck_by < today()),
    cost_line_types: (
      await db
        .prepare("SELECT * FROM cost_line_types ORDER BY sort_order")
        .all()
    ).results,
    automation: "none",
    mode: "research",
  };
}
