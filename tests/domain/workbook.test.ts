import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
import { parseWorkbook } from "../../src/api/importers/research";
it("reads the actual supplied XLSX including Korean headers and cached EX1 formulas", () => {
  const w = parseWorkbook(
    new Uint8Array(readFileSync("templates/research_template.xlsx")),
  );
  expect(w["상품"][0].A).toBe("상품ID");
  expect(w["상품"][1].B).toContain("브로콜리");
  expect(w["원가계산"].find((r) => r.A === "CALC-EX1")?.AW).toBe("14607.86");
  expect(w["원가계산"].find((r) => r.A === "CALC-EX1")?.AZ).toBe("9356.14");
});
