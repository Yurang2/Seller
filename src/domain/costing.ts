import { weakest } from "./claim";
import type { Claim } from "./types/claim";
// Shared prerequisite for the M1 pure calculation engine. Missing inputs never become zero.
export function inspectCostingInputs(
  inputs: Record<string, Claim | null | undefined>,
) {
  const unknownKeys = Object.entries(inputs)
    .filter(([, c]) => !c || c.status === "unknown" || c.value_json == null)
    .map(([key]) => key);
  return {
    overallStatus: unknownKeys.length
      ? ("unknown" as const)
      : weakest(...Object.values(inputs).map((c) => c!.status)),
    unknownKeys,
    outputs: null,
  };
}
