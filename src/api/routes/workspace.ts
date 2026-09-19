import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import {
  workspace,
  initialize,
  setSetting,
  reconcileTasks,
} from "../services/workspace";
import {
  saveRecord,
  getRecord,
  listRecords,
  listDeleted,
  deleteRecord,
  restoreRecord,
  recordHistory,
  fail,
} from "../services/records";
import {
  seedResearch,
  researchImport,
  parseWorkbook,
} from "../importers/research";
export const workspaceRoutes = new Hono<AppEnv>();
workspaceRoutes.get("/workspace", async (c) =>
  c.json(await workspace(c.env.DB)),
);
workspaceRoutes.post("/initialize", async (c) => {
  await initialize(c.env.DB);
  return c.json({ ok: true });
});
const rangeSchema = z.object({
  from: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(25).default(10),
  batch_id: z.string().optional(),
});
// 조각 단위 적용: Workers의 요청당 D1 호출 상한(1,000) 때문에 클라이언트가 next를 따라 반복 호출한다.
workspaceRoutes.post("/seed", async (c) =>
  c.json(
    await seedResearch(
      c.env.DB,
      rangeSchema.parse((await c.req.json().catch(() => ({}))) ?? {}),
    ),
  ),
);
workspaceRoutes.get("/records/:type", async (c) =>
  c.json({
    data:
      c.req.query("deleted") === "1"
        ? await listDeleted(c.env.DB, c.req.param("type"))
        : await listRecords(c.env.DB, c.req.param("type")),
  }),
);
workspaceRoutes.get("/records/:type/:id/history", async (c) =>
  c.json({
    data: await recordHistory(c.env.DB, c.req.param("type"), c.req.param("id")),
  }),
);
workspaceRoutes.post("/records/:type/:id/restore", async (c) => {
  const { reason } = await c.req.json();
  const data = await restoreRecord(
    c.env.DB,
    c.req.param("type"),
    c.req.param("id"),
    reason,
    c.get("actor"),
  );
  await reconcileTasks(c.env.DB);
  return c.json({ data });
});
workspaceRoutes.put("/records/:type", async (c) => {
  const { reason, ...data } = await c.req.json();
  const result = await saveRecord(
    c.env.DB,
    c.req.param("type"),
    data,
    reason,
    c.get("actor"),
  );
  await reconcileTasks(c.env.DB);
  return c.json({ data: result });
});
workspaceRoutes.delete("/records/:type/:id", async (c) => {
  const { reason } = await c.req.json();
  await deleteRecord(
    c.env.DB,
    c.req.param("type"),
    c.req.param("id"),
    reason,
    c.get("actor"),
  );
  await reconcileTasks(c.env.DB);
  return c.json({ deleted: true });
});
workspaceRoutes.post("/research-import", async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const range = rangeSchema.parse({
    from: Number(c.req.query("from") ?? 0),
    limit: Number(c.req.query("limit") ?? 10),
    batch_id: c.req.header("X-Import-Batch") || undefined,
  });
  return c.json(
    await researchImport(
      c.env.DB,
      parseWorkbook(bytes),
      decodeURIComponent(c.req.header("X-Filename") ?? "research.xlsx"),
      c.req.query("apply") === "1",
      c.req.header("X-Preview-Hash"),
      false,
      range,
    ),
  );
});
workspaceRoutes.put("/settings", async (c) => {
  const { key, value, reason } = z
    .object({
      key: z.string(),
      value: z.unknown(),
      reason: z.string().trim().min(1),
    })
    .parse(await c.req.json());
  if (key === "business_model") {
    z.enum([
      "undecided",
      "purchase_agency",
      "import_resale",
      "hybrid",
      "domestic_wholesale",
    ]).parse(value);
    const d = (await listRecords(c.env.DB, "decisions")).find(
      (d) => d.code === "D-01",
    );
    await saveRecord(
      c.env.DB,
      "decisions",
      {
        id: d?.id,
        code: "D-01",
        title: "사업 모델",
        decision: value === "undecided" ? "미결정 유지" : String(value),
        rationale: reason,
        status: value === "undecided" ? "proposed" : "accepted",
        alternatives_json: d?.alternatives_json ?? [],
        revisit_when: "상품군·수입 방식 변경 시",
      },
      reason,
    );
  } else if (key === "mode_override")
    z.enum(["auto", "research", "operations"]).parse(value);
  else if (key === "default_fx_source") z.string().parse(value);
  else if (key === "pii_retention_days")
    z.number().int().positive().parse(value);
  else
    fail("지원하지 않는 설정입니다. 금액·비율은 상품의 Claim에서 기록하세요.");
  await setSetting(c.env.DB, key, value, reason);
  await reconcileTasks(c.env.DB);
  return c.json({ ok: true });
});
