DROP TABLE IF EXISTS temp._pantry_merge;--> statement-breakpoint
CREATE TEMP TABLE _pantry_merge AS
SELECT
	k.household_id,
	k.ingredient_id,
	k.id AS keep_id,
	(SELECT COUNT(*) FROM pantry_item q
		WHERE q.household_id = k.household_id AND q.ingredient_id = k.ingredient_id) AS n,
	(SELECT COUNT(*) FROM pantry_item q
		WHERE q.household_id = k.household_id AND q.ingredient_id = k.ingredient_id
			AND q.unit IS k.unit) AS same_unit,
	(SELECT COUNT(*) FROM pantry_item q
		WHERE q.household_id = k.household_id AND q.ingredient_id = k.ingredient_id
			AND q.qty IS NULL) AS null_qty,
	(SELECT SUM(q.qty) FROM pantry_item q
		WHERE q.household_id = k.household_id AND q.ingredient_id = k.ingredient_id) AS qty_sum
FROM (
	SELECT id, household_id, ingredient_id, unit,
		ROW_NUMBER() OVER (
			PARTITION BY household_id, ingredient_id
			ORDER BY (last_verified_at IS NULL), last_verified_at DESC, updated_at DESC, id
		) AS rn
	FROM pantry_item
) k
WHERE k.rn = 1;--> statement-breakpoint
UPDATE stock_movement
SET pantry_item_id = (
	SELECT m.keep_id FROM _pantry_merge m
	JOIN pantry_item q ON q.id = stock_movement.pantry_item_id
	WHERE m.household_id = q.household_id AND m.ingredient_id = q.ingredient_id
)
WHERE pantry_item_id IN (
	SELECT p.id FROM pantry_item p
	JOIN _pantry_merge m ON m.household_id = p.household_id AND m.ingredient_id = p.ingredient_id
	WHERE p.id <> m.keep_id
);--> statement-breakpoint
UPDATE pantry_item
SET qty = (
		SELECT CASE WHEN m.n = m.same_unit AND m.null_qty = 0 THEN m.qty_sum ELSE pantry_item.qty END
		FROM _pantry_merge m WHERE m.keep_id = pantry_item.id
	),
	qty_approx = (
		SELECT MAX(q.qty_approx) FROM pantry_item q
		WHERE q.household_id = pantry_item.household_id AND q.ingredient_id = pantry_item.ingredient_id
	),
	note = (
		SELECT MAX(q.note) FROM pantry_item q
		WHERE q.household_id = pantry_item.household_id AND q.ingredient_id = pantry_item.ingredient_id
	),
	raw_text = (
		SELECT MAX(q.raw_text) FROM pantry_item q
		WHERE q.household_id = pantry_item.household_id AND q.ingredient_id = pantry_item.ingredient_id
	),
	purchased_on = (
		SELECT MAX(q.purchased_on) FROM pantry_item q
		WHERE q.household_id = pantry_item.household_id AND q.ingredient_id = pantry_item.ingredient_id
	),
	opened_on = (
		SELECT MAX(q.opened_on) FROM pantry_item q
		WHERE q.household_id = pantry_item.household_id AND q.ingredient_id = pantry_item.ingredient_id
	),
	expires_on = (
		SELECT MAX(q.expires_on) FROM pantry_item q
		WHERE q.household_id = pantry_item.household_id AND q.ingredient_id = pantry_item.ingredient_id
	),
	last_verified_at = (
		SELECT MAX(q.last_verified_at) FROM pantry_item q
		WHERE q.household_id = pantry_item.household_id AND q.ingredient_id = pantry_item.ingredient_id
	),
	updated_at = (
		SELECT MAX(q.updated_at) FROM pantry_item q
		WHERE q.household_id = pantry_item.household_id AND q.ingredient_id = pantry_item.ingredient_id
	)
WHERE id IN (SELECT keep_id FROM _pantry_merge WHERE n > 1);--> statement-breakpoint
DELETE FROM pantry_item WHERE id NOT IN (SELECT keep_id FROM _pantry_merge);--> statement-breakpoint
DROP TABLE _pantry_merge;--> statement-breakpoint
DROP INDEX `pantry_item_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_item_uq` ON `pantry_item` (`household_id`,`ingredient_id`);--> statement-breakpoint
ALTER TABLE `pantry_item` DROP COLUMN `location`;--> statement-breakpoint
ALTER TABLE `ingredient` DROP COLUMN `default_location`;
