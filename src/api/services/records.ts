import { z } from "zod";
import { ulid } from "ulid";
import { catalog, requirementKeys, stages } from "../../domain/records/catalog";
import { AppError } from "../errors";
import { readClaims } from "../../db/repo/claims";
import { defaultRecheck } from "../../domain/claim";
export type Row = Record<string, any>;
export const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
export function fail(message: string): never {
  throw new AppError(400, "DOMAIN_RULE", message);
}
export function definition(type: string) {
  const d = catalog[type];
  if (!d) throw new AppError(404, "NOT_FOUND", "기록 종류가 없습니다.");
  return d;
}
export const primary = (type: string) => "id";
export function decode(row: Row | null): Row | null {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      typeof v === "string" &&
      (k.endsWith("_json") ||
        [
          "competitor_refs",
          "images",
          "contact_channels",
          "payment_methods",
          "attachment_ids",
          "weight_bands",
          "warnings",
          "includes",
          "policies",
          "depends_on",
          "evidence",
          "blocks",
          "inputs_frozen",
          "lines",
          "outputs",
          "unknown_keys",
        ].includes(k))
        ? JSON.parse(v)
        : v,
    ]),
  );
}
export async function listRecords(db: D1Database, type: string) {
  definition(type);
  return (
    await db
      .prepare(
        `SELECT * FROM ${type}${type === "fx_rates" ? "" : " WHERE deleted_at IS NULL"} ORDER BY ${type === "tasks" ? "priority, " : ""}created_at DESC`,
      )
      .all<Row>()
  ).results.map((r) => decode(r)!);
}
export async function getRecord(db: D1Database, type: string, id: string) {
  definition(type);
  return decode(
    await db
      .prepare(
        `SELECT * FROM ${type} WHERE id=?${type === "fx_rates" ? "" : " AND deleted_at IS NULL"}`,
      )
      .bind(id)
      .first<Row>(),
  );
}
export function audit(
  db: D1Database,
  type: string,
  id: string,
  before: unknown,
  after: unknown,
  reason: string,
  actor = "user",
  action?: string,
) {
  return db
    .prepare(
      "INSERT INTO activity_log(id,entity_type,entity_id,action,before_json,after_json,reason,actor,at) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      ulid(),
      type,
      id,
      action ?? (before ? "update" : "create"),
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      reason,
      actor,
      new Date().toISOString(),
    );
}
export function validateRecord(
  type: string,
  input: Row,
  existing: Row | null = null,
  internal = false,
) {
  const d = definition(type);
  const out: Row = {};
  for (const key of Object.keys(input))
    if (!["id", "reason"].includes(key) && !(key in d.fields))
      fail(`알 수 없는 필드: ${key}`);
  for (const [k, f] of Object.entries(d.fields)) {
    if (f.managed && !internal && k in input && input[k] !== existing?.[k])
      fail(`${f.label}은 전용 작업으로 변경하세요.`);
    let v = k in input ? input[k] : (existing?.[k] ?? f.default ?? null);
    if (v === "") v = null;
    if (f.required && (v === null || (typeof v === "string" && !v.trim())))
      fail(`${f.label}을 입력하세요.`);
    if (v !== null) {
      if (f.options && !f.options.includes(v))
        fail(`${f.label} 값이 올바르지 않습니다.`);
      if (f.type === "number" && (!Number.isSafeInteger(v) || v < 0))
        fail(`${f.label}은 0 이상의 정수여야 합니다.`);
      if (f.type === "date" && !z.iso.date().safeParse(v).success)
        fail(`${f.label} 날짜를 확인하세요.`);
      if (f.type === "ref" && !z.string().ulid().safeParse(v).success)
        fail(`${f.label} 기록 ID를 확인하세요.`);
      if (
        !["json", "number"].includes(f.type ?? "text") &&
        typeof v !== "string"
      )
        fail(`${f.label} 형식이 올바르지 않습니다.`);
      if (f.type === "json" && (typeof v !== "object" || v === null))
        fail(`${f.label}은 JSON 배열 또는 객체여야 합니다.`);
    }
    out[k] = v;
  }
  if (type === "decisions") {
    if (
      !Array.isArray(out.alternatives_json) ||
      out.alternatives_json.some(
        (v: Row) => !v.option || typeof v.why_not !== "string",
      )
    )
      fail("대안은 option·why_not을 가진 배열로 입력하세요.");
    if (out.status === "accepted" && !out.decided_at)
      out.decided_at = new Date().toISOString();
  }
  if (type === "notes") {
    out.body_md ??= "";
    out.pinned ??= 0;
  }
  if (type === "tasks") {
    if (out.priority < 1 || out.priority > 4) fail("우선순위는 1~4입니다.");
    if (
      out.status === "blocked" &&
      (!out.blocked_reason?.trim() ||
        !out.unblock_condition?.trim() ||
        !z.iso.date().safeParse(out.recheck_at).success)
    )
      fail("막힘에는 사유·해제 조건·재확인일이 필요합니다.");
    if (existing?.source === "derived" && !internal)
      fail("규칙이 만든 할 일은 연결된 원본 기록에서 조건을 해결하세요.");
    out.completed_at =
      out.status === "done"
        ? (existing?.completed_at ?? new Date().toISOString())
        : null;
  }
  if (type === "fx_rates") {
    out.quote_currency = "KRW";
    if (!/^\d+(\.\d+)?$/.test(out.rate) || Number(out.rate) <= 0)
      fail("환율은 0보다 큰 소수입니다.");
    if (existing)
      fail("환율은 고정 기록입니다. 새 기준일의 환율을 추가하세요.");
  }
  if (type === "shipping_legs" && out.seq < 1)
    fail("구간 순서는 1 이상입니다.");
  if (
    type === "requirement_items" &&
    out.item_result !== "unknown" &&
    !out.condition_text?.trim()
  )
    fail("판정 이유 또는 조건을 기록하세요.");
  if (type === "costings" && !internal)
    fail("원가 스냅샷은 계산기에서 저장하세요.");
  if (
    type === "offers" &&
    out.status === "rejected" &&
    !out.rejection_reason?.trim()
  )
    fail("탈락 이유가 필요합니다.");
  return out;
}
export async function saveRecord(
  db: D1Database,
  type: string,
  input: Row,
  reason: string,
  actor = "user",
  internal = false,
) {
  if (!reason?.trim()) fail("변경 이유를 기록하세요.");
  const id = input.id ? z.string().ulid().parse(input.id) : ulid();
  const before = await getRecord(db, type, id);
  if (type === "costings" && before)
    fail("저장한 원가 스냅샷은 수정할 수 없습니다. 새 스냅샷을 만드세요.");
  const values = validateRecord(type, input, before, internal);
  const def = definition(type);
  if (type === "readiness_items" && before && !internal) {
    if (
      values.key !== before.key ||
      JSON.stringify(values.blocks) !== JSON.stringify(before.blocks) ||
      JSON.stringify(values.depends_on) !== JSON.stringify(before.depends_on)
    )
      fail("기본 준비 항목의 필수 단계·선행 조건은 변경할 수 없습니다.");
  }
  if (type === "offers" && before && values.product_id !== before.product_id)
    fail(
      "오퍼의 상품을 바꾸려면 새 오퍼를 만드세요. 기존 스냅샷 연결을 유지합니다.",
    );
  if (
    type === "requirement_items" &&
    before &&
    (values.profile_id !== before.profile_id || values.key !== before.key)
  )
    fail("기존 요건 항목의 프로필·키는 변경할 수 없습니다.");
  for (const prefix of type === "links"
    ? ["from", "to"]
    : type === "tasks"
      ? ["entity"]
      : []) {
    const targetType = values[prefix + "_type"],
      targetId = values[prefix + "_id"];
    if (!targetType && !targetId) continue;
    if (!targetType || !targetId)
      fail("연결할 기록 종류와 기록을 함께 선택하세요.");
    if (catalog[targetType] && !(await getRecord(db, targetType, targetId)))
      fail("연결할 원본 기록이 없습니다.");
    if (
      !catalog[targetType] &&
      !["claims", "claim", "settings", "attachments"].includes(targetType)
    )
      fail("지원하지 않는 연결 종류입니다.");
  }
  for (const [key, f] of Object.entries(def.fields))
    if (f.ref && values[key]) {
      const parent = await getRecord(db, f.ref, values[key]);
      if (!parent) fail(`${f.label} 연결 대상이 없습니다.`);
    }
  if (type === "products") {
    const profile = values.profile_id
      ? await getRecord(db, "compliance_profiles", values.profile_id)
      : null;
    if (
      profile &&
      (profile.character_id !== values.character_id ||
        profile.category !== values.category)
    )
      fail("캐릭터·카테고리가 요건 프로필과 다릅니다.");
    if (
      before &&
      values.profile_id !== before.profile_id &&
      ["pricing", "listing_ready", "live"].includes(before.status)
    )
      fail("요건 프로필 변경 전 조사 단계로 돌아가세요.");
    if (values.chosen_scenario_id) {
      const sc = await getRecord(
        db,
        "shipping_scenarios",
        values.chosen_scenario_id,
      );
      if (sc?.product_id !== id) fail("다른 상품의 배송 경로입니다.");
    }
  }
  if (type === "offers" && values.status === "chosen") {
    const d = values.decision_id
      ? await getRecord(db, "decisions", values.decision_id)
      : null;
    if (!d || d.status !== "accepted")
      fail("오퍼 선정에는 채택된 결정과 이유가 필요합니다.");
    const other = await db
      .prepare(
        "SELECT id FROM offers WHERE product_id=? AND status='chosen' AND deleted_at IS NULL AND id<>?",
      )
      .bind(values.product_id, id)
      .first();
    if (other) fail("기존 선택 오퍼를 먼저 후보로 변경하세요.");
  }
  if (type === "shipping_scenarios" && values.offer_id) {
    const o = await getRecord(db, "offers", values.offer_id);
    if (o?.product_id !== values.product_id) fail("다른 상품의 오퍼입니다.");
  }
  if (type === "requirement_items" && values.item_result !== "unknown") {
    const answer = (await readClaims(db)).find(
      (c) =>
        c.owner_type === type && c.owner_id === id && c.field_key === "answer",
    );
    if (!answer || answer.status === "unknown")
      fail("먼저 답변 Claim에 근거와 확인 상태를 저장하세요.");
    if (answer.source_type === "competitor_observation")
      fail("경쟁사 관찰만으로 요건 판정을 할 수 없습니다.");
  }
  if (type === "readiness_items" && values.status === "done") {
    if (values.key === "backup_verified" && !internal)
      fail("백업 확인은 별도 빈 DB 복원 검증 결과로만 완료됩니다.");
    for (const key of values.depends_on ?? []) {
      const dep = await db
        .prepare(
          "SELECT status FROM readiness_items WHERE key=? AND deleted_at IS NULL",
        )
        .bind(key)
        .first<Row>();
      if (!dep || !["done", "not_applicable"].includes(dep.status))
        fail(`선행 사업 준비가 미완료입니다: ${key}`);
    }
    if (!values.notes?.trim() && !values.evidence?.length)
      fail("완료 근거 또는 증빙을 남겨주세요.");
  }
  for (const key of ["attachment_ids", "evidence"])
    if (Array.isArray(values[key]))
      for (const aid of values[key]) {
        if (
          typeof aid !== "string" ||
          !(await db
            .prepare(
              "SELECT id FROM attachments WHERE id=? AND deleted_at IS NULL",
            )
            .bind(aid)
            .first())
        )
          fail("실제로 업로드한 증빙만 연결할 수 있습니다.");
      }
  const now = new Date().toISOString();
  const row: Row = { id, ...values, created_at: before?.created_at ?? now };
  if (type !== "fx_rates" && type !== "links") row.updated_at = now;
  if (type !== "fx_rates") row.deleted_at = null;
  const keys = Object.keys(row),
    encoded = keys.map((k) =>
      typeof row[k] === "object" && row[k] !== null
        ? JSON.stringify(row[k])
        : row[k],
    );
  const writes = [
    db
      .prepare(
        `INSERT INTO ${type}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${keys
          .filter((k) => k !== "id")
          .map((k) => `${k}=excluded.${k}`)
          .join(",")}`,
      )
      .bind(...encoded),
    audit(db, type, id, before, row, reason, actor),
  ];
  if (!before)
    for (const [field, kind] of Object.entries(def.claims ?? {})) {
      const c = {
        id: ulid(),
        owner_type: type,
        owner_id: id,
        field_key: field,
        kind,
        status: "unknown",
        value_json: null,
        source_type: null,
        source_ref: null,
        checked_at: null,
        recheck_by: defaultRecheck(field, now, type),
        note: "미확인 · 조사 후 입력",
        basis_json: "{}",
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      writes.push(
        db
          .prepare(
            `INSERT INTO claims(${Object.keys(c).join(",")}) VALUES(${Object.keys(
              c,
            )
              .map(() => "?")
              .join(",")})`,
          )
          .bind(...Object.values(c)),
        audit(db, "claim", c.id, null, c, "새 기록의 미확인 항목", actor),
      );
    }
  await db.batch(writes);
  if (type === "compliance_profiles" && !before)
    for (const key of requirementKeys)
      await saveRecord(
        db,
        "requirement_items",
        { profile_id: id, key, question: key },
        "새 프로필 요건 생성",
        actor,
        true,
      );
  if (type === "requirement_items")
    await refreshGate(db, values.profile_id, actor);
  if (type === "shipping_legs")
    await refreshWarnings(db, values.scenario_id, actor);
  if (
    type === "offers" &&
    (values.status === "chosen" || before?.status === "chosen")
  ) {
    const p = await getRecord(db, "products", values.product_id);
    if (p)
      await patchManaged(
        db,
        "products",
        p,
        { chosen_offer_id: values.status === "chosen" ? id : null },
        reason,
        actor,
      );
  }
  return row;
}
export async function patchManaged(
  db: D1Database,
  type: string,
  before: Row,
  changes: Row,
  reason: string,
  actor = "user",
) {
  const pairs = Object.entries(changes);
  const after = { ...before, ...changes };
  await db.batch([
    db
      .prepare(
        `UPDATE ${type} SET ${pairs.map(([k]) => `${k}=?`).join(",")},updated_at=? WHERE id=?`,
      )
      .bind(
        ...pairs.map(([, v]) =>
          typeof v === "object" && v !== null ? JSON.stringify(v) : v,
        ),
        new Date().toISOString(),
        before.id,
      ),
    audit(db, type, before.id, before, after, reason, actor),
  ]);
  return after;
}
export async function refreshGate(db: D1Database, id: string, actor = "user") {
  const p = await getRecord(db, "compliance_profiles", id);
  if (!p) return;
  const items = (await listRecords(db, "requirement_items")).filter(
    (i) => i.profile_id === id,
  );
  const result = items.some((i) => i.item_result === "fail")
    ? "fail"
    : items.length !== 13 || items.some((i) => i.item_result === "unknown")
      ? "unknown"
      : items.some((i) => i.item_result === "conditional")
        ? "conditional"
        : "pass";
  const reason = items
    .filter((i) => i.item_result !== "pass")
    .map((i) => `${i.key}: ${i.item_result} ${i.condition_text ?? ""}`)
    .join("\n");
  if (result !== p.gate_result || reason !== p.gate_reason)
    await patchManaged(
      db,
      "compliance_profiles",
      p,
      {
        gate_result: result,
        gate_reason: reason,
        gate_set_by: "derived",
        reviewed_at: new Date().toISOString(),
      },
      "13개 요건 항목에서 판정 집계",
      actor,
    );
}
export async function refreshWarnings(
  db: D1Database,
  id: string,
  actor = "user",
) {
  const s = await getRecord(db, "shipping_scenarios", id);
  if (!s) return;
  const legs = (await listRecords(db, "shipping_legs")).filter(
    (l) => l.scenario_id === id,
  );
  const warnings = legs.flatMap((a) =>
    legs
      .filter((b) => b.id !== a.id && a.includes?.includes(b.cost_code))
      .map(
        (b) =>
          `구간 ${a.seq}에 ${b.cost_code} 포함: 구간 ${b.seq} 별도 비용과 중복 여부를 확인하세요.`,
      ),
  );
  if (JSON.stringify(warnings) !== JSON.stringify(s.warnings))
    await patchManaged(
      db,
      "shipping_scenarios",
      s,
      { warnings },
      "배송 구간 포함 항목 중복 확인",
      actor,
    );
}
export async function deleteRecord(
  db: D1Database,
  type: string,
  id: string,
  reason: string,
) {
  if (!reason?.trim()) fail("삭제 이유가 필요합니다.");
  const before = await getRecord(db, type, id);
  if (!before) fail("기록이 없습니다.");
  if (["fx_rates", "costings"].includes(type))
    fail("고정된 환율·스냅샷은 삭제할 수 없습니다.");
  if (type === "tasks" && before.source === "derived")
    fail("원본 기록의 조건을 해결하세요.");
  if (type === "readiness_items" || type === "requirement_items")
    fail(
      "필수 확인 항목은 삭제하지 않습니다. 해당 없음 또는 판정 이유를 남겨주세요.",
    );
  for (const [other, d] of Object.entries(catalog))
    for (const [key, f] of Object.entries(d.fields))
      if (f.ref === type) {
        const referenced = await db
          .prepare(
            `SELECT id FROM ${other} WHERE ${key}=?${other === "fx_rates" ? "" : " AND deleted_at IS NULL"} LIMIT 1`,
          )
          .bind(id)
          .first();
        if (referenced) fail(`연결된 ${d.label}이 있어 삭제할 수 없습니다.`);
      }
  const at = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE ${type} SET deleted_at=? WHERE id=?`).bind(at, id),
    audit(
      db,
      type,
      id,
      before,
      { ...before, deleted_at: at },
      reason,
      "user",
      "delete",
    ),
  ]);
  if (type === "shipping_legs") await refreshWarnings(db, before.scenario_id);
  if (type === "requirement_items") await refreshGate(db, before.profile_id);
}
