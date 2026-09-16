import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../../db/schema";
import type { Env } from "../env";
import { AppError } from "../errors";
import { sha256 } from "../services/attachments";
import { ulid } from "ulid";
import { claimSchema } from "../../domain/types/claim";
import { needsAttachment } from "../../domain/claim";

const tables = [
  "settings",
  "attachments",
  "claims",
  "claim_attachments",
  "links",
  "notes",
  "decisions",
  "sops",
  "fx_rates",
  "cost_line_types",
  "tasks",
  "import_batches",
  "activity_log",
  "characters",
  "compliance_profiles",
  "requirement_items",
  "products",
  "product_variants",
  "suppliers",
  "supplier_messages",
  "offers",
  "forwarders",
  "rate_cards",
  "shipping_scenarios",
  "shipping_legs",
  "channels",
  "readiness_items",
  "costings",
] as const;
type Table = (typeof tables)[number];
type Row = Record<string, string | number | null>;
function tableColumns(t: Table) {
  return Object.keys(getTableColumns(schema[t]));
}
function keyColumns(t: Table) {
  return t === "settings"
    ? ["key"]
    : t === "cost_line_types"
      ? ["code"]
      : t === "claim_attachments"
        ? ["claim_id", "attachment_id"]
        : ["id"];
}
function csv(rows: Row[], columns: string[]) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return [
    columns.map(cell).join(","),
    ...rows.map((r) => columns.map((k) => cell(r[k])).join(",")),
  ].join("\r\n");
}
// Core M0 has no customer tables. Keep defensive masking for future nested records/logs.
function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(phone|address|customs_code|customs_code_enc|customer_name)$/.test(k)
          ? "[MASKED]"
          : mask(v),
      ]),
    );
  if (typeof value === "string" && /^[\[{]/.test(value)) {
    try {
      return JSON.stringify(mask(JSON.parse(value)));
    } catch {
      return value;
    }
  }
  return value;
}
export async function exportArchive(env: Env, full = false) {
  const files: Record<string, Uint8Array> = {},
    counts: Record<string, number> = {};
  let attachmentRows: Row[] = [];
  for (const t of tables) {
    const rows = (await env.DB.prepare(`SELECT * FROM ${t}`).all<Row>())
      .results;
    if (t === "attachments") attachmentRows = rows;
    const safe = (full ? rows : mask(rows)) as Row[];
    counts[t] = rows.length;
    files[`entities/${t}.json`] = strToU8(JSON.stringify(safe));
    files[`entities/${t}.csv`] = strToU8("\uFEFF" + csv(safe, tableColumns(t)));
  }
  const manifests = [];
  for (const row of attachmentRows) {
    const object = await env.ATTACHMENTS.get(String(row.r2_key));
    if (!object)
      throw new AppError(
        409,
        "MISSING_ATTACHMENT",
        `첨부 원본이 없습니다: ${row.filename}`,
      );
    const bytes = new Uint8Array(await object.arrayBuffer());
    if ((await sha256(bytes)) !== row.sha256)
      throw new AppError(
        409,
        "ATTACHMENT_HASH_MISMATCH",
        "첨부 파일 검증에 실패했습니다.",
      );
    const path = `attachments/files/${row.id}`;
    files[path] = bytes;
    manifests.push({
      id: row.id,
      r2_key: row.r2_key,
      sha256: row.sha256,
      owner_type: row.owner_type,
      owner_id: row.owner_id,
      path,
    });
  }
  files["attachments/manifest.json"] = strToU8(JSON.stringify(manifests));
  files["manifest.json"] = strToU8(
    JSON.stringify({
      schema_version: 2,
      exported_at: new Date().toISOString(),
      pii_mode: full ? "full" : "masked",
      counts,
      attachments_included: true,
    }),
  );
  return zipSync(files, { level: 6 });
}
export async function restoreArchive(
  env: Env,
  bytes: Uint8Array,
  apply: boolean,
  expectedHash?: string,
) {
  if (bytes.byteLength > 25 * 1024 * 1024)
    throw new AppError(
      413,
      "ARCHIVE_TOO_LARGE",
      "백업 ZIP은 25MB 이하로 올려주세요.",
    );
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > 100 * 1024 * 1024) throw new Error("size");
        return true;
      },
    });
  } catch {
    throw new AppError(
      400,
      "INVALID_ARCHIVE",
      "ZIP 형식 또는 압축 해제 크기를 확인해주세요.",
    );
  }
  function json(path: string) {
    try {
      if (!files[path]) throw 0;
      return JSON.parse(strFromU8(files[path]));
    } catch {
      throw new AppError(
        400,
        "INVALID_ARCHIVE",
        `백업 파일을 읽을 수 없습니다: ${path}`,
      );
    }
  }
  const manifest = json("manifest.json");
  if (![1, 2].includes(manifest.schema_version))
    throw new AppError(
      409,
      "SCHEMA_VERSION",
      "지원하지 않는 백업 스키마 버전입니다.",
    );
  const digest = await sha256(bytes);
  if (apply && digest !== expectedHash)
    throw new AppError(
      409,
      "PREVIEW_REQUIRED",
      "같은 백업의 미리보기 결과를 확인한 후 적용하세요.",
    );
  const data = {} as Record<Table, Row[]>;
  let added = 0,
    updated = 0,
    unchanged = 0;
  const statements: D1PreparedStatement[] = [];
  const auditStatements: D1PreparedStatement[] = [];
  const results: unknown[] = [];
  for (const t of tables) {
    const legacyMissing =
      manifest.schema_version === 1 &&
      !files[`entities/${t}.json`] &&
      tables.indexOf(t) > tables.indexOf("activity_log");
    const rows = legacyMissing ? [] : json(`entities/${t}.json`);
    const columns = tableColumns(t);
    if (
      !Array.isArray(rows) ||
      (!legacyMissing && rows.length !== manifest.counts[t])
    )
      throw new AppError(400, "INVALID_ARCHIVE", `${t} 건수가 다릅니다.`);
    const seen = new Set<string>();
    const existingRows = (await env.DB.prepare(`SELECT * FROM ${t}`).all<Row>())
      .results;
    const existingByKey = new Map(
      existingRows.map((row) => [
        JSON.stringify(keyColumns(t).map((k) => row[k])),
        row,
      ]),
    );
    for (const row of rows) {
      if (
        !row ||
        typeof row !== "object" ||
        Object.keys(row).some((k) => !columns.includes(k)) ||
        columns.some((k) => !(k in row)) ||
        Object.values(row).some(
          (v) => v !== null && typeof v !== "string" && typeof v !== "number",
        )
      )
        throw new AppError(
          400,
          "INVALID_ARCHIVE",
          `${t} 열 또는 값 형식이 다릅니다.`,
        );
      const keys = keyColumns(t);
      const identity = JSON.stringify(keys.map((k) => row[k]));
      if (seen.has(identity) || keys.some((k) => row[k] == null))
        throw new AppError(
          400,
          "INVALID_ARCHIVE",
          `${t} 식별자가 중복되거나 없습니다.`,
        );
      seen.add(identity);
      const old = existingByKey.get(identity);
      const same = old && columns.every((k) => old[k] === row[k]);
      const action = !old ? "add" : same ? "unchanged" : "update";
      if (!old) added++;
      else if (same) unchanged++;
      else updated++;
      results.push({ table: t, key: identity, action });
      if (!same && apply) {
        const nonkeys = columns.filter((c) => !keys.includes(c));
        statements.push(
          env.DB.prepare(
            `INSERT INTO ${t} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT (${keys.join(",")}) DO ${nonkeys.length ? "UPDATE SET " + nonkeys.map((k) => `${k}=excluded.${k}`).join(",") : "NOTHING"}`,
          ).bind(...columns.map((k) => row[k])),
        );
        if (t !== "activity_log")
          auditStatements.push(
            env.DB.prepare(
              "INSERT INTO activity_log (id,entity_type,entity_id,action,before_json,after_json,reason,actor,at) VALUES (?,?,?,?,?,?,?,?,?)",
            ).bind(
              ulid(),
              t,
              identity,
              "restore",
              old ? JSON.stringify(old) : null,
              JSON.stringify(row),
              "백업 미리보기 확인 후 복원",
              "user",
              new Date().toISOString(),
            ),
          );
      }
    }
    data[t] = rows;
  }
  const attachmentManifest = json("attachments/manifest.json");
  if (!Array.isArray(attachmentManifest))
    throw new AppError(400, "INVALID_ARCHIVE", "첨부 목록 형식이 다릅니다.");
  for (const row of data.attachments) {
    const meta = attachmentManifest.find(
      (m: { id: string }) => m.id === row.id,
    );
    if (
      !meta ||
      meta.r2_key !== row.r2_key ||
      !String(row.r2_key).startsWith("attachments/") ||
      !files[meta.path] ||
      (await sha256(files[meta.path])) !== row.sha256
    )
      throw new AppError(
        400,
        "INVALID_ATTACHMENT",
        "첨부 원본과 해시가 일치하지 않습니다.",
      );
  }
  for (const row of data.claims) {
    const ids = data.claim_attachments
      .filter((j) => j.claim_id === row.id)
      .map((j) => String(j.attachment_id));
    const valid = claimSchema.safeParse({
      ...row,
      value_json:
        row.value_json === null ? null : JSON.parse(String(row.value_json)),
      basis_json: JSON.parse(String(row.basis_json ?? "{}")),
      attachment_ids: ids,
    });
    if (
      !valid.success ||
      ids.some(
        (id) =>
          !data.attachments.some((a) => a.id === id && a.deleted_at === null),
      )
    )
      throw new AppError(
        400,
        "INVALID_CLAIM",
        "복원할 Claim 또는 증빙 연결이 유효하지 않습니다.",
      );
    if (
      row.status === "confirmed" &&
      needsAttachment(valid.data) &&
      !ids.length
    )
      throw new AppError(400, "INVALID_CLAIM", "확인 가격에 증빙이 없습니다.");
  }
  if (apply) {
    // Content-address verified bytes are uploaded before committing all DB changes together.
    // Existing keys may only be reused for identical evidence, never overwritten silently.
    const uploaded: string[] = [];
    try {
      for (const row of data.attachments) {
        const existing = await env.ATTACHMENTS.get(String(row.r2_key));
        if (existing) {
          if (
            (await sha256(new Uint8Array(await existing.arrayBuffer()))) !==
            row.sha256
          )
            throw new AppError(
              409,
              "ATTACHMENT_CONFLICT",
              "기존 첨부와 백업 내용이 다릅니다.",
            );
          continue;
        }
        const m = attachmentManifest.find(
          (v: { id: string }) => v.id === row.id,
        );
        await env.ATTACHMENTS.put(String(row.r2_key), files[m.path], {
          httpMetadata: { contentType: String(row.mime) },
        });
        uploaded.push(String(row.r2_key));
      }
      statements.unshift(env.DB.prepare("PRAGMA defer_foreign_keys = ON"));
      statements.push(
        ...auditStatements,
        env.DB.prepare(
          "INSERT INTO activity_log (id,entity_type,entity_id,action,after_json,reason,actor,at) VALUES (?,?,?,?,?,?,?,?)",
        ).bind(
          ulid(),
          "backup",
          digest,
          "restore",
          JSON.stringify({ added, updated, unchanged }),
          "미리보기 확인 후 백업 복원",
          "user",
          new Date().toISOString(),
        ),
      );
      await env.DB.batch(statements);
    } catch (e) {
      for (const key of uploaded) await env.ATTACHMENTS.delete(key);
      throw e;
    }
  }
  return {
    archive_hash: digest,
    added,
    updated,
    unchanged,
    results,
    applied: apply,
    attachments: data.attachments.length,
  };
}
