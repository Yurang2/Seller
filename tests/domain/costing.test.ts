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
