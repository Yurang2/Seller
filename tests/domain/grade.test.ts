import { it, expect } from "vitest";
import { gradeProduct, type GradeInput } from "../../src/domain/grade";
const base = (): GradeInput => ({
  product: { id: "p", name: "x", status: "costing", profile_id: "r" },
  profile: { gate_result: "pass" },
  items: [],
  openTasks: [],
  costing: {
    overall_status: "confirmed",
    unknown_keys: [],
    outputs: { margin_rate: "0.3465" },
  },
});
it("gate dominates: unknown → 판정 불가, fail → D regardless of margin", () => {
  const u = base();
  u.profile = { gate_result: "unknown" };
  u.items = [{ key: "kc", risk_level: "high", item_result: "unknown" }];
  const r = gradeProduct(u);
  expect(r.grade).toBe("판정 불가");
  expect(r.next[0]).toContain("kc");
  const f = base();
  f.profile = { gate_result: "fail", gate_reason: "children_product: fail" };
  expect(gradeProduct(f).grade).toBe("D");
});
it("profitability tiers and estimated flag; unknown costing never becomes a number", () => {
  expect(gradeProduct(base()).grade).toBe("A");
  const b = base();
  b.costing!.outputs = { margin_rate: "0.2" };
  b.costing!.overall_status = "estimated";
  const rb = gradeProduct(b);
  expect(rb.grade).toBe("B");
  expect(rb.estimated).toBe(true);
  const c = base();
  c.costing = {
    overall_status: "unknown",
    unknown_keys: ["fx:CNY"],
    outputs: null,
  };
  const rc = gradeProduct(c);
  expect(rc.grade).toBe("C");
  expect(rc.margin_rate).toBeNull();
  const d = base();
  d.costing!.outputs = { margin_rate: "-0.05" };
  expect(gradeProduct(d).grade).toBe("D");
});
it("blockers and many conditionals push the grade down one step each", () => {
  const g = base();
  g.openTasks = [{ status: "blocked", priority: 1, title: "환율" }];
  expect(gradeProduct(g).grade).toBe("B");
  g.profile = { gate_result: "conditional" };
  g.items = ["a", "b", "c"].map((key) => ({
    key,
    risk_level: "medium",
    item_result: "conditional",
  }));
  expect(gradeProduct(g).grade).toBe("C");
});
