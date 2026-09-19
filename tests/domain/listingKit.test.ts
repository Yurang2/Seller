import { describe, it, expect } from "vitest";
import { buildListingDraft } from "../../src/domain/listingKit";
const base = {
  product: {
    id: "p1",
    name: "접이식 노트북 거치대",
    category: "other",
    option_scheme: "designated",
    notes: "",
  },
  profile: {
    name: "무캐릭터(일반) × 데스크·수납(비전기)",
    gate_result: "unknown",
  },
  items: [
    {
      key: "labeling",
      item_result: "conditional",
      condition_text: "고지 문구 템플릿 적용\n리스팅에 해외구매대행 명시",
    },
  ],
  variants: [{ id: "v1", name: "실버", option_kind: "designated" }],
  claims: [] as any[],
  businessModel: "purchase_agency",
};
describe("listing draft", () => {
  it("leaves unknown values as gaps instead of inventing them", () => {
    const d = buildListingDraft(base as any);
    expect(d.markdown).toContain("[확인 필요]");
    expect(d.gaps.some((g) => g.includes("결정 판매가"))).toBe(true);
    expect(d.gaps.some((g) => g.includes("무게"))).toBe(true);
    expect(d.gaps.some((g) => g.startsWith("조건 이행 확인: labeling"))).toBe(
      true,
    );
    expect(d.markdown).toContain("무게(g) | [확인 필요]");
  });
  it("fills values from confirmed claims and adds purchase-agency notices", () => {
    const d = buildListingDraft({
      ...base,
      claims: [
        {
          owner_type: "products",
          owner_id: "p1",
          field_key: "decided_price",
          status: "confirmed",
          value_json: { amount_minor: 19900, currency: "KRW" },
        },
        {
          owner_type: "product_variants",
          owner_id: "v1",
          field_key: "weight_g",
          status: "estimated",
          value_json: 240,
        },
      ],
    } as any);
    expect(d.markdown).toContain("19,900 KRW");
    expect(d.markdown).toContain("240g");
    expect(d.gaps.some((g) => g.includes("결정 판매가"))).toBe(false);
    expect(d.notices.some((n) => n.includes("해외구매대행"))).toBe(true);
    expect(d.notices.some((n) => n.includes("개인통관고유부호"))).toBe(true);
    expect(d.notices.some((n) => n.includes("KC 인증을 받지 않았"))).toBe(
      false,
    );
  });
  it("adds the KC notice for textile profiles and the non-medical notice for fitness", () => {
    const t = buildListingDraft({
      ...base,
      profile: {
        name: "무캐릭터(일반) × 섬유 잡화(가방·파우치)",
        gate_result: "unknown",
      },
    } as any);
    // 국가기술표준원이 정한 문구 그대로여야 한다(요약·의역 금지).
    expect(t.notices).toContain("이 제품은 구매대행을 통하여 유통되는 제품임");
    expect(
      t.notices.some((n) =>
        n.includes(
          "「전기용품 및 생활용품 안전관리법」에 따른 안전관리대상 제품임",
        ),
      ),
    ).toBe(true);
    expect(t.notices.some((n) => n.includes("묶어 한 번에 고지할 수 없"))).toBe(
      true,
    );
    const f = buildListingDraft({
      ...base,
      profile: {
        name: "무캐릭터(일반) × 운동 소품(비의료)",
        gate_result: "unknown",
      },
    } as any);
    expect(f.notices.some((n) => n.includes("의료기기가 아닙니다"))).toBe(true);
  });
});
