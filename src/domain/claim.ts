import { claimSchema, type Claim, type ClaimStatus } from "./types/claim";
export function weakest(...states: ClaimStatus[]): ClaimStatus {
  return states.includes("unknown")
    ? "unknown"
    : states.includes("estimated")
      ? "estimated"
      : "confirmed";
}
// 미확인 자리표시 값은 "아직 조사 전"이지 "오래된 근거"가 아니다. 신선도 경고는 값이 있는 근거에만 붙는다.
export function isStale(
  claim: { recheck_by: string; status?: string },
  today: string,
) {
  return claim.status !== "unknown" && claim.recheck_by < today;
}
// 외부에서 확인해야 하는 사실(가격·견적·세율·수수료)만 첨부를 요구한다.
// 내 정책값(가정 판매가·청구 배송비·광고비·고정비)은 내가 정하는 값이라 첨부 대상이 아니다.
const EXTERNAL_EVIDENCE: Record<string, RegExp> = {
  offers: /price|shipping/,
  offer: /price|shipping/,
  shipping_legs: /cost/,
  shipping_leg: /cost/,
  rate_cards: /fee|insurance|price|cost/,
  rate_card: /fee|insurance|price|cost/,
  shipping_scenarios: /^(duty|vat)$/,
  shipping_scenario: /^(duty|vat)$/,
  channels: /_rate$/,
  channel: /_rate$/,
  products: /^$/,
  product: /^$/,
};
export function needsAttachment(
  c: Pick<Claim, "field_key" | "owner_type"> & { kind?: Claim["kind"] },
) {
  if (c.kind && !["money", "range", "number", "percent"].includes(c.kind))
    return false;
  const rule = EXTERNAL_EVIDENCE[c.owner_type];
  if (rule) return rule.test(c.field_key);
  return /price|shipping|freight|delivery|quote/.test(c.field_key);
}
export const evidenceMimeOk = (mime: string) =>
  /^image\//.test(mime) || mime === "application/pdf";
export function normalizeClaim(input: unknown) {
  const claim = claimSchema.parse(input);
  const downgraded =
    claim.status === "confirmed" &&
    needsAttachment(claim) &&
    !claim.attachment_ids.length;
  return {
    claim: {
      ...claim,
      status: downgraded ? ("estimated" as const) : claim.status,
    },
    downgraded,
  };
}
export function defaultRecheck(
  fieldKey: string,
  checkedAt: string,
  ownerType = "",
) {
  const days =
    /^(fx|fx_rate|exchange_rate)$/.test(fieldKey) || ownerType === "fx_rates"
      ? 1
      : /requirement|compliance/.test(ownerType)
        ? 180
        : /price|shipping|cost/.test(fieldKey)
          ? 30
          : 90;
  const d = new Date(checkedAt);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromDate: string, toDate: string) {
  return Math.round(
    (Date.parse(toDate + "T00:00:00Z") - Date.parse(fromDate + "T00:00:00Z")) /
      86400000,
  );
}
