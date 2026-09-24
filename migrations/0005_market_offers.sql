CREATE TABLE `market_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`option_desc` text NOT NULL,
	`match_kind` text NOT NULL,
	`pack_quantity` integer NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "market_offers_match" CHECK(match_kind IN ('unknown','same','similar')),
	CONSTRAINT "market_offers_quantity" CHECK(pack_quantity > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_market_offers_product` ON `market_offers` (`product_id`);