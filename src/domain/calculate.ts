import Big from "big.js";
import type { Claim, ClaimStatus } from "./types/claim";
import { weakest, daysBetween } from "./claim";
export type CalcClaim = Pick<Claim, "kind" | "status" | "value_json"> &
  Partial<Claim>;
export type CalcInput = {
  claims: Record<string, CalcClaim | null>;
  legs: { id: string; code: string; basis: string }[];
  fx: {
    id: string;
    base_currency: string;
    rate: string;
    as_of_date: string;
    source: string;
    kind: string;
  } | null;
  today?: string;
};
export const FX_MAX_AGE_DAYS = 1;
export const requiredKeys = [
  "checkout_price",
  "parcel_items",
  "sale_price",
  "customer_shipping_fee",
  "items_per_order",
  "payment_fx_fee",
  "inspection_packaging",
  "returns_reserve",
  "commission_rate",
  "payment_fee_rate",
  "fee_applies_to_shipping",
  "duty",
  "vat",
  "ads",
  "fixed_costs",
  "monthly_units",
];
type Interval = { lo: Big; hi: Big };
const point = (n: Big.BigSource): Interval => ({
  lo: new Big(n),
  hi: new Big(n),
});
const add = (a: Interval, b: Interval) => ({
  lo: a.lo.plus(b.lo),
  hi: a.hi.plus(b.hi),
});
const sub = (a: Interval, b: Interval) => ({
  lo: a.lo.minus(b.hi),
  hi: a.hi.minus(b.lo),
});
const mul = (a: Interval, b: Interval) => {
  const p = [
    a.lo.times(b.lo),
    a.lo.times(b.hi),
    a.hi.times(b.lo),
    a.hi.times(b.hi),
  ].sort((a, b) => a.cmp(b));
  return { lo: p[0], hi: p[3] };
};
const div = (a: Interval, b: Interval) => {
  if (b.lo.lte(0) && b.hi.gte(0))
    throw new Error("분모 범위에 0이 포함되어 있습니다.");
  return mul(a, { lo: new Big(1).div(b.hi), hi: new Big(1).div(b.lo) });
};
export function calculate(input: CalcInput) {
  const keys = [
    ...requiredKeys,
    ...input.legs.map((l) => "leg:" + l.id),
    ...(input.legs.some((l) => l.basis === "per_kg")
      ? ["parcel_weight_g"]
      : []),
  ];
  const unknown_keys = keys.filter(
    (k) =>
      !input.claims[k] ||
      input.claims[k]!.status === "unknown" ||
      input.claims[k]!.value_json == null,
  );
  if (!input.legs.length) unknown_keys.push("shipping_legs");
  const currencies = new Set(
    keys
      .map((k) => {
        const c = input.claims[k];
        return c && ["money", "range"].includes(c.kind)
          ? (c.value_json as any)?.currency
          : null;
      })
      .filter(Boolean),
  );
  for (const currency of currencies)
    if (
      currency !== "KRW" &&
      (!input.fx || input.fx.base_currency !== currency)
    )
      unknown_keys.push("fx:" + currency);
  for (const key of keys) {
    const c = input.claims[key];
    if (!c || c.status === "unknown") continue;
    const v = c.value_json as any;
    if (key === "fee_applies_to_shipping") {
      if (c.kind !== "bool") unknown_keys.push(key + ":invalid_type");
      continue;
    }
    const expected = [
      "payment_fx_fee",
      "returns_reserve",
      "commission_rate",
      "payment_fee_rate",
    ].includes(key)
      ? ["percent", "range"]
      : [
            "parcel_items",
            "items_per_order",
            "monthly_units",
            "parcel_weight_g",
          ].includes(key)
        ? ["number", "range"]
        : ["duty", "vat"].includes(key)
          ? ["money", "percent", "range"]
          : ["money", "range"];
    if (!expected.includes(c.kind)) unknown_keys.push(key + ":invalid_type");
    if (!["money", "range", "number", "percent", "days"].includes(c.kind))
      unknown_keys.push(key + ":invalid_type");
    const min =
      c.kind === "money" ? v.amount_minor : c.kind === "range" ? v.min : v;
    if (
      typeof min !== "number" ||
      !Number.isFinite(min) ||
      min < 0 ||
      ([
        "parcel_items",
        "items_per_order",
        "monthly_units",
        "parcel_weight_g",
      ].includes(key) &&
        min <= 0)
    )
      unknown_keys.push(key + ":invalid_value");
  }
  if (unknown_keys.length)
    return {
      overall_status: "unknown" as ClaimStatus,
      unknown_keys,
      outputs: null,
      lines: [],
      ranges: null,
      fx_age_days: null as number | null,
      notes: [] as string[],
    };
  const fx = input.fx ? new Big(input.fx.rate) : new Big(1);
  if (fx.lte(0)) throw new Error("환율은 0보다 커야 합니다.");
  const value = (key: string, range: boolean): Interval => {
    const c = input.claims[key]!;
    const v = c.value_json as any;
    let r =
      c.kind === "range"
        ? range
          ? { lo: new Big(v.min), hi: new Big(v.max) }
          : point(v.likely)
        : c.kind === "money"
          ? point(v.amount_minor)
          : point(v);
    const currency = v?.currency;
    if (currency) {
      // money와 range 모두 최소 단위(CNY·USD는 1/100)로 저장된다. 단위 규칙은 형식과 무관하게 같다.
      if (
        ["money", "range"].includes(c.kind) &&
        ["CNY", "USD"].includes(currency)
      )
        r = div(r, point(100));
      if (currency !== "KRW") r = mul(r, point(fx));
    }
    if (
      c.kind === "percent" ||
      ([
        "payment_fx_fee",
        "returns_reserve",
        "commission_rate",
        "payment_fee_rate",
      ].includes(key) &&
        c.kind === "range")
    )
      r = div(r, point(10000));
    return r;
  };
  function run(range: boolean) {
    const v = (k: string) => value(k, range),
      one = point(1),
      q = v("parcel_items"),
      order = v("items_per_order");
    const goods = mul(v("checkout_price"), add(one, v("payment_fx_fee")));
    let shipping = point(0);
    const lines: { code: string; amount: Interval; status: ClaimStatus }[] = [
      {
        code: "goods_cost",
        amount: v("checkout_price"),
        status: input.claims.checkout_price!.status,
      },
      {
        code: "payment_fx_fee",
        amount: mul(v("checkout_price"), v("payment_fx_fee")),
        status: weakest(
          input.claims.checkout_price!.status,
          input.claims.payment_fx_fee!.status,
        ),
      },
    ];
    for (const leg of input.legs) {
      let amount = v("leg:" + leg.id);
      if (leg.basis === "per_kg")
        amount = div(mul(amount, div(v("parcel_weight_g"), point(1000))), q);
      else if (leg.basis === "per_parcel") amount = div(amount, q);
      else if (leg.basis === "per_order") amount = div(amount, order);
      shipping = add(shipping, amount);
      lines.push({
        code: leg.code,
        amount,
        status: input.claims["leg:" + leg.id]!.status,
      });
    }
    const tax = (key: string, base: Interval) =>
      input.claims[key]!.kind === "percent"
        ? mul(base, v(key))
        : div(v(key), q);
    const duty = tax("duty", add(goods, shipping)),
      vat = tax("vat", add(add(goods, shipping), duty));
    const transport = add(shipping, add(duty, vat)),
      landed = add(add(goods, transport), v("inspection_packaging"));
    const sale = v("sale_price"),
      customerShipping = div(v("customer_shipping_fee"), order),
      income = add(sale, customerShipping),
      feeRate = add(v("commission_rate"), v("payment_fee_rate"));
    const feeShipping =
      input.claims.fee_applies_to_shipping!.value_json === true
        ? customerShipping
        : point(0);
    const channel = mul(add(sale, feeShipping), feeRate),
      reserve = mul(sale, v("returns_reserve"));
    const contribution = sub(sub(sub(income, landed), channel), reserve),
      net = sub(
        contribution,
        div(add(v("ads"), v("fixed_costs")), v("monthly_units")),
      );
    const denom = sub(sub(one, feeRate), v("returns_reserve"));
    if (denom.lo.lte(0))
      throw new Error("판매·결제·반품 비율 합계는 100% 미만이어야 합니다.");
    lines.push(
      { code: "customs_duty", amount: duty, status: input.claims.duty!.status },
      { code: "customs_vat", amount: vat, status: input.claims.vat!.status },
      {
        code: "inspection_packaging",
        amount: v("inspection_packaging"),
        status: input.claims.inspection_packaging!.status,
      },
      {
        code: "sale_price",
        amount: sale,
        status: input.claims.sale_price!.status,
      },
      {
        code: "customer_shipping_fee",
        amount: customerShipping,
        status: input.claims.customer_shipping_fee!.status,
      },
      {
        code: "channel_commission",
        amount: mul(add(sale, feeShipping), v("commission_rate")),
        status: input.claims.commission_rate!.status,
      },
      {
        code: "payment_processing_fee",
        amount: mul(add(sale, feeShipping), v("payment_fee_rate")),
        status: weakest(
          input.claims.commission_rate!.status,
          input.claims.payment_fee_rate!.status,
        ),
      },
      {
        code: "returns_reserve",
        amount: reserve,
        status: input.claims.returns_reserve!.status,
      },
    );
    return {
      values: {
        purchase_per_unit: goods,
        transport_per_unit: transport,
        landed_per_unit: landed,
        income_per_unit: income,
        channel_cost_per_unit: channel,
        contribution_per_unit: contribution,
        margin_rate: div(contribution, income),
        net_est_per_unit: net,
        breakeven_price: div(
          sub(add(landed, mul(feeShipping, feeRate)), customerShipping),
          denom,
        ),
      },
      lines,
    };
  }
  const exact = run(false),
    hasRange = keys.some((k) => input.claims[k]?.kind === "range"),
    range = hasRange ? run(true) : null;
  const fxUsed = !!input.fx && [...currencies].some((c) => c !== "KRW");
  const fx_age_days =
    fxUsed && input.today
      ? daysBetween(input.fx!.as_of_date, input.today)
      : null;
  const fxStatus: ClaimStatus[] = fxUsed
    ? [
        input.fx!.kind === "manual" ||
        (fx_age_days !== null && fx_age_days > FX_MAX_AGE_DAYS)
          ? "estimated"
          : "confirmed",
      ]
    : [];
  return {
    overall_status: weakest(
      ...keys.map((k) => input.claims[k]!.status),
      ...fxStatus,
    ),
    unknown_keys: [],
    fx_age_days,
    notes:
      fx_age_days !== null && fx_age_days > FX_MAX_AGE_DAYS
        ? [
            `환율 기준일이 ${fx_age_days}일 지났습니다. 새 환율을 기록하면 확인 상태가 됩니다.`,
          ]
        : [],
    outputs: Object.fromEntries(
      Object.entries(exact.values).map(([k, v]) => [
        k,
        v.lo.toFixed(k === "margin_rate" ? 10 : 2),
      ]),
    ),
    lines: exact.lines.map((l) => ({
      code: l.code,
      per_unit_minor: l.amount.lo.toFixed(2),
      status: l.status,
    })),
    ranges: range
      ? Object.fromEntries(
          Object.entries(range.values).map(([k, v]) => [
            k,
            {
              min: v.lo.toFixed(k === "margin_rate" ? 10 : 2),
              max: v.hi.toFixed(k === "margin_rate" ? 10 : 2),
            },
          ]),
        )
      : null,
  };
}
