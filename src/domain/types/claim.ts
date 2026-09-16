import { z } from "zod";

export const moneySchema = z.object({
  amount_minor: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export const claimStatusSchema = z.enum(["confirmed", "estimated", "unknown"]);
export const claimSchema = z
  .object({
    id: z.string().ulid().optional(),
    owner_type: z.string().min(1).max(80),
    owner_id: z.string().min(1).max(100),
    field_key: z.string().min(1).max(100),
    kind: z.enum([
      "money",
      "percent",
      "number",
      "bool",
      "text",
      "enum",
      "range",
      "days",
    ]),
    status: claimStatusSchema,
    value_json: z.unknown(),
    source_type: z
      .enum([
        "url",
        "screenshot",
        "message",
        "call",
        "document",
        "competitor_observation",
        "self_estimate",
        "api",
      ])
      .nullable()
      .default(null),
    source_ref: z.string().nullable().default(null),
    attachment_ids: z.array(z.string().ulid()).default([]),
    checked_at: z.iso.datetime().nullable().default(null),
    recheck_by: z.iso.date(),
    note: z.string().default(""),
    basis_json: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((c, ctx) => {
    if (c.status === "unknown") {
      if (c.value_json !== null)
        ctx.addIssue({
          code: "custom",
          path: ["value_json"],
          message: "미확인 값은 null이어야 합니다. 0은 확인된 값입니다.",
        });
      return;
    }
    const add = (message: string) =>
      ctx.addIssue({ code: "custom", path: ["value_json"], message });
    if (c.value_json == null || c.value_json === "") {
      add("확인·추정 상태에는 값이 필요합니다.");
      return;
    }
    if (c.kind === "money" && !moneySchema.safeParse(c.value_json).success)
      add("금액은 통화와 최소 단위 정수로 입력하세요.");
    if (
      ["number", "percent", "days"].includes(c.kind) &&
      (typeof c.value_json !== "number" || !Number.isFinite(c.value_json))
    )
      add("유효한 숫자가 필요합니다.");
    if (
      c.kind === "percent" &&
      typeof c.value_json === "number" &&
      !Number.isInteger(c.value_json)
    )
      add("비율은 bp 정수로 입력하세요. 1%=100bp입니다.");
    if (c.kind === "bool" && typeof c.value_json !== "boolean")
      add("참/거짓 값이 필요합니다.");
    if (["text", "enum"].includes(c.kind) && typeof c.value_json !== "string")
      add("문자열이 필요합니다.");
    if (
      c.kind === "range" &&
      !z
        .object({
          min: z.number(),
          likely: z.number(),
          max: z.number(),
          currency: z.string().optional(),
        })
        .refine((v) => v.min <= v.likely && v.likely <= v.max)
        .safeParse(c.value_json).success
    )
      add("범위는 최소 ≤ 보통 ≤ 최대여야 합니다.");
    if (!c.source_type || !c.source_ref?.trim() || !c.checked_at)
      ctx.addIssue({
        code: "custom",
        path: ["source_ref"],
        message: "확인·추정 값에는 출처 유형·출처·확인 시각이 필요합니다.",
      });
  });
export type Claim = z.infer<typeof claimSchema>;
export type ClaimStatus = z.infer<typeof claimStatusSchema>;
export type Money = z.infer<typeof moneySchema>;
