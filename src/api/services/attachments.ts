import { z } from "zod";
import { ulid } from "ulid";
import type { Env } from "../env";
import { AppError } from "../errors";
export async function sha256(data: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function saveAttachment(env: Env, form: FormData, actor: string) {
  const file = form.get("file");
  if (!(file instanceof File))
    throw new AppError(400, "FILE_REQUIRED", "첨부 파일이 필요합니다.");
  if (file.size > 10 * 1024 * 1024)
    throw new AppError(413, "FILE_TOO_LARGE", "첨부는 10MB 이하로 올려주세요.");
  const meta = z
    .object({
      owner_type: z.string().min(1),
      owner_id: z.string().min(1),
      purpose: z.enum([
        "evidence",
        "screenshot",
        "invoice",
        "receipt",
        "label",
        "document",
        "other",
      ]),
    })
    .parse({
      owner_type: form.get("owner_type"),
      owner_id: form.get("owner_id"),
      purpose: form.get("purpose") ?? "evidence",
    });
  const id = ulid(),
    now = new Date().toISOString();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const record = {
    id,
    ...meta,
    r2_key: `attachments/${id}`,
    filename: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    sha256: await sha256(bytes),
    captured_at: null,
    note: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await env.ATTACHMENTS.put(record.r2_key, file.stream(), {
    httpMetadata: { contentType: record.mime },
  });
  try {
    const cols = Object.keys(record),
      values = Object.values(record);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO attachments (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      ).bind(...values),
      env.DB.prepare(
        "INSERT INTO activity_log (id,entity_type,entity_id,action,after_json,reason,actor,at) VALUES (?,?,?,?,?,?,?,?)",
      ).bind(
        ulid(),
        "attachment",
        id,
        "create",
        JSON.stringify(record),
        "증빙 첨부",
        actor,
        now,
      ),
    ]);
  } catch (e) {
    await env.ATTACHMENTS.delete(record.r2_key);
    throw e;
  }
  return record;
}
