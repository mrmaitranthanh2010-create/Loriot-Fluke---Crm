CREATE TABLE `email_automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_type` text DEFAULT 'Scheduled' NOT NULL,
	`status` text DEFAULT 'Running' NOT NULL,
	`replies_added` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_email_automation_runs_started` ON `email_automation_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `email_automation_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`daily_limit` integer DEFAULT 20 NOT NULL,
	`batch_size` integer DEFAULT 2 NOT NULL,
	`send_start_hour` integer DEFAULT 8 NOT NULL,
	`send_end_hour` integer DEFAULT 17 NOT NULL,
	`weekdays_only` integer DEFAULT 1 NOT NULL,
	`auto_classify_replies` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_campaign_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`status` text DEFAULT 'Queued' NOT NULL,
	`current_step` integer DEFAULT 0 NOT NULL,
	`next_send_at` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`replied_at` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`email_message_id` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `email_campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `prospecting_leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_email_campaign_recipient_unique` ON `email_campaign_recipients` (`campaign_id`,`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_email_campaign_recipient_queue` ON `email_campaign_recipients` (`status`,`next_send_at`);--> statement-breakpoint
CREATE INDEX `idx_email_campaign_recipient_lead` ON `email_campaign_recipients` (`lead_id`);--> statement-breakpoint
CREATE TABLE `email_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`start_date` text NOT NULL,
	`subject_template` text NOT NULL,
	`body_template` text NOT NULL,
	`follow_up_enabled` integer DEFAULT 0 NOT NULL,
	`follow_up_delay_days` integer DEFAULT 4 NOT NULL,
	`follow_up_subject_template` text DEFAULT '' NOT NULL,
	`follow_up_body_template` text DEFAULT '' NOT NULL,
	`asset_ids_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_email_campaigns_status_start` ON `email_campaigns` (`status`,`start_date`);--> statement-breakpoint
ALTER TABLE `email_messages` ADD `campaign_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `classification` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `ai_summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `suggested_action` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `draft_reply` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `ai_confidence` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `ai_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_messages` ADD `ai_processed_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `prospecting_leads` ADD `email_opt_out` integer DEFAULT 0 NOT NULL;