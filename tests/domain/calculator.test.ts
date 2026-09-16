import { expect, it } from "vitest";
import {
  calculate,
  type CalcInput,
  type CalcClaim,
  requiredKeys,
} from "../../src/domain/calculate";
import ex from "./calc-ex1.json";
const c = (value: unknown, kind: CalcClaim["kind"] = "number"): CalcClaim => ({
  kind,
  status: "estimated",
  value_json: value,
});
const money = (n: number, currency = "KRW") =>
  c({ amount_minor: n * (currency === "CNY" ? 100 : 1), currency }, "money");
export function fixture(): CalcInput {
  return {
    fx: {
      id: "fixture",
      base_currency: "CNY",
      rate: ex.G,
      as_of_date: ex.H,
      source: ex.I,
      kind: "manual",
    },
    legs: [
      { id: "1", code: "cn_domestic_shipping", basis: "per_parcel" },
      { id: "2", code: "intl_shipping", basis: "per_parcel" },
      { id: "3", code: "kr_domestic_shipping", basis: "per_parcel" },
    ],
    claims: {
      checkout_price: money(Number(ex.W), "CNY"),
      parcel_items: c(Number(ex.Z)),
      sale_price: money(Number(ex.J)),
      customer_shipping_fee: money(Number(ex.K)),
      items_per_order: c(Number(ex.L)),
      commission_rate: c(Number(ex.M) * 10000, "percent"),
      payment_fee_rate: c(Number(ex.N) * 10000, "percent"),
      fee_applies_to_shipping: c(ex.O === "예", "bool"),
      payment_fx_fee: c(Number(ex.P) * 10000, "percent"),
      inspection_packaging: money(Number(ex.Q)),
      returns_reserve: c(Number(ex.R) * 10000, "percent"),
      ads: money(Number(ex.S)),
      fixed_costs: money(Number(ex.T)),
      monthly_units: c(Number(ex.U)),
      duty: money(Number(ex.AN)),
      vat: money(Number(ex.AP)),
      "leg:1": money(Number(ex.AC), "CNY"),
      "leg:2": money(Number(ex.AG), "CNY"),
      "leg:3": money(Number(ex.AK)),
    },
  };
}
it("CALC-EX1 matches cached workbook results exactly, including contribution rather than gross difference", () => {
  const r = calculate(fixture());
  expect(r.outputs?.landed_per_unit).toBe("14607.86");
  expect(r.outputs?.contribution_per_unit).toBe("9356.14");
  expect(r.outputs?.channel_cost_per_unit).toBe("2376.00");
  expect(r.outputs?.net_est_per_unit).toBe("6756.14");
  expect(r.outputs?.breakeven_price).toBe("11392.13");
  expect(r.overall_status).toBe("estimated");
});
it.each(requiredKeys)("unknown %s never becomes zero", (key) => {
  const f = fixture();
  f.claims[key] = { ...f.claims[key]!, status: "unknown", value_json: null };
  const r = calculate(f);
  expect(r.outputs).toBeNull();
  expect(r.unknown_keys).toContain(key);
});
it("shipping money is never the customer shipping income, and direct vs forwarder costs remain separate", () => {
  const f = fixture();
  const direct = structuredClone(f);
  direct.legs = [{ id: "1", code: "intl_shipping", basis: "per_parcel" }];
  direct.claims["leg:1"] = money(5900);
  expect(calculate(direct).outputs?.landed_per_unit).toBe("13889.11");
  expect(calculate(f).outputs?.landed_per_unit).toBe("14607.86");
});
it("range gives conservative bounds and unknown FX currency blocks output", () => {
  const f = fixture();
  f.claims["leg:2"] = c(
    { min: 40, likely: 45, max: 50, currency: "CNY" },
    "range",
  );
  const r = calculate(f);
  expect(Number(r.ranges?.contribution_per_unit.min)).toBeLessThan(9356.14);
  expect(Number(r.ranges?.contribution_per_unit.max)).toBeGreaterThan(9356.14);
  f.fx!.base_currency = "TWD";
  expect(calculate(f).unknown_keys).toContain("fx:CNY");
});
