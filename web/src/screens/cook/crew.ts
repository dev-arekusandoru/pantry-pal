import type { RecipeStepLink } from "../recipe/lib";

/**
 * Cooking as a crew: who is cooking, who owns each recipe step, and where each
 * cook is in their own slice of the steps. Pure so it can be tested and saved.
 */

export const MAX_COOKS = 4;

export interface CrewCook {
  id: string;
  name: string;
}

export interface Crew {
  /** Two to four cooks, in the order they were picked. */
  cooks: CrewCook[];
  /** Cook id per recipe step index. Always as long as the recipe's steps. */
  owners: string[];
  /** Index into that cook's own step list; the list length means done. */
  positions: Record<string, number>;
}

interface StepLike {
  groupLabel: string | null;
}

/** The slice of a recipe step the crew views need. */
export interface CookStep extends StepLike {
  id: string;
  text: string;
  durationMinutes: number | null;
  links: RecipeStepLink[];
}

export interface StepGroup {
  /** First step index in the run. */
  start: number;
  /** One past the last step index in the run. */
  end: number;
  /** Shared label; null for runs of ungrouped steps. */
  label: string | null;
}

/** Runs of consecutive steps that share a `groupLabel` (null runs included). */
export function stepGroups(steps: readonly StepLike[]): StepGroup[] {
  const groups: StepGroup[] = [];
  steps.forEach((step, index) => {
    const label = step.groupLabel;
    const last = groups[groups.length - 1];
    if (last !== undefined && last.label === label) {
      last.end = index + 1;
    } else {
      groups.push({ start: index, end: index + 1, label });
    }
  });
  return groups;
}

/**
 * First split of the work: whole groups round-robin across cooks, so a cook
 * gets the marinade or the sauce as a unit. Ungrouped recipes alternate steps
 * instead, since a single all-null "group" would put everything on one cook.
 */
export function defaultOwners(steps: readonly StepLike[], cooks: readonly Pick<CrewCook, "id">[]): string[] {
  if (cooks.length === 0) return steps.map(() => "");
  const pick = (run: number) => cooks[run % cooks.length]!.id;
  if (!steps.some((step) => step.groupLabel !== null)) return steps.map((_, index) => pick(index));

  const owners = steps.map(() => "");
  stepGroups(steps).forEach((group, run) => {
    for (let index = group.start; index < group.end; index++) owners[index] = pick(run);
  });
  return owners;
}

/** Assigns the whole group starting at `start` to one cook. */
export function assignGroup(
  owners: readonly string[],
  steps: readonly StepLike[],
  start: number,
  cookId: string,
): string[] {
  const group = stepGroups(steps).find((candidate) => candidate.start === start);
  if (group === undefined) return [...owners];
  const next = [...owners];
  for (let index = group.start; index < group.end; index++) next[index] = cookId;
  return next;
}

/** Recipe step indexes owned by a cook, in cooking order. */
export function assignedSteps(owners: readonly string[], cookId: string): number[] {
  const steps: number[] = [];
  owners.forEach((owner, index) => {
    if (owner === cookId) steps.push(index);
  });
  return steps;
}

/** Where a recipe step falls in its owner's own list (0 when it is not theirs). */
export function positionForStep(owners: readonly string[], cookId: string, stepIndex: number): number {
  return Math.max(0, assignedSteps(owners, cookId).indexOf(stepIndex));
}

/** The recipe step a cook is looking at, or undefined when they are done. */
export function cookStepAt(owners: readonly string[], cookId: string, position: number): number | undefined {
  return assignedSteps(owners, cookId)[position];
}

export function cookIsDone(crew: Crew, cookId: string): boolean {
  const total = assignedSteps(crew.owners, cookId).length;
  return (crew.positions[cookId] ?? 0) >= total;
}

/** Places a cook at one of their own steps, clamped at their start and their end. */
export function setCookPosition(crew: Crew, cookId: string, position: number): Crew {
  const total = assignedSteps(crew.owners, cookId).length;
  const next = Math.min(total, Math.max(0, position));
  return { ...crew, positions: { ...crew.positions, [cookId]: next } };
}

/** Moves a cook by one of their own steps, clamped at their start and their end. */
export function moveCook(crew: Crew, cookId: string, delta: number): Crew {
  return setCookPosition(crew, cookId, (crew.positions[cookId] ?? 0) + delta);
}

/** Jumps a cook to the position holding `stepIndex` (used by the shared timer chips). */
export function focusCookStep(crew: Crew, cookId: string, stepIndex: number): Crew {
  return setCookPosition(crew, cookId, positionForStep(crew.owners, cookId, stepIndex));
}

/** True when the cook has moved past that step in their own list. */
export function passedSteps(crew: Crew): boolean[] {
  const lists = new Map<string, number[]>();
  for (const cook of crew.cooks) lists.set(cook.id, []);
  crew.owners.forEach((owner, index) => lists.get(owner)?.push(index));

  return crew.owners.map((owner, index) => {
    const list = lists.get(owner);
    if (list === undefined) return false;
    const position = crew.positions[owner] ?? 0;
    return position > list.indexOf(index);
  });
}

export function cooksDone(crew: Crew): number {
  return crew.cooks.filter((cook) => cookIsDone(crew, cook.id)).length;
}

export function allDone(crew: Crew): boolean {
  return crew.cooks.length > 0 && crew.cooks.every((cook) => cookIsDone(crew, cook.id));
}

/**
 * The lowest step nobody has passed: where solo navigation picks up after the
 * crew is disbanded. Falls back to the last step when everything is done.
 */
export function lowestUnfinishedStep(crew: Crew, stepCount: number): number {
  if (stepCount <= 0) return 0;
  const passed = passedSteps(crew);
  const index = passed.findIndex((done) => !done);
  return index === -1 ? stepCount - 1 : index;
}

/** "Alex", "Alex & Sam", "Alex, Sam & Jo". */
export function cookNames(cooks: readonly CrewCook[]): string {
  const names = cooks.map((cook) => cook.name);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]!}`;
}
