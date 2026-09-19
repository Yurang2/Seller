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

// M0 research import storage; M1 domain entities. Claims are stored separately.
export const characters = sqliteTable(
  "characters",
  {
    id: text("id").primaryKey(),
    name_ko: text("name_ko").notNull(),
    name_en: text("name_en"),
    notes: text("notes"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [],
);
export const compliance_profiles = sqliteTable(
  "compliance_profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    character_id: text("character_id")
      .references((): AnySQLiteColumn => characters.id)
      .notNull(),
    category: text("category"),
    model_scope: text("model_scope"),
    gate_result: text("gate_result"),
    gate_reason: text("gate_reason"),
    gate_set_by: text("gate_set_by"),
    reviewed_at: text("reviewed_at"),
    recheck_by: text("recheck_by"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_compliance_profiles_character_id").on(t.character_id),
    check(
      "compliance_profiles_category_enum",
      sql`category IN ('plush','plush_keyring','acrylic','stationery','other')`,
    ),
    check(
      "compliance_profiles_model_scope_enum",
      sql`model_scope IN ('purchase_agency','import_resale','both')`,
    ),
    check(
      "compliance_profiles_gate_result_enum",
      sql`gate_result IN ('unknown','pass','conditional','fail')`,
    ),
    check(
      "compliance_profiles_gate_set_by_enum",
      sql`gate_set_by IN ('derived','manual')`,
    ),
  ],
);
export const requirement_items = sqliteTable(
  "requirement_items",
  {
    id: text("id").primaryKey(),
    profile_id: text("profile_id")
      .references((): AnySQLiteColumn => compliance_profiles.id)
      .notNull(),
    key: text("key"),
    question: text("question").notNull(),
    risk_level: text("risk_level"),
    item_result: text("item_result"),
    condition_text: text("condition_text"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_requirement_items_profile_id").on(t.profile_id),
    check(
      "requirement_items_key_enum",
      sql`key IN ('children_product','kc','trademark_license','parallel_import','copyright_import','design_right','customs_ip_watch','platform_ip_report','listing_assets','customs','labeling','channel_policy','return_policy')`,
    ),
    check(
      "requirement_items_risk_level_enum",
      sql`risk_level IN ('low','medium','high')`,
    ),
    check(
      "requirement_items_item_result_enum",
      sql`item_result IN ('unknown','pass','conditional','fail')`,
    ),
    uniqueIndex("uq_requirement_profile_key").on(t.profile_id, t.key),
  ],
);
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    character_id: text("character_id").references(
      (): AnySQLiteColumn => characters.id,
    ),
    profile_id: text("profile_id").references(
      (): AnySQLiteColumn => compliance_profiles.id,
    ),
    category: text("category"),
    option_scheme: text("option_scheme"),
    status: text("status"),
    status_reason: text("status_reason"),
    stage_entered_at: text("stage_entered_at"),
    hold_recheck_at: text("hold_recheck_at"),
    chosen_offer_id: text("chosen_offer_id").references(
      (): AnySQLiteColumn => offers.id,
    ),
    chosen_scenario_id: text("chosen_scenario_id").references(
      (): AnySQLiteColumn => shipping_scenarios.id,
    ),
    current_costing_id: text("current_costing_id").references(
      (): AnySQLiteColumn => costings.id,
    ),
    pricing_decision_id: text("pricing_decision_id").references(
      (): AnySQLiteColumn => decisions.id,
    ),
    competitor_refs: text("competitor_refs"),
    images: text("images"),
    notes: text("notes"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_products_character_id").on(t.character_id),
    index("idx_products_profile_id").on(t.profile_id),
    check(
      "products_category_enum",
      sql`category IN ('plush','plush_keyring','acrylic','stationery','other')`,
    ),
    check(
      "products_option_scheme_enum",
      sql`option_scheme IN ('designated','random','set')`,
    ),
    check(
      "products_status_enum",
      sql`status IN ('discovered','researching','costing','pricing','listing_ready','live','paused','discontinued','rejected','on_hold')`,
    ),
    index("idx_products_chosen_offer_id").on(t.chosen_offer_id),
    index("idx_products_chosen_scenario_id").on(t.chosen_scenario_id),
    index("idx_products_current_costing_id").on(t.current_costing_id),
    index("idx_products_pricing_decision_id").on(t.pricing_decision_id),
  ],
);
export const product_variants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    product_id: text("product_id")
      .references((): AnySQLiteColumn => products.id)
      .notNull(),
    name: text("name").notNull(),
    option_kind: text("option_kind"),
    random_pool_desc: text("random_pool_desc"),
    sku_internal: text("sku_internal"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_product_variants_product_id").on(t.product_id),
    check(
      "product_variants_option_kind_enum",
      sql`option_kind IN ('designated','random')`,
    ),
  ],
);
export const suppliers = sqliteTable(
  "suppliers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    name_local: text("name_local"),
    platform: text("platform"),
    seller_type: text("seller_type"),
    store_url: text("store_url"),
    country: text("country"),
    contact_channels: text("contact_channels"),
    payment_methods: text("payment_methods"),
    trust_notes: text("trust_notes"),
    last_contact_at: text("last_contact_at"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    check(
      "suppliers_platform_enum",
      sql`platform IN ('taobao','tmall','1688','ruten','other')`,
    ),
    check(
      "suppliers_seller_type_enum",
      sql`seller_type IN ('unknown','brand_flagship','authorized','general')`,
    ),
  ],
);
export const supplier_messages = sqliteTable(
  "supplier_messages",
  {
    id: text("id").primaryKey(),
    supplier_id: text("supplier_id")
      .references((): AnySQLiteColumn => suppliers.id)
      .notNull(),
    at: text("at").notNull(),
    direction: text("direction"),
    summary: text("summary"),
    attachment_ids: text("attachment_ids"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_supplier_messages_supplier_id").on(t.supplier_id),
    check("supplier_messages_direction_enum", sql`direction IN ('in','out')`),
  ],
);
export const offers = sqliteTable(
  "offers",
  {
    id: text("id").primaryKey(),
    product_id: text("product_id")
      .references((): AnySQLiteColumn => products.id)
      .notNull(),
    supplier_id: text("supplier_id")
      .references((): AnySQLiteColumn => suppliers.id)
      .notNull(),
    variant_id: text("variant_id").references(
      (): AnySQLiteColumn => product_variants.id,
    ),
    url: text("url"),
    option_desc: text("option_desc"),
    option_kind: text("option_kind"),
    set_composition: text("set_composition"),
    random_rule: text("random_rule"),
    quantity_tier_min: integer("quantity_tier_min"),
    quantity_tier_max: integer("quantity_tier_max"),
    moq: integer("moq"),
    currency: text("currency"),
    includes_shipping_to: text("includes_shipping_to"),
    authenticity_evidence: text("authenticity_evidence"),
    status: text("status"),
    rejection_reason: text("rejection_reason"),
    decision_id: text("decision_id").references(
      (): AnySQLiteColumn => decisions.id,
    ),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_offers_product_id").on(t.product_id),
    index("idx_offers_supplier_id").on(t.supplier_id),
    index("idx_offers_variant_id").on(t.variant_id),
    check(
      "offers_option_kind_enum",
      sql`option_kind IN ('unknown','single','set','random','designated')`,
    ),
    check(
      "offers_currency_enum",
      sql`currency IN ('CNY','TWD','KRW','USD','JPY')`,
    ),
    check(
      "offers_includes_shipping_to_enum",
      sql`includes_shipping_to IN ('unknown','none','cn_domestic','kr')`,
    ),
    check(
      "offers_authenticity_evidence_enum",
      sql`authenticity_evidence IN ('unknown','official_license_mark','authorization_doc','seller_claim','none')`,
    ),
    check(
      "offers_status_enum",
      sql`status IN ('candidate','verified','rejected','chosen')`,
    ),
    index("idx_offers_decision_id").on(t.decision_id),
    uniqueIndex("uq_chosen_offer")
      .on(t.product_id)
      .where(sql`status='chosen' AND deleted_at IS NULL`),
  ],
);
export const forwarders = sqliteTable(
  "forwarders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    url: text("url"),
    warehouse_address: text("warehouse_address"),
    currency: text("currency"),
    notes: text("notes"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    check(
      "forwarders_currency_enum",
      sql`currency IN ('CNY','KRW','USD','TWD')`,
    ),
  ],
);
export const rate_cards = sqliteTable(
  "rate_cards",
  {
    id: text("id").primaryKey(),
    forwarder_id: text("forwarder_id")
      .references((): AnySQLiteColumn => forwarders.id)
      .notNull(),
    name: text("name").notNull(),
    effective_from: text("effective_from"),
    weight_bands: text("weight_bands"),
    volumetric_rule: text("volumetric_rule"),
    attachment_ids: text("attachment_ids"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [index("idx_rate_cards_forwarder_id").on(t.forwarder_id)],
);
export const shipping_scenarios = sqliteTable(
  "shipping_scenarios",
  {
    id: text("id").primaryKey(),
    product_id: text("product_id")
      .references((): AnySQLiteColumn => products.id)
      .notNull(),
    offer_id: text("offer_id").references((): AnySQLiteColumn => offers.id),
    name: text("name").notNull(),
    route_type: text("route_type"),
    customs_mode: text("customs_mode"),
    warnings: text("warnings"),
    is_default: integer("is_default"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_shipping_scenarios_product_id").on(t.product_id),
    index("idx_shipping_scenarios_offer_id").on(t.offer_id),
    check(
      "shipping_scenarios_route_type_enum",
      sql`route_type IN ('direct','forwarder')`,
    ),
    check(
      "shipping_scenarios_customs_mode_enum",
      sql`customs_mode IN ('unknown','list_clearance','general')`,
    ),
  ],
);
export const shipping_legs = sqliteTable(
  "shipping_legs",
  {
    id: text("id").primaryKey(),
    scenario_id: text("scenario_id")
      .references((): AnySQLiteColumn => shipping_scenarios.id)
      .notNull(),
    seq: integer("seq").notNull(),
    from_node: text("from_node"),
    to_node: text("to_node"),
    carrier_or_service: text("carrier_or_service"),
    cost_code: text("cost_code"),
    basis: text("basis"),
    includes: text("includes"),
    rate_card_id: text("rate_card_id").references(
      (): AnySQLiteColumn => rate_cards.id,
    ),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_shipping_legs_scenario_id").on(t.scenario_id),
    check(
      "shipping_legs_from_node_enum",
      sql`from_node IN ('seller','forwarder_cn','kr_customs','customer_kr')`,
    ),
    check(
      "shipping_legs_to_node_enum",
      sql`to_node IN ('forwarder_cn','kr_customs','customer_kr')`,
    ),
    check(
      "shipping_legs_cost_code_enum",
      sql`cost_code IN ('cn_domestic_shipping','intl_shipping','kr_domestic_shipping','forwarder_fee')`,
    ),
    check(
      "shipping_legs_basis_enum",
      sql`basis IN ('per_parcel','per_kg','per_item','per_order')`,
    ),
    index("idx_shipping_legs_rate_card_id").on(t.rate_card_id),
  ],
);
export const channels = sqliteTable(
  "channels",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type"),
    account_ref: text("account_ref"),
    policies: text("policies"),
    integration_state: text("integration_state"),
    connector_id: text("connector_id"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    check(
      "channels_type_enum",
      sql`type IN ('smartstore','coupang','cafe24','other')`,
    ),
    check(
      "channels_integration_state_enum",
      sql`integration_state IN ('none','file','api','error')`,
    ),
  ],
);
export const readiness_items = sqliteTable(
  "readiness_items",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    category: text("category"),
    status: text("status"),
    depends_on: text("depends_on"),
    evidence: text("evidence"),
    due_at: text("due_at"),
    recheck_at: text("recheck_at"),
    notes: text("notes"),
    blocks: text("blocks"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    check(
      "readiness_items_category_enum",
      sql`category IN ('decision','legal','tax','customs','channel','finance','logistics','policy','ops')`,
    ),
    check(
      "readiness_items_status_enum",
      sql`status IN ('not_started','in_progress','blocked','done','not_applicable')`,
    ),
    uniqueIndex("uq_readiness_key").on(t.key),
  ],
);
export const costings = sqliteTable(
  "costings",
  {
    id: text("id").primaryKey(),
    product_id: text("product_id")
      .references((): AnySQLiteColumn => products.id)
      .notNull(),
    offer_id: text("offer_id")
      .references((): AnySQLiteColumn => offers.id)
      .notNull(),
    scenario_id: text("scenario_id")
      .references((): AnySQLiteColumn => shipping_scenarios.id)
      .notNull(),
    channel_id: text("channel_id").references(
      (): AnySQLiteColumn => channels.id,
    ),
    qty_assumption: integer("qty_assumption"),
    items_per_order: integer("items_per_order"),
    fx_rate_id: text("fx_rate_id").references(
      (): AnySQLiteColumn => fx_rates.id,
    ),
    inputs_frozen: text("inputs_frozen"),
    lines: text("lines"),
    outputs: text("outputs"),
    overall_status: text("overall_status"),
    unknown_keys: text("unknown_keys"),
    is_current: integer("is_current"),
    decision_id: text("decision_id").references(
      (): AnySQLiteColumn => decisions.id,
    ),
    note: text("note"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_costings_product_id").on(t.product_id),
    index("idx_costings_offer_id").on(t.offer_id),
    index("idx_costings_scenario_id").on(t.scenario_id),
    index("idx_costings_channel_id").on(t.channel_id),
    index("idx_costings_fx_rate_id").on(t.fx_rate_id),
    check(
      "costings_overall_status_enum",
      sql`overall_status IN ('unknown','estimated','confirmed')`,
    ),
    index("idx_costings_decision_id").on(t.decision_id),
  ],
);
export const listings = sqliteTable(
  "listings",
  {
    id: text("id").primaryKey(),
    channel_id: text("channel_id")
      .references((): AnySQLiteColumn => channels.id)
      .notNull(),
    product_id: text("product_id")
      .references((): AnySQLiteColumn => products.id)
      .notNull(),
    variant_id: text("variant_id").references(
      (): AnySQLiteColumn => product_variants.id,
    ),
    external_id: text("external_id"),
    url: text("url"),
    listed_price: text("listed_price"),
    customer_shipping_fee: text("customer_shipping_fee"),
    disclosures: text("disclosures"),
    assets_source: text("assets_source"),
    status: text("status"),
    last_verified_at: text("last_verified_at"),
    costing_id: text("costing_id").references(
      (): AnySQLiteColumn => costings.id,
    ),
    notes: text("notes"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_listings_channel_id").on(t.channel_id),
    index("idx_listings_product_id").on(t.product_id),
    index("idx_listings_costing_id").on(t.costing_id),
    check(
      "listings_assets_source_enum",
      sql`assets_source IN ('unknown','own_photo','licensed','seller_provided_with_permission')`,
    ),
    check(
      "listings_status_enum",
      sql`status IN ('draft','live','paused','ended')`,
    ),
  ],
);
// M3 주문. 통관부호 등 고객 개인정보는 저장하지 않는다(수집 여부만). ENCRYPTION_KEY 없이는 PII를 담지 않는다는 원칙.
export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    channel_id: text("channel_id")
      .references((): AnySQLiteColumn => channels.id)
      .notNull(),
    listing_id: text("listing_id").references(
      (): AnySQLiteColumn => listings.id,
    ),
    product_id: text("product_id")
      .references((): AnySQLiteColumn => products.id)
      .notNull(),
    variant_id: text("variant_id").references(
      (): AnySQLiteColumn => product_variants.id,
    ),
    order_no: text("order_no").notNull(),
    ordered_at: text("ordered_at").notNull(),
    qty: integer("qty").notNull(),
    status: text("status").notNull(),
    customs_code_collected: text("customs_code_collected").notNull(),
    supplier_order_no: text("supplier_order_no"),
    tracking_no: text("tracking_no"),
    delivered_at: text("delivered_at"),
    settled_at: text("settled_at"),
    notes: text("notes"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"),
  },
  (t) => [
    index("idx_orders_channel_id").on(t.channel_id),
    index("idx_orders_product_id").on(t.product_id),
    index("idx_orders_listing_id").on(t.listing_id),
    index("idx_orders_status").on(t.status),
    check(
      "orders_status_enum",
      sql`status IN ('received','ordered','shipped_cn','in_customs','delivered','settled','cancelled','returned')`,
    ),
    check(
      "orders_customs_enum",
      sql`customs_code_collected IN ('unknown','collected','not_needed')`,
    ),
  ],
);
// Job 실행 기록. 예약 실행(cron)은 실행 코드와 함께만 존재한다(R-10).
export const job_runs = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    job_key: text("job_key").notNull(),
    started_at: text("started_at").notNull(),
    finished_at: text("finished_at"),
    status: text("status").notNull(),
    summary_json: text("summary_json"),
  },
  (t) => [
    index("idx_job_runs_key_started").on(t.job_key, t.started_at),
    check("job_runs_status_enum", sql`status IN ('running','ok','failed')`),
  ],
);
