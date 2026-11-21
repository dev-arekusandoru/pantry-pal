CREATE TABLE `billing_event` (
	`id` text PRIMARY KEY NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_token` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_token_hash_uq` ON `email_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_token_account_idx` ON `email_token` (`account_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `household_billing` (
	`household_id` text PRIMARY KEY NOT NULL,
	`polar_customer_id` text,
	`exempt` integer DEFAULT false NOT NULL,
	`locked_at` text,
	`warned_day23_at` text,
	`warned_day29_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`status` text NOT NULL,
	`interval` text,
	`current_period_end` text,
	`trial_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`ends_at` text,
	`polar_modified_at` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscription_household_idx` ON `subscription` (`household_id`);--> statement-breakpoint
ALTER TABLE `account` ADD `email_verified_at` text;
--> statement-breakpoint
-- Accounts that existed before email verification shipped are grandfathered as verified.
UPDATE `account` SET `email_verified_at` = `created_at`;
