CREATE TABLE IF NOT EXISTS `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text DEFAULT '' NOT NULL,
	`material_code` text NOT NULL,
	`item_no` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT 'Bộ' NOT NULL,
	`quantity` real DEFAULT 0 NOT NULL,
	`report_date` text DEFAULT '' NOT NULL,
	`source_file` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inventory_items_material_code_unique` ON `inventory_items` (`material_code`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_inventory_item_no` ON `inventory_items` (`item_no`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_inventory_product` ON `inventory_items` (`product_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `weekly_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`report_date` text NOT NULL,
	`week_number` integer NOT NULL,
	`reporter` text DEFAULT 'Mai Trần Thành' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`source_file` text DEFAULT '' NOT NULL,
	`plan_json` text DEFAULT '[]' NOT NULL,
	`projects_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `weekly_reports_week_start_unique` ON `weekly_reports` (`week_start`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_weekly_reports_week` ON `weekly_reports` (`week_start`);--> statement-breakpoint
ALTER TABLE `quotation_items` ADD `application` text DEFAULT '' NOT NULL;
