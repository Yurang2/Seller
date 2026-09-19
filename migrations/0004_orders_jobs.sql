CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_key` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`summary_json` text,
	CONSTRAINT "job_runs_status_enum" CHECK(status IN ('running','ok','failed'))
);
--> statement-breakpoint
CREATE INDEX `idx_job_runs_key_started` ON `job_runs` (`job_key`,`started_at`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`listing_id` text,
	`product_id` text NOT NULL,
	`variant_id` text,
	`order_no` text NOT NULL,
	`ordered_at` text NOT NULL,
	`qty` integer NOT NULL,
	`status` text NOT NULL,
	`customs_code_collected` text NOT NULL,
	`supplier_order_no` text,
	`tracking_no` text,
	`delivered_at` text,
	`settled_at` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_status_enum" CHECK(status IN ('received','ordered','shipped_cn','in_customs','delivered','settled','cancelled','returned')),
	CONSTRAINT "orders_customs_enum" CHECK(customs_code_collected IN ('unknown','collected','not_needed'))
);
--> statement-breakpoint
CREATE INDEX `idx_orders_channel_id` ON `orders` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_product_id` ON `orders` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_listing_id` ON `orders` (`listing_id`);--> statement-breakpoint
CREATE INDEX `idx_orders_status` ON `orders` (`status`);