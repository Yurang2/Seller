import Big from "big.js";
import type { Money } from "./types/claim";
export function majorUnits(m: Money): Big {
  const divisor = ["KRW", "TWD", "JPY"].includes(m.currency) ? 1 : 100;
  return new Big(m.amount_minor).div(divisor);
}
export function toKrw(m: Money, rate: string): Big {
  return majorUnits(m).times(m.currency === "KRW" ? "1" : rate);
}
