CREATE TABLE `recipe_ingredient_alternative` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`recipe_ingredient_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_ingredient_id`) REFERENCES `recipe_ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_ingredient_alternative_uq` ON `recipe_ingredient_alternative` (`recipe_ingredient_id`,`ingredient_id`);--> statement-breakpoint
CREATE INDEX `recipe_ingredient_alternative_ingredient_idx` ON `recipe_ingredient_alternative` (`ingredient_id`);--> statement-breakpoint
ALTER TABLE `ingredient` ADD `default_portion` text;--> statement-breakpoint
ALTER TABLE `ingredient` ADD `needs_review` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `ingredient` SET `needs_review` = 1 WHERE `nutrition_fdc_id` IS NULL;