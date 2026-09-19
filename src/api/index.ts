import { Hono } from "hono";
import { ZodError, z } from "zod";
import type { AppEnv, Env } from "./env";
import { auth } from "./auth";
import { AppError } from "./errors";
import { readClaims, findClaim, deleteClaim } from "../db/repo/claims";
import { upsertClaim } from "./services/claims";
import { saveAttachment } from "./services/attachments";
import { exportArchive, restoreArchive } from "./exporters/archive";
import { workspaceRoutes } from "./routes/workspace";
import { researchRoutes } from "./routes/research";
import { runDailyDigest } from "./jobs/digest";
import { authRoutes } from "./passphrase";
const app = new Hono<AppEnv>();
// 로그인 관련 경로는 인증 없이 열리되, 다른 출처 차단(아래 Origin 검사)은 그대로 받는다.
app.use("/api/*", async (c, next) => {
  if (/^\/api\/v1\/auth\//.test(new URL(c.req.url).pathname)) return next();
  return auth(c, next);
});
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin)
      return c.json(
        {
          error: {
            code: "ORIGIN_REJECTED",
            message: "다른 사이트에서 보낸 요청은 허용하지 않습니다.",
            details: null,
          },
        },
        403,
      );
  }
  return next();
});
app.get("/api/v1/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true, stage: "M0-M1", automation: "none" });
});
app.get("/api/v1/claims", async (c) =>
  c.json({ data: await readClaims(c.env.DB) }),
);
app.get("/api/v1/claims/:id", async (c) => {
  const data = await findClaim(c.env.DB, c.req.param("id"));
  if (!data) throw new AppError(404, "NOT_FOUND", "기록이 없습니다.");
  return c.json({ data });
});
app.put("/api/v1/claims", async (c) =>
  c.json(await upsertClaim(c.env.DB, await c.req.json(), c.get("actor"))),
);
app.delete("/api/v1/claims/:id", async (c) => {
  const { reason } = z
    .object({ reason: z.string().trim().min(1) })
    .parse(await c.req.json());
  const before = await findClaim(c.env.DB, c.req.param("id"));
  if (
    before &&
    ["decided_price", "decided_customer_shipping_fee"].includes(
      before.field_key,
    )
  )
    throw new AppError(
      400,
      "DOMAIN_RULE",
      "결정 가격은 삭제할 수 없습니다. 새 가격 결정을 기록하세요.",
    );
  if (!(await deleteClaim(c.env.DB, c.req.param("id"), reason, c.get("actor"))))
    throw new AppError(404, "NOT_FOUND", "기록이 없습니다.");
  if (before?.owner_type === "requirement_items") {
    const { getRecord, patchManaged, refreshGate } =
      await import("./services/records");
    const item = await getRecord(
      c.env.DB,
      "requirement_items",
      before.owner_id,
    );
    if (item) {
      await patchManaged(
        c.env.DB,
        "requirement_items",
        item,
        { item_result: "unknown" },
        "답변 근거 삭제로 재판정 필요",
      );
      await refreshGate(c.env.DB, item.profile_id);
    }
  }
  return c.json({ deleted: true });
});
app.post("/api/v1/attachments", async (c) =>
  c.json(
    {
      data: await saveAttachment(c.env, await c.req.formData(), c.get("actor")),
    },
    201,
  ),
);
app.get("/api/v1/attachments/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT * FROM attachments WHERE id=? AND deleted_at IS NULL",
  )
    .bind(c.req.param("id"))
    .first<{ r2_key: string; mime: string; filename: string }>();
  if (!row) throw new AppError(404, "NOT_FOUND", "첨부가 없습니다.");
  const obj = await c.env.ATTACHMENTS.get(row.r2_key);
  if (!obj) throw new AppError(404, "NOT_FOUND", "첨부 원본이 없습니다.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
});
app.get("/api/v1/export", async (c) => {
  const full = c.req.query("pii") === "full";
  if (full && c.req.header("X-Confirm-Full-Export") !== "yes")
    throw new AppError(
      400,
      "CONFIRM_REQUIRED",
      "전체 내보내기는 명시적 확인이 필요합니다.",
    );
  const bytes = await exportArchive(c.env, full);
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="seller-backup.zip"',
      "Cache-Control": "no-store",
    },
  });
});
app.post("/api/v1/import", async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  return c.json(
    await restoreArchive(
      c.env,
      bytes,
      c.req.query("apply") === "1",
      c.req.header("X-Archive-Hash"),
    ),
  );
});
app.route("/api/v1", authRoutes);
app.route("/api/v1", workspaceRoutes);
app.route("/api/v1", researchRoutes);
app.post("/api/v1/jobs/daily-digest/run", async (c) =>
  c.json({ data: await runDailyDigest(c.env) }),
);
app.notFound((c) =>
  c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "요청한 기능이 없습니다.",
        details: null,
      },
    },
    404,
  ),
);
app.onError((err, c) => {
  if (err instanceof SyntaxError)
    return c.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "JSON 형식을 확인해주세요.",
          details: null,
        },
      },
      400,
    );
  if (err instanceof ZodError)
    return c.json(
      {
        error: {
          code: "VALIDATION",
          message: "입력 내용을 확인해주세요.",
          details: err.issues,
        },
      },
      400,
    );
  if (err instanceof AppError)
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.status,
    );
  console.error("Request failed", err);
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message:
          "저장 또는 읽기에 실패했습니다. 기존 기록을 확인한 뒤 다시 시도해주세요.",
        details: null,
      },
    },
    500,
  );
});
export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Env) => {
    // 매일 08:00 KST: 재확인 요약(집계·기록·선택적 이메일). 데이터는 바꾸지 않는다.
    await runDailyDigest(env);
  },
};
