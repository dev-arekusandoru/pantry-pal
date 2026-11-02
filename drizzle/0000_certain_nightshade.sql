CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_hash_uq` ON `api_token` (`token_hash`);--> statement-breakpoint
CREATE TABLE `cook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`meal_plan_id` text,
	`recipe_id` text NOT NULL,
	`cook_date` text NOT NULL,
	`planned_servings` real NOT NULL,
	`actual_servings` real,
	`label` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`completed_at` text,
	`rating` integer,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `cook_event_plan_idx` ON `cook_event` (`meal_plan_id`);--> statement-breakpoint
CREATE INDEX `cook_event_date_idx` ON `cook_event` (`household_id`,`cook_date`);--> statement-breakpoint
CREATE INDEX `cook_event_recipe_idx` ON `cook_event` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `dietary_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`scope` text NOT NULL,
	`ingredient_id` text,
	`recipe_id` text,
	`target_text` text,
	`severity` text NOT NULL,
	`condition_note` text,
	`reason` text,
	`member_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `household_member`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dietary_rule_household_idx` ON `dietary_rule` (`household_id`);--> statement-breakpoint
CREATE TABLE `household_member` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `household_member_household_idx` ON `household_member` (`household_id`);--> statement-breakpoint
CREATE TABLE `household` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`settings` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingredient_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`alias` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_alias_uq` ON `ingredient_alias` (`household_id`,`alias`);--> statement-breakpoint
CREATE INDEX `ingredient_alias_ingredient_idx` ON `ingredient_alias` (`ingredient_id`);--> statement-breakpoint
CREATE TABLE `ingredient` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text,
	`category` text DEFAULT 'other' NOT NULL,
	`default_unit` text,
	`default_location` text DEFAULT 'pantry' NOT NULL,
	`image_url` text,
	`shelf_life_days` integer,
	`is_staple` integer DEFAULT false NOT NULL,
	`par_qty` real,
	`par_unit` text,
	`notes` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_name_uq` ON `ingredient` (`household_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `meal_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`week_start` text NOT NULL,
	`title` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_plan_week_uq` ON `meal_plan` (`household_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `meal_slot` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`meal_plan_id` text NOT NULL,
	`date` text NOT NULL,
	`meal_type` text NOT NULL,
	`kind` text NOT NULL,
	`cook_event_id` text,
	`servings` real,
	`label` text,
	`notes` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cook_event_id`) REFERENCES `cook_event`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `meal_slot_plan_idx` ON `meal_slot` (`meal_plan_id`,`date`,`meal_type`);--> statement-breakpoint
CREATE INDEX `meal_slot_cook_idx` ON `meal_slot` (`cook_event_id`);--> statement-breakpoint
CREATE TABLE `pantry_item` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`location` text DEFAULT 'pantry' NOT NULL,
	`qty` real,
	`unit` text,
	`qty_approx` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`raw_text` text,
	`note` text,
	`purchased_on` text,
	`opened_on` text,
	`expires_on` text,
	`last_verified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_item_uq` ON `pantry_item` (`household_id`,`ingredient_id`,`location`);--> statement-breakpoint
CREATE TABLE `prep_task` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`meal_plan_id` text NOT NULL,
	`due_date` text NOT NULL,
	`description` text NOT NULL,
	`cook_event_id` text,
	`done_at` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cook_event_id`) REFERENCES `cook_event`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `prep_task_plan_idx` ON `prep_task` (`meal_plan_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `recipe_ingredient` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`qty` real,
	`qty_max` real,
	`unit` text,
	`prep_note` text,
	`original_text` text,
	`optional` integer DEFAULT false NOT NULL,
	`scaling_exempt` integer DEFAULT false NOT NULL,
	`group_label` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `recipe_ingredient_recipe_idx` ON `recipe_ingredient` (`recipe_id`,`position`);--> statement-breakpoint
CREATE INDEX `recipe_ingredient_ingredient_idx` ON `recipe_ingredient` (`ingredient_id`);--> statement-breakpoint
CREATE TABLE `recipe_status_event` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`status` text NOT NULL,
	`rating` integer,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_status_event_recipe_idx` ON `recipe_status_event` (`recipe_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `recipe_step` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer NOT NULL,
	`group_label` text,
	`text` text NOT NULL,
	`duration_minutes` integer,
	`image_url` text,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_step_recipe_idx` ON `recipe_step` (`recipe_id`,`position`);--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`source_url` text,
	`source_name` text,
	`author` text,
	`image_url` text,
	`servings` real NOT NULL,
	`yield_text` text,
	`prep_minutes` integer,
	`cook_minutes` integer,
	`total_minutes` integer,
	`spice_level` text,
	`cuisine` text,
	`meal_types` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`equipment` text DEFAULT '[]' NOT NULL,
	`nutrition` text,
	`storage_notes` text,
	`leftover_days` integer,
	`status` text DEFAULT 'want_to_try' NOT NULL,
	`rating` integer,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_slug_uq` ON `recipe` (`household_id`,`slug`);--> statement-breakpoint
CREATE INDEX `recipe_status_idx` ON `recipe` (`household_id`,`status`);--> statement-breakpoint
CREATE TABLE `shopping_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`shopping_list_id` text NOT NULL,
	`ingredient_id` text,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`qty` real,
	`unit` text,
	`purpose_note` text,
	`needs_check` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`note` text,
	`checked_at` text,
	`actual_qty` real,
	`actual_unit` text,
	`substitute_ingredient_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shopping_list_id`) REFERENCES `shopping_list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`substitute_ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_list_item_list_idx` ON `shopping_list_item` (`shopping_list_id`,`position`);--> statement-breakpoint
CREATE TABLE `shopping_list` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`meal_plan_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_list_plan_idx` ON `shopping_list` (`meal_plan_id`);--> statement-breakpoint
CREATE TABLE `stock_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`pantry_item_id` text NOT NULL,
	`kind` text NOT NULL,
	`qty` real,
	`unit` text,
	`reason` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`note` text,
	`qty_after` real,
	`status_after` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pantry_item_id`) REFERENCES `pantry_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stock_movement_item_idx` ON `stock_movement` (`pantry_item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `stock_movement_ref_idx` ON `stock_movement` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `unit_conversion` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`ingredient_id` text,
	`from_unit` text NOT NULL,
	`to_unit` text NOT NULL,
	`factor` real NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_conversion_uq` ON `unit_conversion` (`household_id`,`ingredient_id`,`from_unit`,`to_unit`);