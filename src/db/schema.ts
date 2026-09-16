import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  check,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
// Core tables mirror ARCHITECTURE.md §7; business invariants are enforced in domain/services.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value_json: text("value_json").notNull(),
  updated_at: text("updated_at").notNull(),
});
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    owner_type: text("owner_type").notNull(),
    owner_id: text("owner_id").notNull(),
    purpose: text("purpose").notNull(),
    r2_key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    captured_at: text("captured_at"),
    note: text("note"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_attachments_owner").on(t.owner_type, t.owner_id),
    uniqueIndex("uq_attachments_r2_key").on(t.r2_key),
    check(
      "attachments_check_0",
      sql`purpose IN ('evidence','screenshot','invoice','receipt','label','document','other')`,
    ),
  ],
);
export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    owner_type: text("owner_type").notNull(),
    owner_id: text("owner_id").notNull(),
    field_key: text("field_key").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    value_json: text("value_json"),
    source_type: text("source_type"),
    source_ref: text("source_ref"),
    checked_at: text("checked_at"),
    recheck_by: text("recheck_by").notNull(),
    note: text("note"),
    basis_json: text("basis_json"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_claims_recheck")
      .on(t.recheck_by)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("uq_claims_owner_type_owner_id_field_key").on(
      t.owner_type,
      t.owner_id,
      t.field_key,
    ),
    check(
      "claims_check_0",
      sql`kind IN ('money','percent','number','bool','text','enum','range','days')`,
    ),
    check("claims_check_1", sql`status IN ('confirmed','estimated','unknown')`),
    check(
      "claims_check_2",
      sql`source_type IN ('url','screenshot','message','call','document','competitor_observation','self_estimate','api')`,
    ),
  ],
);
export const claim_attachments = sqliteTable(
  "claim_attachments",
  {
    claim_id: text("claim_id")
      .notNull()
      .references((): AnySQLiteColumn => claims.id),
    attachment_id: text("attachment_id")
      .notNull()
      .references((): AnySQLiteColumn => attachments.id),
  },
  (t) => [primaryKey({ columns: [t.claim_id, t.attachment_id] })],
);
export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    from_type: text("from_type").notNull(),
    from_id: text("from_id").notNull(),
    to_type: text("to_type").notNull(),
    to_id: text("to_id").notNull(),
    relation: text("relation").notNull(),
    note: text("note"),
    created_at: text("created_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_links_to").on(t.to_type, t.to_id),
    index("idx_links_from").on(t.from_type, t.from_id),
    check(
      "links_check_0",
      sql`relation IN ('related','evidence_for','decided_by','supersedes','derived_from','blocks')`,
    ),
  ],
);
export const activity_log = sqliteTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    entity_type: text("entity_type").notNull(),
    entity_id: text("entity_id").notNull(),
    action: text("action").notNull(),
    before_json: text("before_json"),
    after_json: text("after_json"),
    reason: text("reason"),
    actor: text("actor").notNull(),
    at: text("at").notNull(),
  },
  (t) => [
    index("idx_activity_actor").on(t.actor, t.at),
    index("idx_activity_entity").on(t.entity_type, t.entity_id, t.at),
    check(
      "activity_log_check_0",
      sql`action IN ('create','update','transition','delete','restore','import','job')`,
    ),
  ],
);
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    detail: text("detail"),
    entity_type: text("entity_type"),
    entity_id: text("entity_id"),
    source: text("source").notNull(),
    rule_key: text("rule_key"),
    status: text("status").notNull(),
    priority: integer("priority").notNull(),
    due_at: text("due_at"),
    completed_at: text("completed_at"),
    blocked_kind: text("blocked_kind"),
    blocked_reason: text("blocked_reason"),
    unblock_condition: text("unblock_condition"),
    recheck_at: text("recheck_at"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_tasks_derived_open")
      .on(t.rule_key, t.entity_type, t.entity_id)
      .where(
        sql`source = 'derived' AND status NOT IN ('done','cancelled') AND deleted_at IS NULL`,
      ),
    check("tasks_check_0", sql`source IN ('manual','derived')`),
    check(
      "tasks_check_1",
      sql`status IN ('todo','doing','blocked','done','cancelled')`,
    ),
    check("tasks_check_2", sql`priority BETWEEN 1 AND 4`),
    check(
      "tasks_check_3",
      sql`blocked_kind IN ('external','decision','internal')`,
    ),
    check(
      "tasks_check_4",
      sql`status <> 'blocked' OR (blocked_reason IS NOT NULL AND unblock_condition IS NOT NULL AND recheck_at IS NOT NULL)`,
    ),
  ],
);
export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body_md: text("body_md")
      .notNull()
      .default(sql`''`),
    tags_json: text("tags_json")
      .notNull()
      .default(sql`'[]'`),
    pinned: integer("pinned")
      .notNull()
      .default(sql`0`),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    check(
      "notes_check_0",
      sql`type IN ('concept','research','competitor_observation','meeting','journal')`,
    ),
  ],
);
export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    code: text("code"),
    title: text("title").notNull(),
    context: text("context"),
    decision: text("decision").notNull(),
    rationale: text("rationale").notNull(),
    alternatives_json: text("alternatives_json")
      .notNull()
      .default(sql`'[]'`),
    consequences: text("consequences"),
    status: text("status").notNull(),
    decided_at: text("decided_at"),
    revisit_when: text("revisit_when"),
    revisit_at: text("revisit_at"),
    superseded_by: text("superseded_by").references(
      (): AnySQLiteColumn => decisions.id,
    ),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_decisions_code").on(t.code),
    check(
      "decisions_check_0",
      sql`status IN ('proposed','accepted','superseded','rejected')`,
    ),
  ],
);
export const sops = sqliteTable(
  "sops",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    steps_json: text("steps_json")
      .notNull()
      .default(sql`'[]'`),
    inputs: text("inputs"),
    outputs: text("outputs"),
    failure_handling: text("failure_handling"),
    automation_state: text("automation_state")
      .notNull()
      .default(sql`'none'`),
    job_key: text("job_key"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_sops_key").on(t.key),
    check("sops_check_0", sql`automation_state IN ('none','file','api')`),
  ],
);
export const fx_rates = sqliteTable(
  "fx_rates",
  {
    id: text("id").primaryKey(),
    base_currency: text("base_currency").notNull(),
    quote_currency: text("quote_currency")
      .notNull()
      .default(sql`'KRW'`),
    rate: text("rate").notNull(),
    as_of_date: text("as_of_date").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    note: text("note"),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex(
      "uq_fx_rates_base_currency_quote_currency_as_of_date_kind_source",
    ).on(t.base_currency, t.quote_currency, t.as_of_date, t.kind, t.source),
    check(
      "fx_rates_check_0",
      sql`kind IN ('reference','card_actual','manual')`,
    ),
  ],
);
export const cost_line_types = sqliteTable(
  "cost_line_types",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    direction: text("direction").notNull(),
    stage: text("stage").notNull(),
    payer_default: text("payer_default").notNull(),
    basis: text("basis").notNull(),
    is_system: integer("is_system")
      .notNull()
      .default(sql`0`),
    active: integer("active")
      .notNull()
      .default(sql`1`),
    sort_order: integer("sort_order")
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    check("cost_line_types_check_0", sql`direction IN ('income','expense')`),
    check(
      "cost_line_types_check_1",
      sql`stage IN ('sale','purchase','transport','customs','channel','other')`,
    ),
    check(
      "cost_line_types_check_2",
      sql`payer_default IN ('me','customer','supplier','by_model')`,
    ),
    check(
      "cost_line_types_check_3",
      sql`basis IN ('per_item','per_order','per_parcel','per_kg','per_purchase','percent_of_price','per_month')`,
    ),
  ],
);
export const import_batches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    mapping_json: text("mapping_json").notNull(),
    rows_total: integer("rows_total")
      .notNull()
      .default(sql`0`),
    rows_ok: integer("rows_ok")
      .notNull()
      .default(sql`0`),
    rows_failed: integer("rows_failed")
      .notNull()
      .default(sql`0`),
    results_json: text("results_json")
      .notNull()
      .default(sql`'[]'`),
    applied: integer("applied")
      .notNull()
      .default(sql`0`),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    check(
      "import_batches_check_0",
      sql`kind IN ('orders','settlement','tracking','excel_research')`,
    ),
  ],
);
