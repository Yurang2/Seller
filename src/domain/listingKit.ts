// 상세페이지 초안 키트 (구매대행 · 스마트스토어 기준).
// 기록에서 확인된 값만 채우고, 나머지는 [확인 필요]로 남긴다(R-02 미확인 ≠ 0, R-10 가짜 자동화 금지).
export type KitProduct = {
  name: string;
  category?: string | null;
  option_scheme?: string | null;
  notes?: string | null;
  status?: string | null;
};
export type KitClaim = {
  owner_type: string;
  owner_id: string;
  field_key: string;
  status: string;
  value_json: unknown;
  note?: string | null;
};
export type KitProfile = {
  name: string;
  gate_result?: string | null;
  category?: string | null;
} | null;
export type KitItem = {
  key: string;
  item_result: string;
  condition_text?: string | null;
};
export type KitVariant = { id: string; name: string; option_kind?: string };
export type KitInput = {
  product: KitProduct & { id: string };
  profile: KitProfile;
  items: KitItem[];
  variants: KitVariant[];
  claims: KitClaim[];
  businessModel?: string | null;
  forwarderName?: string | null;
};
export type Draft = {
  title: string;
  sections: { heading: string; body: string }[];
  notices: string[];
  forbidden: string[];
  imageChecklist: string[];
  gaps: string[];
  markdown: string;
};
const GAP = "[확인 필요]";
// 섬유·가죽 등 안전기준준수대상 생활용품: 구매대행은 KC 표시 면제이나 리스팅 고지 필요.
const textileProfile = (p: KitProfile) =>
  !!p && /섬유|가방|파우치|반려동물|의류|매트|담요/.test(p.name);
const fitnessProfile = (p: KitProfile) =>
  !!p && /운동|마사지|요가|헬스/.test(p.name);
