CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`product_id` text NOT NULL,
	`variant_id` text,
	`external_id` text,
	`url` text,
	`listed_price` text,
	`customer_shipping_fee` text,
	`disclosures` text,
	`assets_source` text,
	`status` text,
	`last_verified_at` text,
	`costing_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`costing_id`) REFERENCES `costings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "listings_assets_source_enum" CHECK(assets_source IN ('unknown','own_photo','licensed','seller_provided_with_permission')),
	CONSTRAINT "listings_status_enum" CHECK(status IN ('draft','live','paused','ended'))
);
--> statement-breakpoint
CREATE INDEX `idx_listings_channel_id` ON `listings` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_listings_product_id` ON `listings` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_listings_costing_id` ON `listings` (`costing_id`);