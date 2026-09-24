import { expect, it } from "vitest";
import { marketTotal, safeWebLink } from "../../src/domain/market-comparison";
import type { Claim } from "../../src/domain/types/claim";
const fact = (
  amount: number,
  status: Claim["status"] = "confirmed",
): Claim => ({
  owner_type: "market_offers",
  owner_id: "test",
  field_key: "market_price",
  kind: "money",
  status,
  value_json:
    status === "unknown" ? null : { amount_minor: amount, currency: "KRW" },
  source_type: "competitor_observation",
  source_ref: "https://example.com",
  checked_at: "2026-09-24T00:00:00Z",
  recheck_by: "2026-10-24",
  note: "",
  basis_json: {},
  attachment_ids: [],
});
it("does not turn missing shipping into free shipping; recorded zero is usable", () => {
  expect(marketTotal(fact(10000), undefined, 2, "2026-09-24").total).toBeNull();
  expect(
    marketTotal(fact(10000), fact(0, "unknown"), 2, "2026-09-24").total,
  ).toBeNull();
  expect(marketTotal(fact(10000), fact(0), 2, "2026-09-24")).toMatchObject({
    total: "10000",
    perUnit: "5000.00",
    status: "confirmed",
  });
});
it("propagates estimates and stale evidence without pretending a market observation is profit", () => {
  expect(
    marketTotal(fact(10000), fact(3000, "estimated"), 3, "2026-10-25"),
  ).toEqual({
    total: "13000",
    perUnit: "4333.33",
    status: "estimated",
    stale: true,
  });
});
it("refuses ambiguous quantity, negative money, foreign currency and range prices", () => {
  for (const qty of [0, -1, 1.5])
    expect(
      marketTotal(fact(10000), fact(0), qty, "2026-09-24").total,
    ).toBeNull();
  for (const p of [
    fact(-1),
    { ...fact(1), value_json: { amount_minor: 100, currency: "CNY" } },
    { ...fact(1), kind: "range" as const },
  ])
    expect(marketTotal(p, fact(0), 1, "2026-09-24").total).toBeNull();
});
it("only opens web links, including legacy imported observations", () => {
  expect(safeWebLink("https://example.com/item")).toBe(
    "https://example.com/item",
  );
  for (const value of [
    "javascript:alert(1)",
    "file:///C:/test",
    "invalid",
    null,
  ])
    expect(safeWebLink(value)).toBeNull();
});
