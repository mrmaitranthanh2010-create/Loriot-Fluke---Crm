CREATE TABLE IF NOT EXISTS `email_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`direction` text NOT NULL,
	`sender_email` text DEFAULT '' NOT NULL,
	`recipient_email` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body_text` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Queued' NOT NULL,
	`provider_message_id` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`received_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `prospecting_leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_email_messages_lead_created` ON `email_messages` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_email_messages_provider_id` ON `email_messages` (`provider_message_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text DEFAULT 'Mai Trần Thành' NOT NULL,
	`username` text NOT NULL,
	`smtp_host` text DEFAULT 'pro43.emailserver.vn' NOT NULL,
	`smtp_port` integer DEFAULT 465 NOT NULL,
	`smtp_security` text DEFAULT 'ssl' NOT NULL,
	`imap_host` text DEFAULT 'pro43.emailserver.vn' NOT NULL,
	`imap_port` integer DEFAULT 993 NOT NULL,
	`password_ciphertext` text DEFAULT '' NOT NULL,
	`password_iv` text DEFAULT '' NOT NULL,
	`default_subject` text DEFAULT '' NOT NULL,
	`default_body` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `prospecting_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`account_type` text DEFAULT 'End-User' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`last_email_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Chưa gửi' NOT NULL,
	`next_follow_up_date` text DEFAULT '' NOT NULL,
	`email_subject` text DEFAULT '' NOT NULL,
	`reply_notes` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`owner` text DEFAULT 'Mai Trần Thành' NOT NULL,
	`converted_opportunity_id` text DEFAULT '' NOT NULL,
	`converted_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_prospecting_leads_status` ON `prospecting_leads` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_prospecting_leads_follow_up` ON `prospecting_leads` (`next_follow_up_date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_prospecting_leads_email` ON `prospecting_leads` (`email`);
