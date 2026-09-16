CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT "activity_log_check_0" CHECK(action IN ('create','update','transition','delete','restore','import','job'))
);
--> statement-breakpoint
CREATE INDEX `idx_activity_actor` ON `activity_log` (`actor`,`at`);--> statement-breakpoint
CREATE INDEX `idx_activity_entity` ON `activity_log` (`entity_type`,`entity_id`,`at`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`purpose` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`captured_at` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "attachments_check_0" CHECK(purpose IN ('evidence','screenshot','invoice','receipt','label','document','other'))
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_owner` ON `attachments` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_attachments_r2_key` ON `attachments` (`r2_key`);--> statement-breakpoint
CREATE TABLE `claim_attachments` (
	`claim_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	PRIMARY KEY(`claim_id`, `attachment_id`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`field_key` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`value_json` text,
	`source_type` text,
	`source_ref` text,
	`checked_at` text,
	`recheck_by` text NOT NULL,
	`note` text,
	`basis_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "claims_check_0" CHECK(kind IN ('money','percent','number','bool','text','enum','range','days')),
	CONSTRAINT "claims_check_1" CHECK(status IN ('confirmed','estimated','unknown')),
	CONSTRAINT "claims_check_2" CHECK(source_type IN ('url','screenshot','message','call','document','competitor_observation','self_estimate','api'))
);
--> statement-breakpoint
CREATE INDEX `idx_claims_recheck` ON `claims` (`recheck_by`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_claims_owner_type_owner_id_field_key` ON `claims` (`owner_type`,`owner_id`,`field_key`);--> statement-breakpoint
CREATE TABLE `cost_line_types` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`direction` text NOT NULL,
	`stage` text NOT NULL,
	`payer_default` text NOT NULL,
	`basis` text NOT NULL,
	`is_system` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cost_line_types_check_0" CHECK(direction IN ('income','expense')),
	CONSTRAINT "cost_line_types_check_1" CHECK(stage IN ('sale','purchase','transport','customs','channel','other')),
	CONSTRAINT "cost_line_types_check_2" CHECK(payer_default IN ('me','customer','supplier','by_model')),
	CONSTRAINT "cost_line_types_check_3" CHECK(basis IN ('per_item','per_order','per_parcel','per_kg','per_purchase','percent_of_price','per_month'))
);
--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text,
	`title` text NOT NULL,
	`context` text,
	`decision` text NOT NULL,
	`rationale` text NOT NULL,
	`alternatives_json` text DEFAULT '[]' NOT NULL,
	`consequences` text,
	`status` text NOT NULL,
	`decided_at` text,
	`revisit_when` text,
	`revisit_at` text,
	`superseded_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`superseded_by`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decisions_check_0" CHECK(status IN ('proposed','accepted','superseded','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_decisions_code` ON `decisions` (`code`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text DEFAULT 'KRW' NOT NULL,
	`rate` text NOT NULL,
	`as_of_date` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	CONSTRAINT "fx_rates_check_0" CHECK(kind IN ('reference','card_actual','manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_rates_base_currency_quote_currency_as_of_date_kind_source` ON `fx_rates` (`base_currency`,`quote_currency`,`as_of_date`,`kind`,`source`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`mapping_json` text NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_ok` integer DEFAULT 0 NOT NULL,
	`rows_failed` integer DEFAULT 0 NOT NULL,
	`results_json` text DEFAULT '[]' NOT NULL,
	`applied` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "import_batches_check_0" CHECK(kind IN ('orders','settlement','tracking','excel_research'))
);
--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`relation` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "links_check_0" CHECK(relation IN ('related','evidence_for','decided_by','supersedes','derived_from','blocks'))
);
--> statement-breakpoint
CREATE INDEX `idx_links_to` ON `links` (`to_type`,`to_id`);--> statement-breakpoint
CREATE INDEX `idx_links_from` ON `links` (`from_type`,`from_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body_md` text DEFAULT '' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "notes_check_0" CHECK(type IN ('concept','research','competitor_observation','meeting','journal'))
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sops` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`inputs` text,
	`outputs` text,
	`failure_handling` text,
	`automation_state` text DEFAULT 'none' NOT NULL,
	`job_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "sops_check_0" CHECK(automation_state IN ('none','file','api'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sops_key` ON `sops` (`key`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`entity_type` text,
	`entity_id` text,
	`source` text NOT NULL,
	`rule_key` text,
	`status` text NOT NULL,
	`priority` integer NOT NULL,
	`due_at` text,
	`completed_at` text,
	`blocked_kind` text,
	`blocked_reason` text,
	`unblock_condition` text,
	`recheck_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "tasks_check_0" CHECK(source IN ('manual','derived')),
	CONSTRAINT "tasks_check_1" CHECK(status IN ('todo','doing','blocked','done','cancelled')),
	CONSTRAINT "tasks_check_2" CHECK(priority BETWEEN 1 AND 4),
	CONSTRAINT "tasks_check_3" CHECK(blocked_kind IN ('external','decision','internal')),
	CONSTRAINT "tasks_check_4" CHECK(status <> 'blocked' OR (blocked_reason IS NOT NULL AND unblock_condition IS NOT NULL AND recheck_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tasks_derived_open` ON `tasks` (`rule_key`,`entity_type`,`entity_id`) WHERE source = 'derived' AND status NOT IN ('done','cancelled') AND deleted_at IS NULL;