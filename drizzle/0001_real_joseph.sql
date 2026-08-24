CREATE TABLE `quotation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`quotation_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_number` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`unit` text DEFAULT 'PCS' NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`quotation_no` text NOT NULL,
	`quote_date` text NOT NULL,
	`expiration_date` text DEFAULT '' NOT NULL,
	`customer_id` text DEFAULT '' NOT NULL,
	`recipient_company` text NOT NULL,
	`recipient_address` text DEFAULT '' NOT NULL,
	`attention` text DEFAULT '' NOT NULL,
	`recipient_email` text DEFAULT '' NOT NULL,
	`shipping_method` text DEFAULT 'Air Shipment' NOT NULL,
	`shipping_terms` text DEFAULT 'DDP' NOT NULL,
	`delivery_date` text DEFAULT '2-4 Weeks' NOT NULL,
	`payment_terms` text DEFAULT '100% TT' NOT NULL,
	`currency` text DEFAULT 'VND' NOT NULL,
	`vat_rate` integer DEFAULT 8 NOT NULL,
	`prepared_by` text DEFAULT 'MAI TRẦN THÀNH (+84 964 72 72 33)' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`vat_amount` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_quotation_no_unique` ON `quotations` (`quotation_no`);--> statement-breakpoint
ALTER TABLE `opportunities` ADD `end_user_company` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `end_user_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `end_user_industry` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `end_user_contact_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `end_user_title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `end_user_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `end_user_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `end_user_notes` text DEFAULT '' NOT NULL;