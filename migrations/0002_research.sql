CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text,
	`account_ref` text,
	`policies` text,
	`integration_state` text,
	`connector_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "channels_type_enum" CHECK(type IN ('smartstore','coupang','cafe24','other')),
	CONSTRAINT "channels_integration_state_enum" CHECK(integration_state IN ('none','file','api','error'))
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name_ko` text NOT NULL,
	`name_en` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `compliance_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`character_id` text NOT NULL,
	`category` text,
	`model_scope` text,
	`gate_result` text,
	`gate_reason` text,
	`gate_set_by` text,
	`reviewed_at` text,
	`recheck_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "compliance_profiles_category_enum" CHECK(category IN ('plush','plush_keyring','acrylic','stationery','other')),
	CONSTRAINT "compliance_profiles_model_scope_enum" CHECK(model_scope IN ('purchase_agency','import_resale','both')),
	CONSTRAINT "compliance_profiles_gate_result_enum" CHECK(gate_result IN ('unknown','pass','conditional','fail')),
	CONSTRAINT "compliance_profiles_gate_set_by_enum" CHECK(gate_set_by IN ('derived','manual'))
);
--> statement-breakpoint
CREATE INDEX `idx_compliance_profiles_character_id` ON `compliance_profiles` (`character_id`);--> statement-breakpoint
CREATE TABLE `costings` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`offer_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`channel_id` text,
	`qty_assumption` integer,
	`items_per_order` integer,
	`fx_rate_id` text,
	`inputs_frozen` text,
	`lines` text,
	`outputs` text,
	`overall_status` text,
	`unknown_keys` text,
	`is_current` integer,
	`decision_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scenario_id`) REFERENCES `shipping_scenarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fx_rate_id`) REFERENCES `fx_rates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "costings_overall_status_enum" CHECK(overall_status IN ('unknown','estimated','confirmed'))
);
--> statement-breakpoint
CREATE INDEX `idx_costings_product_id` ON `costings` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_costings_offer_id` ON `costings` (`offer_id`);--> statement-breakpoint
CREATE INDEX `idx_costings_scenario_id` ON `costings` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `idx_costings_channel_id` ON `costings` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_costings_fx_rate_id` ON `costings` (`fx_rate_id`);--> statement-breakpoint
CREATE INDEX `idx_costings_decision_id` ON `costings` (`decision_id`);--> statement-breakpoint
CREATE TABLE `forwarders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`warehouse_address` text,
	`currency` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "forwarders_currency_enum" CHECK(currency IN ('CNY','KRW','USD','TWD'))
);
--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`variant_id` text,
	`url` text,
	`option_desc` text,
	`option_kind` text,
	`set_composition` text,
	`random_rule` text,
	`quantity_tier_min` integer,
	`quantity_tier_max` integer,
	`moq` integer,
	`currency` text,
	`includes_shipping_to` text,
	`authenticity_evidence` text,
	`status` text,
	`rejection_reason` text,
	`decision_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "offers_option_kind_enum" CHECK(option_kind IN ('unknown','single','set','random','designated')),
	CONSTRAINT "offers_currency_enum" CHECK(currency IN ('CNY','TWD','KRW','USD','JPY')),
	CONSTRAINT "offers_includes_shipping_to_enum" CHECK(includes_shipping_to IN ('unknown','none','cn_domestic','kr')),
	CONSTRAINT "offers_authenticity_evidence_enum" CHECK(authenticity_evidence IN ('unknown','official_license_mark','authorization_doc','seller_claim','none')),
	CONSTRAINT "offers_status_enum" CHECK(status IN ('candidate','verified','rejected','chosen'))
);
--> statement-breakpoint
CREATE INDEX `idx_offers_product_id` ON `offers` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_offers_supplier_id` ON `offers` (`supplier_id`);--> statement-breakpoint
CREATE INDEX `idx_offers_variant_id` ON `offers` (`variant_id`);--> statement-breakpoint
CREATE INDEX `idx_offers_decision_id` ON `offers` (`decision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chosen_offer` ON `offers` (`product_id`) WHERE status='chosen' AND deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`option_kind` text,
	`random_pool_desc` text,
	`sku_internal` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_variants_option_kind_enum" CHECK(option_kind IN ('designated','random'))
);
--> statement-breakpoint
CREATE INDEX `idx_product_variants_product_id` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`character_id` text,
	`profile_id` text,
	`category` text,
	`option_scheme` text,
	`status` text,
	`status_reason` text,
	`stage_entered_at` text,
	`hold_recheck_at` text,
	`chosen_offer_id` text,
	`chosen_scenario_id` text,
	`current_costing_id` text,
	`pricing_decision_id` text,
	`competitor_refs` text,
	`images` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `compliance_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chosen_offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chosen_scenario_id`) REFERENCES `shipping_scenarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_costing_id`) REFERENCES `costings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pricing_decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "products_category_enum" CHECK(category IN ('plush','plush_keyring','acrylic','stationery','other')),
	CONSTRAINT "products_option_scheme_enum" CHECK(option_scheme IN ('designated','random','set')),
	CONSTRAINT "products_status_enum" CHECK(status IN ('discovered','researching','costing','pricing','listing_ready','live','paused','discontinued','rejected','on_hold'))
);
--> statement-breakpoint
CREATE INDEX `idx_products_character_id` ON `products` (`character_id`);--> statement-breakpoint
CREATE INDEX `idx_products_profile_id` ON `products` (`profile_id`);--> statement-breakpoint
CREATE INDEX `idx_products_chosen_offer_id` ON `products` (`chosen_offer_id`);--> statement-breakpoint
CREATE INDEX `idx_products_chosen_scenario_id` ON `products` (`chosen_scenario_id`);--> statement-breakpoint
CREATE INDEX `idx_products_current_costing_id` ON `products` (`current_costing_id`);--> statement-breakpoint
CREATE INDEX `idx_products_pricing_decision_id` ON `products` (`pricing_decision_id`);--> statement-breakpoint
CREATE TABLE `rate_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`forwarder_id` text NOT NULL,
	`name` text NOT NULL,
	`effective_from` text,
	`weight_bands` text,
	`volumetric_rule` text,
	`attachment_ids` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`forwarder_id`) REFERENCES `forwarders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_rate_cards_forwarder_id` ON `rate_cards` (`forwarder_id`);--> statement-breakpoint
CREATE TABLE `readiness_items` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`category` text,
	`status` text,
	`depends_on` text,
	`evidence` text,
	`due_at` text,
	`recheck_at` text,
	`notes` text,
	`blocks` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "readiness_items_category_enum" CHECK(category IN ('decision','legal','tax','customs','channel','finance','logistics','policy','ops')),
	CONSTRAINT "readiness_items_status_enum" CHECK(status IN ('not_started','in_progress','blocked','done','not_applicable'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_readiness_key` ON `readiness_items` (`key`);--> statement-breakpoint
