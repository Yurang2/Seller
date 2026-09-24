import Big from "big.js";
import { isStale, weakest } from "./claim";
import { moneySchema, type Claim } from "./types/claim";

// Prices belong to the explicitly recorded bundle. Unknown shipping is never free.
export function marketTotal(
  price: Claim | undefined,
  shipping: Claim | undefined,
  quantity: number,
  today: string,
) {
  const stale = [price, shipping].some((c) => c && isStale(c, today));
  const status = weakest(
    price?.status ?? "unknown",
    shipping?.status ?? "unknown",
  );
  const p = moneySchema.safeParse(price?.value_json);
  const s = moneySchema.safeParse(shipping?.value_json);
  if (
    status === "unknown" ||
    price?.kind !== "money" ||
    shipping?.kind !== "money" ||
    !p.success ||
    !s.success ||
    p.data.currency !== "KRW" ||
    s.data.currency !== "KRW" ||
    p.data.amount_minor < 0 ||
    s.data.amount_minor < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  )
    return { status: "unknown" as const, stale, total: null, perUnit: null };
  const total = new Big(p.data.amount_minor).plus(s.data.amount_minor);
  return {
    status,
    stale,
    total: total.toFixed(0),
    perUnit: total.div(quantity).toFixed(2),
  };
}

export function safeWebLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
