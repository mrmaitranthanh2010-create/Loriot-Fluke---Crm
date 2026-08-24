CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`account_type` text NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT 'Sales Fluke' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`activity_date` text NOT NULL,
	`activity_type` text NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`next_step` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT 'Sales Fluke' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`full_name` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`buying_role` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`zalo` text DEFAULT '' NOT NULL,
	`preferred_channel` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`product_application` text NOT NULL,
	`need_pain` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'Target Account' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`estimated_value` integer DEFAULT 0 NOT NULL,
	`expected_close_date` text DEFAULT '' NOT NULL,
	`actual_close_date` text DEFAULT '' NOT NULL,
	`last_contact_date` text DEFAULT '' NOT NULL,
	`next_step` text DEFAULT '' NOT NULL,
	`next_step_due` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT 'Sales Fluke' NOT NULL,
	`icp_fit` integer DEFAULT 0 NOT NULL,
	`need_score` integer DEFAULT 0 NOT NULL,
	`authority_score` integer DEFAULT 0 NOT NULL,
	`budget_score` integer DEFAULT 0 NOT NULL,
	`timing_score` integer DEFAULT 0 NOT NULL,
	`engagement_score` integer DEFAULT 0 NOT NULL,
	`channel_score` integer DEFAULT 0 NOT NULL,
	`competitor` text DEFAULT '' NOT NULL,
	`lost_reason` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`stage_entered_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
