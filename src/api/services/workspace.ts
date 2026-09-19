import { ulid } from "ulid";
import { catalog, claimLabels } from "../../domain/records/catalog";
import { costLineTypes } from "../../domain/costLineTypes";
import { readClaims } from "../../db/repo/claims";
import { isStale } from "../../domain/claim";
import { gradeProduct, type GradeResult } from "../../domain/grade";
import {
  saveRecord,
  loadRecords,
  listSql,
  decode,
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
  // 있는지 확인은 batch 한 번으로 끝내고, 없는 것만 쓴다(정상 상태에서는 D1 호출 1회).
  const [haveSettings, haveClt, haveReadiness, haveSops] = await db.batch<Row>([
    db.prepare("SELECT key FROM settings"),
    db.prepare("SELECT code FROM cost_line_types"),
    db.prepare("SELECT key FROM readiness_items"),
    db.prepare("SELECT key FROM sops WHERE deleted_at IS NULL"),
  ]);
  const has = {
    settings: new Set(haveSettings.results.map((r) => r.key)),
    clt: new Set(haveClt.results.map((r) => r.code)),
    readiness: new Set(haveReadiness.results.map((r) => r.key)),
    sops: new Set(haveSops.results.map((r) => r.key)),
  };
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
    if (!has.settings.has(key))
      await setSetting(db, key, v, "초기 설정 · 미결정 유지", "import:seed");
  for (const [
    code,
    name,
    direction,
    stage,
    payer_default,
    basis,
  ] of costLineTypes) {
    if (has.clt.has(code)) continue;
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
    if (!has.readiness.has(key))
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
  // 연동이 없는 동안 사람이 따라 할 절차. 연동이 생겨도 "수동 대체 절차"로 남는다(PLAN 10.3).
  for (const sop of manualSops)
    if (!has.sops.has(sop.key))
      await saveRecord(db, "sops", sop, "수동 절차 초기화", "import:seed");
}
const manualSops = [
  {
    key: "listing_page_manual",
    title: "상세페이지 만들기 (수동)",
    inputs:
      "상품 기록(옵션·무게·치수 근거), 판매 요건 게이트 통과·조건부, 결정 판매가·청구 배송비, 직접 촬영 이미지 6장, 상세페이지 초안(상품 화면에서 복사)",
    outputs:
      "채널 편집기에 붙인 상세페이지(핵심 5줄·옵션·스펙표·사용 장면·고지 블록), 이미지 6장 업로드, 금지 표현 점검 완료",
    failure_handling:
      "초안의 [확인 필요]가 남아 있으면 게시하지 않는다. 채널이 문구를 반려하면 반려 문구를 등록 상품 메모에 적고 고지 블록을 수정한다.",
    steps_json: [
      {
        n: 1,
        text: "상품 화면의 '상세페이지 초안'을 열어 [확인 필요] 목록을 본다. 무게·치수·가격은 기록(근거)에서 채운다.",
        check: "[확인 필요] 0개",
      },
      {
        n: 2,
        text: "실물 사진 6장을 촬영한다(대표 1·디테일 4·사용 장면 1). 공급처 이미지는 허락 캡처가 있을 때만.",
        check: "이미지 6장 · 허락 근거",
      },
      {
        n: 3,
        text: "핵심 5줄과 사용 장면 문단을 직접 쓴다. 금지 표현 목록(브랜드 병기·효능·최상급·KC/정품 문구)을 점검한다.",
        check: "금지 표현 0건",
      },
      {
        n: 4,
        text: "고지 블록(해외구매대행·통관부호·원산지·배송 기간·관부가세·KC 미인증(섬유)·반품 실비)을 본문 끝과 이미지 1장으로 넣는다.",
        check: "고지 블록 텍스트+이미지",
      },
      {
        n: 5,
        text: "상품명은 50자 이내, 브랜드명 없이 '용도 + 핵심 스펙 + 옵션' 순서로 쓴다. 옵션명은 초안의 옵션 표기와 같게.",
        check: "상품명·옵션 일치",
      },
      {
        n: 6,
        text: "채널 편집기에 붙여 미리보기로 모바일 화면을 확인한 뒤, '채널에 상품 올리기 (수동)' 절차로 넘어간다.",
        check: "모바일 미리보기 확인",
      },
    ],
  },
  {
    key: "listing_manual",
    title: "채널에 상품 올리기 (수동)",
    inputs:
      "상품이 등록 준비 단계일 것, 결정 판매가·청구 배송비, 판매 요건 통과·조건부, 직접 촬영한 이미지, 고지 문구(구매대행·랜덤·원산지·반품)",
    outputs:
      "채널 상품 번호·URL이 적힌 등록 상품 기록(판매 중), 상품 단계 '판매 중'",
    failure_handling:
      "채널이 상품을 반려하면 반려 사유를 등록 상품 메모에 적고 상태를 등록 준비로 둔다. 요건 항목과 관련되면 해당 항목을 재판정한다.",
    steps_json: [
      {
        n: 1,
        text: "상품의 '채널 등록' 섹션에서 등록 상품 기록을 만든다(상태: 등록 준비). 등록 판매가는 결정 판매가와 같아야 한다.",
        check: "등록 상품 기록 존재",
      },
      {
        n: 2,
        text: "채널 판매자 센터에서 상품을 등록한다. 상세페이지 이미지는 직접 촬영본만 쓴다.",
        check: "채널 상품 번호 발급",
      },
      {
        n: 3,
        text: "고지 문구를 채널 상세에 그대로 넣는다: 구매대행 여부·개인통관고유부호 안내(해당 시), 랜덤 구성 고지, 원산지, 반품·교환 조건.",
        check: "고지 문구 4종 노출",
      },
      {
        n: 4,
        text: "채널에서 노출을 확인한 날짜, 상품 번호, URL을 등록 상품 기록에 적고 상태를 '판매 중'으로 바꾼다.",
        check: "등록 상품 판매 중",
      },
      {
        n: 5,
        text: "상품 단계를 '판매 중'으로 변경한다(이유 기록).",
        check: "상품 단계 판매 중",
      },
    ],
  },
  {
    key: "orders_manual",
    title: "주문 처리 (수동 · 주문 기능 전까지)",
    inputs: "채널 판매자 센터 주문 목록",
    outputs: "주문별 발주·발송·정산 기록(현재는 지식 노트 '일지'로 남긴다)",
    failure_handling:
      "발주 불가(품절·가격 변동)면 고객에게 즉시 안내하고 취소 처리한다. 사유를 일지에 남긴다.",
    steps_json: [
      {
        n: 1,
        text: "매일 채널 판매자 센터에서 신규 주문을 확인한다.",
        check: "신규 주문 0건 또는 목록 확보",
      },
      {
        n: 2,
        text: "주문 기록을 만든다(채널 주문번호·주문일·수량·상품). 통관부호는 채널 주문 화면에서만 확인하고 앱에는 '수집 여부'만 기록한다.",
        check: "주문 기록 · 통관부호 수집 여부",
      },
      {
        n: 3,
        text: "공급처에서 발주하고 결제 화면을 캡처해 주문의 '공급처 실결제액' 근거로 첨부한다. 상태를 발주로 바꾼다.",
        check: "결제 캡처 첨부 · 상태 발주",
      },
      {
        n: 4,
        text: "배대지 출고 후 송장번호를 주문에 적고 채널에 발송 처리한다. 상태를 발송으로 바꾼다.",
        check: "송장번호 · 채널 발송 처리",
      },
      {
        n: 5,
        text: "배송완료일을 적고, 채널 정산이 들어오면 정산 내역 캡처를 '채널 정산액' 근거로 첨부한 뒤 상태를 정산으로 바꾼다.",
        check: "배송완료일 · 정산액 근거 · 상태 정산",
      },
    ],
  },
];
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
  // 읽기는 batch 한 번(부속 요청 1회). 쓰기는 조건이 바뀐 작업에만 일어난다.
  const READ_TYPES = [
    "products",
    "compliance_profiles",
    "requirement_items",
    "offers",
    "shipping_scenarios",
    "costings",
    "listings",
    "readiness_items",
    "tasks",
    "orders",
  ];
  const [modelRow, ...lists] = await db.batch<Row>([
    db.prepare("SELECT value_json FROM settings WHERE key='business_model'"),
    ...READ_TYPES.map((t) => db.prepare(listSql(t))),
  ]);
  const claims = await readClaims(db);
  const recs = Object.fromEntries(
    READ_TYPES.map((t, i) => [t, lists[i].results.map((r) => decode(r, t)!)]),
  ) as Record<string, Row[]>;
  const model = modelRow.results[0] ?? null;
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
  const ownerTypes = [...new Set(claims.map((c) => c.owner_type))].filter(
    (t) => catalog[t] && !recs[t],
  );
  Object.assign(recs, await loadRecords(db, ownerTypes));
  const owners = new Map<string, Set<string>>();
  for (const type of new Set(claims.map((c) => c.owner_type)))
    if (catalog[type]) owners.set(type, new Set(recs[type].map((r) => r.id)));
  for (const c of claims)
    if (
      isStale(c, today()) &&
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
  const products = recs.products,
    profiles = recs.compliance_profiles,
    offers = recs.offers,
    scenarios = recs.shipping_scenarios;
  const plusDays = (n: number) => {
    const d = new Date(today() + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // 보류·거절·종료된 상품만 쓰는 프로필은 요건 확인을 재촉하지 않는다(재검토 시 상품 단계가 돌아오면 다시 생긴다).
  const activeProducts = products.filter(
    (x) => !["on_hold", "rejected", "discontinued"].includes(x.status),
  );
  for (const p of profiles)
    if (
      activeProducts.some((x) => x.profile_id === p.id) &&
      p.gate_result === "unknown"
    )
      add(
        "profile_gate_unknown",
        "compliance_profiles",
        p.id,
        `요건 확인: ${p.name}`,
        1,
        {
          status: "blocked",
          blocked_kind: "external",
          blocked_reason:
            "판매 요건 항목 중 미확인이 남아 있습니다: " +
            (p.gate_reason
              ?.split("\n")
              .filter((x: string) => x.includes("unknown")).length ?? "?") +
            "개. 기관 회신·권리자 자료·법령 확인이 필요합니다.",
          unblock_condition:
            "13개 요건 항목을 모두 통과·조건부·실패 중 하나로 판정",
          recheck_at: plusDays(14),
        },
      );
  for (const i of recs.requirement_items)
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
      const c = recs.costings.find((x) => x.id === p.current_costing_id);
      if (c?.unknown_keys?.length)
        add(
          "costing_unknown",
          "costings",
          c.id,
          `${p.name} · 미확인 입력 ${c.unknown_keys.length}개`,
          1,
          {
            detail: c.unknown_keys.join(", "),
            status: "blocked",
            blocked_kind: "internal",
            blocked_reason:
              "원가 계산에 미확인 입력이 있습니다: " +
              c.unknown_keys.join(", "),
            unblock_condition:
              "미확인 입력을 확인·추정으로 기록한 뒤 스냅샷을 다시 저장",
            recheck_at: plusDays(7),
          },
        );
    }
    if (
      ["listing_ready", "live"].includes(p.status) &&
      !recs.listings.some((l) => l.product_id === p.id && l.status === "live")
    )
      add(
        "product_needs_listing",
        "products",
        p.id,
        `${p.name} · 채널에 올리고 등록 상품 기록`,
        p.status === "live" ? 1 : 3,
        { detail: "절차: 채널에 상품 올리기 (수동)" },
      );
  }
  // 주문(M3): 접수 후 1일 지나도 발주 없음 / 발송인데 송장 없음 / 배송완료 14일 지나도 정산 없음.
  const daysAgo = (n: number) => plusDays(-n);
  for (const o of recs.orders ?? []) {
    const productName =
      products.find((p) => p.id === o.product_id)?.name ?? o.order_no;
    if (o.status === "received" && (o.ordered_at ?? "") <= daysAgo(1))
      add(
        "order_needs_purchase",
        "orders",
        o.id,
        `발주하기: ${productName} · 주문 ${o.order_no}`,
        1,
        {
          detail: "공급처에서 결제하고 결제 캡처를 공급처 실결제액 근거로 첨부",
        },
      );
    if (o.status === "shipped_cn" && !o.tracking_no)
      add(
        "order_needs_tracking",
        "orders",
        o.id,
        `송장 기록: ${productName} · 주문 ${o.order_no}`,
        2,
        { detail: "배대지 출고 송장번호를 적고 채널에 발송 처리" },
      );
    if (
      o.status === "delivered" &&
      o.delivered_at &&
      o.delivered_at <= daysAgo(14) &&
      !o.settled_at
    )
      add(
        "order_needs_settlement",
        "orders",
        o.id,
        `정산 확인: ${productName} · 주문 ${o.order_no}`,
        2,
        {
          detail:
            "채널 정산 내역 캡처를 채널 정산액 근거로 첨부하고 상태를 정산으로",
        },
      );
  }
  for (const r of recs.readiness_items)
    if (r.status === "blocked" && r.recheck_at && r.recheck_at < today())
      add(
        "readiness_recheck",
        "readiness_items",
        r.id,
        `재확인: ${r.title}`,
        2,
      );
  const existing = recs.tasks.filter(
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
const decodeJob = (r: Row) => ({
  ...r,
  summary: r.summary_json ? JSON.parse(r.summary_json) : null,
});
export async function workspace(db: D1Database) {
  // 초기 설정·비용 사전·준비 항목·수동 절차는 멱등이라 매번 보장한다(새 항목이 추가돼도 기존 DB에 채워진다).
  await initialize(db);
  await reconcileTasks(db);
  // 모든 종류·설정·최근 활동을 batch 한 번으로 읽는다(원격 D1 왕복 1회). 근거는 batch 1회 더.
  const types = Object.keys(catalog);
  const res = await db.batch<Row>([
    ...types.map((t) => db.prepare(listSql(t))),
    db.prepare("SELECT * FROM settings"),
    db.prepare("SELECT * FROM activity_log ORDER BY at DESC LIMIT 200"),
  ]);
  const records: Record<string, Row[]> = Object.fromEntries(
    types.map((t, i) => [t, res[i].results.map((r) => decode(r, t)!)]),
  );
  const claims = await readClaims(db);
  const settings = Object.fromEntries(
    res[types.length].results.map((r) => [r.key, JSON.parse(r.value_json)]),
  );
  const activity = res[types.length + 1].results;
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
  const grades: Record<string, GradeResult> = {};
  for (const p of records.products)
    grades[p.id] = gradeProduct({
      product: p as any,
      profile:
        (records.compliance_profiles.find(
          (r) => r.id === p.profile_id,
        ) as any) ?? null,
      items: records.requirement_items.filter(
        (i) => i.profile_id === p.profile_id,
      ) as any,
      openTasks: records.tasks.filter(
        (t) =>
          !["done", "cancelled"].includes(t.status) &&
          ((t.entity_type === "products" && t.entity_id === p.id) ||
            (t.entity_type === "compliance_profiles" &&
              t.entity_id === p.profile_id) ||
            (t.entity_type === "costings" &&
              t.entity_id === p.current_costing_id)),
      ) as any,
      costing: (p.current_costing_id
        ? records.costings.find((c) => c.id === p.current_costing_id)
        : null) as any,
    });
  return {
    records,
    claims,
    settings,
    activity,
    recent,
    grades,
    stale: claims.filter(
      (c) =>
        isStale(c, today()) &&
        (!catalog[c.owner_type] ||
          records[c.owner_type]?.some((r) => r.id === c.owner_id)),
    ),
    cost_line_types: (
      await db
        .prepare("SELECT * FROM cost_line_types ORDER BY sort_order")
        .all()
    ).results,
    last_digest: (await db
      .prepare(
        "SELECT * FROM job_runs WHERE job_key='daily_digest' ORDER BY started_at DESC LIMIT 1",
      )
      .first<Row>())
      ? decodeJob(
          (await db
            .prepare(
              "SELECT * FROM job_runs WHERE job_key='daily_digest' ORDER BY started_at DESC LIMIT 1",
            )
            .first<Row>())!,
        )
      : null,
    automation: "none",
    mode:
      settings.mode_override === "operations" ||
      (settings.mode_override !== "research" &&
        records.listings?.some((l) => l.status === "live"))
        ? "operations"
        : "research",
  };
}
