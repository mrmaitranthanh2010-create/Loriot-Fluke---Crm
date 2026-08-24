CREATE TABLE `email_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`file_kind` text DEFAULT 'document' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_assets_object_key_unique` ON `email_assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_email_assets_created` ON `email_assets` (`created_at`);