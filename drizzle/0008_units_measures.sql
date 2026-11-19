-- Hand-edited. The generated file also dropped `unit_conversion` and `ingredient.par_unit` here.
-- That would destroy the rows the startup data step (src/services/legacyUnits.ts) turns into
-- measures and a par in the stock unit, so that step drops both after it has converted them.
ALTER TABLE `ingredient` RENAME COLUMN "default_unit" TO "stock_unit";--> statement-breakpoint
CREATE TABLE `ingredient_measure` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`unit` text NOT NULL,
	`grams` real NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_measure_uq` ON `ingredient_measure` (`ingredient_id`,`unit`);--> statement-breakpoint
CREATE INDEX `ingredient_measure_household_idx` ON `ingredient_measure` (`household_id`);