const money = (v: unknown) => {
  const m = v as { amount_minor?: number; currency?: string } | null;
  if (!m || m.amount_minor == null) return null;
  const n = ["CNY", "USD"].includes(m.currency ?? "")
    ? m.amount_minor / 100
    : m.amount_minor;
  return `${n.toLocaleString("ko-KR")} ${m.currency ?? "KRW"}`;
};
export function noticeBlock(opts: {
  purchaseAgency: boolean;
  textile: boolean;
  fitness: boolean;
  leadDays?: string | null;
}) {
  const out: string[] = [];
  if (opts.purchaseAgency) {
    out.push(
      "이 상품은 해외구매대행 상품입니다. 주문 후 해외 판매처에서 구매하여 국내로 배송되며, 수취인 명의로 통관됩니다.",
    );
    out.push(
      "통관을 위해 개인통관고유부호가 필요합니다. 주문 시 정확히 입력해 주세요(불일치 시 통관 지연·반송).",
    );
    out.push("원산지: 중국 (해외 판매처 표기 기준).");
    out.push(
      `배송 기간: 결제일 기준 ${opts.leadDays ?? GAP} (해외 발송·통관 사정에 따라 지연될 수 있음).`,
    );
    out.push(
      "미화 150달러(합산 기준) 초과 시 관·부가세가 발생할 수 있으며 수취인 부담입니다.",
    );
  }
  if (opts.textile) {
    // 국가기술표준원이 정한 구매대행 고지 문구를 그대로 쓴다(임의 표현으로 바꾸지 않는다).
    // 출처: 국가기술표준원 "안전관리대상 전기용품의 표시" https://www.kats.go.kr/content.do?cmsid=227
    out.push("이 제품은 구매대행을 통하여 유통되는 제품임");
    out.push(
      "이 제품은 「전기용품 및 생활용품 안전관리법」에 따른 안전관리대상 제품임",
    );
    out.push(
      "위 두 문구는 상품별로 각각 고지해야 하며, 여러 상품을 묶어 한 번에 고지할 수 없습니다(국가기술표준원 표시 지침).",
    );
  }
  if (opts.fitness)
    out.push(
      "본 제품은 운동 보조 용품이며 의료기기가 아닙니다. 질병의 치료·예방 효과가 없습니다.",
    );
  out.push(
    "청약철회: 상품 수령 후 7일 이내 가능. 단순 변심 반품 시 해외 반송비 실비가 부과됩니다(반품 전 문의 필수). 제품 하자·오배송은 판매자 부담.",
  );
  out.push(
    "통관 완료·수취인 명의 배송 특성상 개봉·사용 후, 택 제거 후, 세트 구성품 분실 시 반품이 제한될 수 있습니다.",
  );
  return out;
}
export const forbiddenExpressions = [
  "브랜드명·캐릭터명 병기(예: '○○ 스타일', '△△ 대체품')",
  "최상급·단정 표현('최고', '1위', '100%')과 근거 없는 수치",
  "의료·건강 효능('치료', '근막 이완 효과', '혈액순환 개선', '다이어트')",
  "KC 인증·정품 보증 문구(인증받지 않은 제품에 KC·정품 표기 금지)",
  "어린이·유아 대상 연상 문구·연령 표기(성인용 상품군 전제)",
  "공급처 상세 이미지·문구 복사(허락 없는 이미지 무단 사용)",
];
export const imageChecklist = [
  "대표 이미지 1장: 흰 배경, 상품 전체, 텍스트 없음(스마트스토어 권장 1000×1000 이상)",
  "실물 촬영 4~6장: 정면·측면·뒷면·디테일·크기 비교(자 또는 손), 구성품 전체",
  "사용 장면 1~2장: 실제 용도(책상 위·차량 내부·운동 장면)",
  "사이즈 도해 1장: 가로·세로·높이(mm)와 무게(g)를 표기",
  "고지 블록 이미지 1장: 위 고지 문구를 이미지로도 넣어 모바일에서 누락 방지",
  "공급처 이미지를 쓸 경우: 사용 허락 캡처를 근거 첨부(listing_assets 항목)",
];
export function buildListingDraft(input: KitInput): Draft {
  const { product: p, profile, items, variants, claims } = input;
  const c = (type: string, id: string, key: string) =>
    claims.find(
      (x) =>
        x.owner_type === type &&
        x.owner_id === id &&
        x.field_key === key &&
        x.status !== "unknown",
    );
  const gaps: string[] = [];
  const need = (label: string, ok: boolean) => {
    if (!ok) gaps.push(label);
  };
  const price = c("products", p.id, "decided_price");
  const ship = c("products", p.id, "decided_customer_shipping_fee");
  const age = c("products", p.id, "age_marking");
  need("결정 판매가(가격 결정 화면에서 기록)", !!price);
  need("결정 청구 배송비", !!ship);
  const weights = variants
    .map((v) => ({ v, w: c("product_variants", v.id, "weight_g") }))
    .filter((x) => x.w);
  const dims = variants
    .map((v) => ({ v, d: c("product_variants", v.id, "dims_mm") }))
    .filter((x) => x.d);
  need("옵션별 무게(g) 근거", weights.length > 0 || variants.length === 0);
  need("옵션별 치수(mm) 근거", dims.length > 0 || variants.length === 0);
  need("상품 옵션 기록(옵션 방식 지정/세트/랜덤)", variants.length > 0);
  need(
    "판매 요건 게이트 통과·조건부",
    !!profile && ["pass", "conditional"].includes(profile.gate_result ?? ""),
  );
  for (const it of items)
    if (it.item_result === "conditional" && it.condition_text)
      gaps.push(
        `조건 이행 확인: ${it.key} · ${it.condition_text.split("\n")[0]}`,
      );
  const purchaseAgency =
    (input.businessModel ?? "purchase_agency") !== "import_resale";
  const notices = noticeBlock({
    purchaseAgency,
    textile: textileProfile(profile),
    fitness: fitnessProfile(profile),
    leadDays: null,
  });
  const optionLine =
    variants.length === 0
      ? `${GAP} 옵션 기록 없음`
      : variants
          .map((v) => {
            const w = weights.find((x) => x.v.id === v.id)?.w;
            const d = dims.find((x) => x.v.id === v.id)?.d;
            return `${v.name}${v.option_kind === "random" ? " (랜덤)" : ""} · ${d ? String(d.value_json) : GAP + " 치수"} · ${w ? String(w.value_json) + "g" : GAP + " 무게"}`;
          })
          .join("\n");
  const sections = [
    {
      heading: "핵심 5줄 (첫 화면)",
      body: [
        `1. ${p.name} — ${GAP} 한 줄 용도(예: '노트북을 눈높이로, 접으면 200g')`,
        `2. 소재·구성: ${GAP}`,
        `3. 크기·무게: ${dims[0] ? String(dims[0].d!.value_json) : GAP} · ${weights[0] ? String(weights[0].w!.value_json) + "g" : GAP}`,
        `4. 배송: 해외구매대행 · 결제 후 ${GAP}일 · 통관부호 필요`,
        `5. 반품: 7일 청약철회 · 단순변심 반송비 실비`,
      ].join("\n"),
    },
    {
      heading: "옵션 표기",
      body: optionLine,
    },
    {
      heading: "스펙 표",
      body: [
        `상품명 | ${p.name}`,
        `카테고리 | ${p.category ?? GAP}`,
        `옵션 방식 | ${p.option_scheme ?? GAP}`,
        `소재 | ${GAP}`,
        `크기(mm) | ${dims[0] ? String(dims[0].d!.value_json) : GAP}`,
        `무게(g) | ${weights[0] ? String(weights[0].w!.value_json) : GAP}`,
        `원산지 | 중국`,
        `연령 표시 | ${age ? String(age.value_json) : "성인용 (14세 이상)"}`,
        `판매가 | ${price ? money(price.value_json) : GAP}`,
        `배송비 | ${ship ? money(ship.value_json) : GAP}`,
      ].join("\n"),
    },
    {
      heading: "사용 장면 · 설명",
      body: `${GAP} 실제 용도 2~3문단. 공급처 문구 복사 금지, 효능·최상급 표현 금지.\n메모: ${p.notes ?? ""}`,
    },
    {
      heading: "고지 블록 (필수)",
      body: notices.map((n) => "· " + n).join("\n"),
    },
  ];
  const markdown = [
    `# ${p.name}`,
    "",
    ...sections.flatMap((s) => [`## ${s.heading}`, s.body, ""]),
    "## 금지 표현 점검",
    ...forbiddenExpressions.map((f) => "- " + f),
    "",
    "## 이미지 체크리스트",
    ...imageChecklist.map((f) => "- [ ] " + f),
    "",
    gaps.length ? "## 채워야 할 것" : "",
    ...gaps.map((g) => "- " + g),
  ].join("\n");
  return {
    title: p.name,
    sections,
    notices,
    forbidden: forbiddenExpressions,
    imageChecklist,
    gaps,
    markdown,
  };
}
