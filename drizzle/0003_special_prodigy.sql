CREATE TABLE `recipe_step_ingredient` (
	`id` text PRIMARY KEY NOT NULL,
	`step_id` text NOT NULL,
	`recipe_ingredient_id` text NOT NULL,
	`qty` real,
	`position` integer NOT NULL,
	FOREIGN KEY (`step_id`) REFERENCES `recipe_step`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_ingredient_id`) REFERENCES `recipe_ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_step_ingredient_step_idx` ON `recipe_step_ingredient` (`step_id`,`position`);