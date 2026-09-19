import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "../../platform/orm";
import {
  claims,
  claim_attachments,
  attachments,
  activity_log,
} from "../schema";
import type { Claim } from "../../domain/types/claim";
import { needsAttachment, evidenceMimeOk } from "../../domain/claim";
import { ulid } from "ulid";
import type { BatchItem } from "drizzle-orm/batch";

export async function readClaims(db: D1Database) {
  // 두 조회를 D1 batch 하나로(원격 왕복 1회). 스키마의 속성명과 열 이름이 같아 원시 행을 그대로 쓴다.
  // (데스크톱 ORM의 batch는 쓰기 전용이라 drizzle batch 대신 D1 batch를 쓴다.)
  const [claimRows, joinRows] = await db.batch([
    db.prepare("SELECT * FROM claims WHERE deleted_at IS NULL"),
    db.prepare("SELECT * FROM claim_attachments"),
  ]);
  const rows = claimRows.results as Array<typeof claims.$inferSelect>;
  const joins = joinRows.results as Array<
    typeof claim_attachments.$inferSelect
  >;
  return rows.map((r) => ({
    ...r,
    value_json: r.value_json === null ? null : JSON.parse(r.value_json),
    basis_json: JSON.parse(r.basis_json ?? "{}"),
    attachment_ids: joins
      .filter((j) => j.claim_id === r.id)
      .map((j) => j.attachment_id),
  }));
}
export async function findClaim(db: D1Database, id: string) {
  return (await readClaims(db)).find((c) => c.id === id);
}
// 첨부는 "존재"만으로는 근거가 아니다. 같은 기록에 올린 파일이어야 하고, 가격·견적은 캡처(이미지)나 PDF여야 한다.
export async function attachmentProblem(
  db: D1Database,
  claim: Pick<
    Claim,
    "owner_type" | "owner_id" | "field_key" | "kind" | "attachment_ids"
  >,
) {
  if (!claim.attachment_ids.length) return null;
  const orm = drizzle(db);
  const rows = await orm
    .select()
    .from(attachments)
    .where(isNull(attachments.deleted_at));
  for (const id of claim.attachment_ids) {
    const a = rows.find((r) => r.id === id);
    if (!a) return "실제로 저장된 증빙 파일만 연결할 수 있습니다.";
    if (a.owner_type !== claim.owner_type || a.owner_id !== claim.owner_id)
      return "이 기록에 올린 증빙만 연결할 수 있습니다. 다른 기록의 파일은 이 값의 근거가 되지 않습니다.";
    if (needsAttachment(claim) && !evidenceMimeOk(a.mime))
      return "가격·견적·세율 증빙은 화면 캡처(이미지) 또는 PDF여야 합니다.";
  }
  return null;
}
export async function persistClaim(
  db: D1Database,
  c: Claim,
  actor: string,
  reason: string,
) {
  const orm = drizzle(db);
  const now = new Date().toISOString();
  const existing = await orm
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.owner_type, c.owner_type),
        eq(claims.owner_id, c.owner_id),
        eq(claims.field_key, c.field_key),
      ),
    )
    .get();
  const beforeAttachments = existing
    ? await orm
        .select()
        .from(claim_attachments)
        .where(eq(claim_attachments.claim_id, existing.id))
    : [];
  const id = existing?.id ?? c.id ?? ulid();
  const row = {
    id,
    owner_type: c.owner_type,
    owner_id: c.owner_id,
    field_key: c.field_key,
    kind: c.kind,
    status: c.status,
    value_json: c.value_json === null ? null : JSON.stringify(c.value_json),
    source_type: c.source_type,
    source_ref: c.source_ref,
    checked_at: c.checked_at,
    recheck_by: c.recheck_by,
    note: c.note,
    basis_json: JSON.stringify(c.basis_json),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
  };
  const writes: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    orm
      .insert(claims)
      .values(row)
      .onConflictDoUpdate({
        target: [claims.owner_type, claims.owner_id, claims.field_key],
        set: row,
      }),
    orm.delete(claim_attachments).where(eq(claim_attachments.claim_id, id)),
    orm.insert(activity_log).values({
      id: ulid(),
      entity_type: "claim",
      entity_id: id,
      action: existing ? "update" : "create",
      before_json: existing
        ? JSON.stringify({
            ...existing,
            attachment_ids: beforeAttachments.map((a) => a.attachment_id),
          })
        : null,
      after_json: JSON.stringify({
        ...row,
        attachment_ids: c.attachment_ids,
      }),
      reason,
      actor,
      at: now,
    }),
  ];
  if (c.attachment_ids.length)
    writes.push(
      orm.insert(claim_attachments).values(
        c.attachment_ids.map((attachment_id) => ({
          claim_id: id,
          attachment_id,
        })),
      ),
    );
  await orm.batch(writes);
  return {
    ...row,
    value_json: c.value_json,
    basis_json: c.basis_json,
    attachment_ids: c.attachment_ids,
  };
}
export async function deleteClaim(
  db: D1Database,
  id: string,
  reason: string,
  actor: string,
) {
  const orm = drizzle(db);
  const before = await findClaim(db, id);
  if (!before) return false;
  const at = new Date().toISOString();
  await orm.batch([
    orm
      .update(claims)
      .set({ deleted_at: at, updated_at: at })
      .where(eq(claims.id, id)),
    orm.insert(activity_log).values({
      id: ulid(),
      entity_type: "claim",
      entity_id: id,
      action: "delete",
      before_json: JSON.stringify(before),
      after_json: JSON.stringify({ ...before, deleted_at: at }),
      reason,
      actor,
      at,
    }),
  ]);
  return true;
}
