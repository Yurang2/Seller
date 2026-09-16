import { claimSchema, type Claim, type ClaimStatus } from "./types/claim";
export function weakest(...states: ClaimStatus[]): ClaimStatus {
  return states.includes("unknown")
    ? "unknown"
    : states.includes("estimated")
      ? "estimated"
      : "confirmed";
}
export function isStale(claim: Pick<Claim, "recheck_by">, today: string) {
  return claim.recheck_by < today;
}
export function needsAttachment(c: Pick<Claim, "field_key" | "owner_type">) {
  return (
    /price|shipping|freight|delivery|quote/.test(c.field_key) ||
    (["shipping_leg", "rate_card"].includes(c.owner_type) &&
      /cost|fee/.test(c.field_key))
  );
}
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
  const days = /fx|exchange/.test(fieldKey)
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
