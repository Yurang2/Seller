import { z } from "zod";
import { ulid } from "ulid";
import { catalog, requirementKeys, stages } from "../../domain/records/catalog";
import { AppError } from "../errors";
import { readClaims } from "../../db/repo/claims";
import { defaultRecheck } from "../../domain/claim";
import { moneySchema } from "../../domain/types/claim";
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
export function decode(row: Row | null, type?: string): Row | null {
  if (!row) return null;
  const fields = type ? (catalog[type]?.fields ?? {}) : {};
  const jsonKeys = new Set(
    Object.entries(fields)
      .filter(([, f]) => f.type === "json")
      .map(([k]) => k),
  );
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      typeof v === "string" && (k.endsWith("_json") || jsonKeys.has(k))
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
  ).results.map((r) => decode(r, type)!);
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
    type,
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
  if (type === "listings") {
    for (const key of ["listed_price", "customer_shipping_fee"])
      if (out[key] !== null) {
        const m = moneySchema.safeParse(out[key]);
        if (!m.success || m.data.currency !== "KRW")
          fail(
            "등록 판매가·청구 배송비는 {amount_minor, currency: 'KRW'} 형식입니다.",
          );
      }
    if (out.status === "live") {
      if (!out.external_id?.trim() && !out.url?.trim())
        fail(
          "판매 중 등록에는 채널 상품 번호 또는 상품 페이지 URL이 필요합니다.",
        );
      if (out.listed_price === null)
        fail("판매 중 등록에는 등록 판매가가 필요합니다.");
      if (out.assets_source === "unknown")
        fail(
          "상세페이지 이미지 출처가 미확인이면 판매 중으로 바꿀 수 없습니다. 직접 촬영 또는 사용 허락을 기록하세요.",
        );
      if (!out.last_verified_at)
        fail("판매 중 등록에는 채널에서 실제 노출을 확인한 날짜가 필요합니다.");
    }
  }
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
  if (type === "listings") {
    const p = (await getRecord(db, "products", values.product_id))!;
    if (values.variant_id) {
      const v = await getRecord(db, "product_variants", values.variant_id);
      if (v?.product_id !== values.product_id) fail("다른 상품의 옵션입니다.");
    }
    if (values.costing_id) {
      const cst = await getRecord(db, "costings", values.costing_id);
      if (cst?.product_id !== values.product_id)
        fail("다른 상품의 원가 스냅샷입니다.");
    }
    if (values.status === "live") {
      if (!["listing_ready", "live", "paused"].includes(p.status))
        fail(
          "상품이 등록 준비 단계에 도달해야 판매 중으로 기록할 수 있습니다. 현재: " +
            p.status,
        );
      const decided = (await readClaims(db)).find(
        (c) =>
          c.owner_type === "products" &&
          c.owner_id === p.id &&
          c.field_key === "decided_price",
      );
      const decidedMinor = (decided?.value_json as Row | null)?.amount_minor;
      if (
        decided?.status !== "unknown" &&
        decidedMinor != null &&
        values.listed_price?.amount_minor !== decidedMinor
      )
        fail(
          `등록 판매가가 결정 판매가(${decidedMinor}원)와 다릅니다. 가격 결정을 다시 기록한 뒤 등록하세요.`,
        );
    }
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
    // 통과·조건부는 "근거의 질"을 본다. 규칙의 형식만 지키고 실질을 우회하지 못하게 한다.
    if (["pass", "conditional"].includes(values.item_result)) {
      const evidenceLinks = await db
        .prepare(
          "SELECT id FROM links WHERE deleted_at IS NULL AND relation='evidence_for' AND ((to_type='requirement_items' AND to_id=?) OR (from_type='requirement_items' AND from_id=?)) LIMIT 1",
        )
        .bind(id, id)
        .first();
      const hasEvidence = answer.attachment_ids.length > 0 || !!evidenceLinks;
      if (values.risk_level === "high") {
        if (answer.status !== "confirmed")
          fail(
            "위험도 높음 항목은 확인 상태의 답변(기관 회신·법령·권리자 자료)이 있어야 통과·조건부로 판정할 수 있습니다.",
          );
        if (!hasEvidence)
          fail(
            "위험도 높음 항목의 통과·조건부 판정에는 첨부 파일 또는 근거로 연결된 기록(evidence_for)이 필요합니다.",
          );
      }
      if (
        answer.source_type === "self_estimate" &&
        values.item_result === "pass" &&
        values.risk_level !== "low"
      )
        fail(
          "직접 세운 가정만으로는 통과 판정을 할 수 없습니다. 조건부로 기록하거나 외부 근거를 첨부하세요.",
        );
    }
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
export async function listDeleted(db: D1Database, type: string) {
  definition(type);
  if (type === "fx_rates") return [];
  return (
    await db
      .prepare(
        `SELECT * FROM ${type} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`,
      )
      .all<Row>()
  ).results.map((r) => decode(r, type)!);
}
export async function restoreRecord(
  db: D1Database,
  type: string,
  id: string,
  reason: string,
  actor = "user",
) {
  if (!reason?.trim()) fail("복구 이유가 필요합니다.");
  const def = definition(type);
  const row = decode(
    await db
      .prepare(`SELECT * FROM ${type} WHERE id=? AND deleted_at IS NOT NULL`)
      .bind(id)
      .first<Row>(),
    type,
  );
  if (!row) fail("삭제된 기록이 아닙니다.");
  for (const [key, f] of Object.entries(def.fields))
    if (f.ref && row[key] && !(await getRecord(db, f.ref, row[key])))
      fail(
        `${f.label} 연결 대상이 삭제돼 있어 먼저 그 기록을 복구해야 합니다.`,
      );
  const at = new Date().toISOString();
  await db.batch([
    db
      .prepare(`UPDATE ${type} SET deleted_at=NULL, updated_at=? WHERE id=?`)
      .bind(at, id),
    audit(
      db,
      type,
      id,
      row,
      { ...row, deleted_at: null },
      reason,
      actor,
      "restore",
    ),
  ]);
  if (type === "shipping_legs")
    await refreshWarnings(db, row.scenario_id, actor);
  if (type === "requirement_items")
    await refreshGate(db, row.profile_id, actor);
  return { ...row, deleted_at: null };
}
export async function deleteRecord(
  db: D1Database,
  type: string,
  id: string,
  reason: string,
  actor = "user",
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
      actor,
      "delete",
    ),
  ]);
  if (type === "shipping_legs") await refreshWarnings(db, before.scenario_id);
  if (type === "requirement_items") await refreshGate(db, before.profile_id);
}
