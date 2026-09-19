import { describe, it, expect } from "vitest";
import { calculate } from "../../src/domain/calculate";
import { fixture } from "./calculator.test";
import { validateCostDirection } from "../../src/domain/costLineTypes";
import { normalizeClaim, weakest } from "../../src/domain/claim";
const input = {
  owner_type: "offer",
  owner_id: "test",
  field_key: "checkout_price",
  kind: "money",
  status: "confirmed",
  value_json: { amount_minor: 5990, currency: "CNY" },
  source_type: "url",
  source_ref: "https://example.com/offer",
  checked_at: "2026-09-16T00:00:00Z",
  recheck_by: "2026-10-16",
};
describe("R-01~05 and 5,900원 regression", () => {
  it("rejects customer shipping revenue as an expense regardless of 5,900 KRW amount", () => {
    const line = {
      code: "customer_shipping_fee",
      direction: "expense",
      money: { amount_minor: 5900, currency: "KRW" },
    };
    expect(() => validateCostDirection(line.code, line.direction)).toThrow(
      "수입·지출",
    );
    expect(() =>
      validateCostDirection("customer_shipping_fee", "income"),
    ).not.toThrow();
  });
  it("unknown input blocks all numeric outputs; absent claim also blocks", () => {
    const f = fixture();
    f.claims.checkout_price = normalizeClaim({
      ...input,
      status: "unknown",
      value_json: null,
    }).claim;
    delete f.claims["leg:2"];
    const r = calculate(f);
    expect(r.outputs).toBeNull();
    expect(r.unknown_keys).toEqual(
      expect.arrayContaining(["checkout_price", "leg:2"]),
    );
  });
  it("zero is a value and unknown cannot secretly contain zero", () => {
    expect(() =>
      normalizeClaim({
        ...input,
        status: "unknown",
        value_json: { amount_minor: 0, currency: "KRW" },
      }),
    ).toThrow();
    expect(
      normalizeClaim({
        ...input,
        value_json: { amount_minor: 0, currency: "KRW" },
      }).claim.value_json,
    ).toEqual({ amount_minor: 0, currency: "KRW" });
  });
  it("requires explicit status and source metadata", () => {
    expect(() => normalizeClaim({ ...input, status: undefined })).toThrow();
    expect(() => normalizeClaim({ ...input, source_ref: "" })).toThrow();
  });
  it("downgrades attachment-free price and propagates estimate", () => {
    expect(normalizeClaim(input)).toMatchObject({
      downgraded: true,
      claim: { status: "estimated" },
    });
    expect(weakest("confirmed", "estimated")).toBe("estimated");
  });
});
describe("D-01 purchase agency mode", () => {
  it("excludes duty and VAT from the seller's landed cost and marks them customer-paid", () => {
    // 예시 시트는 목록통관(세금 0)이라 세금이 있는 경우로 바꿔 검증한다: 관세 8%, 부가세 10%.
    const taxed = () => {
      const f = fixture();
      f.claims.duty = {
        kind: "percent",
        status: "confirmed",
        value_json: 800,
      } as any;
      f.claims.vat = {
        kind: "percent",
        status: "confirmed",
        value_json: 1000,
      } as any;
      return f;
    };
    const base = calculate(taxed());
    const agency = calculate({ ...taxed(), businessModel: "purchase_agency" });
    expect(base.outputs && agency.outputs).toBeTruthy();
    const duty = Number(
      base.lines.find((l) => l.code === "customs_duty")!.per_unit_minor,
    );
    const vat = Number(
      base.lines.find((l) => l.code === "customs_vat")!.per_unit_minor,
    );
    expect(duty + vat).toBeGreaterThan(0);
    expect(
      Number(base.outputs!.landed_per_unit) -
        Number(agency.outputs!.landed_per_unit),
    ).toBeCloseTo(duty + vat, 0);
    expect(Number(agency.outputs!.customer_tax_per_unit)).toBeCloseTo(
      duty + vat,
      0,
    );
    expect(agency.lines.find((l) => l.code === "customs_duty")!.payer).toBe(
      "customer",
    );
    expect(base.lines.find((l) => l.code === "customs_duty")!.payer).toBe("me");
    expect(agency.mode).toBe("purchase_agency");
    expect(
      agency.notes.some((n) => n.includes("소비자") && n.includes("착지원가")),
    ).toBe(true);
    expect(Number(agency.outputs!.contribution_per_unit)).toBeGreaterThan(
      Number(base.outputs!.contribution_per_unit),
    );
  });
  it("warns about the 150 USD list-clearance line only with a USD rate, and stays silent when unknown", () => {
    const noUsd = calculate({ ...fixture(), businessModel: "purchase_agency" });
    expect(noUsd.notes.some((n) => n.includes("USD 환율 기록이 필요"))).toBe(
      true,
    );
    const cheap = calculate({
      ...fixture(),
      businessModel: "purchase_agency",
      usdKrw: 1400,
    });
    const income = Number(cheap.outputs!.income_per_unit);
    const over = calculate({
      ...fixture(),
      businessModel: "purchase_agency",
      usdKrw: income / 200,
    });
    expect(over.notes.some((n) => n.includes("150달러를 넘습니다"))).toBe(true);
    expect(cheap.notes.some((n) => n.includes("150달러를 넘습니다"))).toBe(
      income / 1400 > 150,
    );
  });
});
