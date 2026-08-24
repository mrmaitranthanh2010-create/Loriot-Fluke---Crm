CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`product_family` text DEFAULT '' NOT NULL,
	`model_group` text DEFAULT '' NOT NULL,
	`market_model` text DEFAULT '' NOT NULL,
	`model` text NOT NULL,
	`normalized_model` text NOT NULL,
	`item_no` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`country_of_origin` text DEFAULT '' NOT NULL,
	`list_price_usd` real DEFAULT 0 NOT NULL,
	`list_price_vnd` integer DEFAULT 0 NOT NULL,
	`item_status` text DEFAULT 'ACTIVE' NOT NULL,
	`gross_weight` text DEFAULT '' NOT NULL,
	`uom` text DEFAULT 'EA' NOT NULL,
	`warranty_text` text DEFAULT '12 tháng' NOT NULL,
	`high_touch` integer DEFAULT 0 NOT NULL,
	`price_source` text DEFAULT '' NOT NULL,
	`high_touch_source` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_item_no_unique` ON `products` (`item_no`);--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `product_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `list_price` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `discount_percent` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `origin` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `warranty` text DEFAULT '12 tháng' NOT NULL;