CREATE TABLE `requirement_items` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`key` text,
	`question` text NOT NULL,
	`risk_level` text,
	`item_result` text,
	`condition_text` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`profile_id`) REFERENCES `compliance_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "requirement_items_key_enum" CHECK(key IN ('children_product','kc','trademark_license','parallel_import','copyright_import','design_right','customs_ip_watch','platform_ip_report','listing_assets','customs','labeling','channel_policy','return_policy')),
	CONSTRAINT "requirement_items_risk_level_enum" CHECK(risk_level IN ('low','medium','high')),
	CONSTRAINT "requirement_items_item_result_enum" CHECK(item_result IN ('unknown','pass','conditional','fail'))
);
--> statement-breakpoint
CREATE INDEX `idx_requirement_items_profile_id` ON `requirement_items` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_requirement_profile_key` ON `requirement_items` (`profile_id`,`key`);--> statement-breakpoint
CREATE TABLE `shipping_legs` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`seq` integer NOT NULL,
	`from_node` text,
	`to_node` text,
	`carrier_or_service` text,
	`cost_code` text,
	`basis` text,
	`includes` text,
	`rate_card_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`scenario_id`) REFERENCES `shipping_scenarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rate_card_id`) REFERENCES `rate_cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shipping_legs_from_node_enum" CHECK(from_node IN ('seller','forwarder_cn','kr_customs','customer_kr')),
	CONSTRAINT "shipping_legs_to_node_enum" CHECK(to_node IN ('forwarder_cn','kr_customs','customer_kr')),
	CONSTRAINT "shipping_legs_cost_code_enum" CHECK(cost_code IN ('cn_domestic_shipping','intl_shipping','kr_domestic_shipping','forwarder_fee')),
	CONSTRAINT "shipping_legs_basis_enum" CHECK(basis IN ('per_parcel','per_kg','per_item','per_order'))
);
--> statement-breakpoint
CREATE INDEX `idx_shipping_legs_scenario_id` ON `shipping_legs` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `idx_shipping_legs_rate_card_id` ON `shipping_legs` (`rate_card_id`);--> statement-breakpoint
CREATE TABLE `shipping_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`offer_id` text,
	`name` text NOT NULL,
	`route_type` text,
	`customs_mode` text,
	`warnings` text,
	`is_default` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shipping_scenarios_route_type_enum" CHECK(route_type IN ('direct','forwarder')),
	CONSTRAINT "shipping_scenarios_customs_mode_enum" CHECK(customs_mode IN ('unknown','list_clearance','general'))
);
--> statement-breakpoint
CREATE INDEX `idx_shipping_scenarios_product_id` ON `shipping_scenarios` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_shipping_scenarios_offer_id` ON `shipping_scenarios` (`offer_id`);--> statement-breakpoint
CREATE TABLE `supplier_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`at` text NOT NULL,
	`direction` text,
	`summary` text,
	`attachment_ids` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_messages_direction_enum" CHECK(direction IN ('in','out'))
);
--> statement-breakpoint
CREATE INDEX `idx_supplier_messages_supplier_id` ON `supplier_messages` (`supplier_id`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_local` text,
	`platform` text,
	`seller_type` text,
	`store_url` text,
	`country` text,
	`contact_channels` text,
	`payment_methods` text,
	`trust_notes` text,
	`last_contact_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	CONSTRAINT "suppliers_platform_enum" CHECK(platform IN ('taobao','tmall','1688','ruten','other')),
	CONSTRAINT "suppliers_seller_type_enum" CHECK(seller_type IN ('unknown','brand_flagship','authorized','general'))
);
