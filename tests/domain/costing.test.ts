import { describe, it, expect } from "vitest";
import { inspectCostingInputs } from "../../src/domain/costing";
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
    const known = normalizeClaim(input).claim;
    const unknown = normalizeClaim({
      ...input,
      status: "unknown",
      value_json: null,
    }).claim;
    expect(
      inspectCostingInputs({ goods: known, shipping: unknown, fx: null }),
    ).toEqual({
      overallStatus: "unknown",
      unknownKeys: ["shipping", "fx"],
      outputs: null,
    });
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
