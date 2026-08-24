CREATE TABLE `pricing_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`use_manual_rate` integer DEFAULT 0 NOT NULL,
	`manual_rate` real DEFAULT 0 NOT NULL,
	`buffer_percent` real DEFAULT 0 NOT NULL,
	`rounding_step` integer DEFAULT 1000 NOT NULL,
	`last_live_rate` real DEFAULT 26310 NOT NULL,
	`source_updated_at` text DEFAULT '' NOT NULL,
	`fetched_at` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
