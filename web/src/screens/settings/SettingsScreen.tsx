import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Label, RadioGroup, Separator } from "radix-ui";
import { useTheme, type ThemePreference } from "@/app/theme";
import { Button, Card, ErrorState, PageHeader, Skeleton, Stepper, cx } from "@/ui";
import styles from "./Settings.module.css";
import { useHousehold, useServerVersion, useUpdateHousehold, type HouseholdSettings } from "./queries";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match device" },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string }>;

function isThemePreference(value: string): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.value === value);
}

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 24;

type ServingsKey = "defaultServings" | "dinnerServings" | "lunchBatchServings";

const SERVINGS_FIELDS: ReadonlyArray<{ key: ServingsKey; label: string; hint: string }> = [
  { key: "defaultServings", label: "Default servings", hint: "Used when a recipe is planned without an amount." },
  { key: "dinnerServings", label: "Dinner servings", hint: "How much a dinner cook makes, so there are leftovers." },
  { key: "lunchBatchServings", label: "Lunch batch servings", hint: "How much a batch-cooked lunch makes." },
];

export function SettingsScreen() {
  const household = useHousehold();
  const update = useUpdateHousehold();
  const { theme, setTheme } = useTheme();
  const version = useServerVersion();
  const status = useSaveStatus(update.isPending, update.isSuccess, update.submittedAt);
  // One-way latch: did this screen ever show its skeleton? Sections fade in only
  // when they replace it; a first paint that already has data is left to the
  // route transition, so the two never fade the same frame.
  const sawLoading = useRef(false);
  if (household.isPending) sawLoading.current = true;

  if (household.isPending) {
    return (
      <>
        <PageHeader title="Settings" />
        <div className={styles.stack} aria-busy="true" aria-label="Loading settings">
          <Skeleton height={110} radius={28} />
          <Skeleton height={130} radius={28} />
          <Skeleton height={300} radius={28} />
        </div>
      </>
    );
  }

  if (household.isError) {
    return (
      <>
        <PageHeader title="Settings" />
        <ErrorState error={household.error} onRetry={() => void household.refetch()} />
      </>
    );
  }

  const { name, settings } = household.data;

  return (
    <>
      <PageHeader title="Settings" sub={name} />
      <p className={cx(styles.status, status === "saved" && styles.saved)} role="status" aria-live="polite">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
      </p>
      <div className={cx(styles.stack, sawLoading.current && styles.stackIn)}>
        <Card as="section" aria-labelledby="settings-look" className={styles.section}>
          <h2 id="settings-look" className={styles.heading}>
            Look
          </h2>
          <RadioGroup.Root
            className={styles.themeOptions}
            aria-label="Theme"
            orientation="horizontal"
            value={theme}
            onValueChange={(value) => {
              if (isThemePreference(value)) setTheme(value);
            }}
          >
            {THEME_OPTIONS.map((option) => (
              <RadioGroup.Item key={option.value} value={option.value} className={styles.themeOption}>
                {option.label}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          <p className={styles.hint}>Saved on this device only.</p>
        </Card>

        <Card as="section" aria-labelledby="settings-household" className={styles.section}>
          <h2 id="settings-household" className={styles.heading}>
            Household
          </h2>
          <NameForm key={name} name={name} saving={update.isPending} onSave={(next) => update.mutate({ name: next })} />
        </Card>

        <Card as="section" aria-labelledby="settings-servings" className={styles.section}>
          <h2 id="settings-servings" className={styles.heading}>
            Servings
          </h2>
          <div className={styles.rows} role="list">
            {SERVINGS_FIELDS.map(({ key, label, hint }, index) => (
              <Fragment key={key}>
                {index > 0 && <Separator.Root decorative className={styles.sep} />}
                <ServingsRow
                  label={label}
                  hint={hint}
                  value={settings[key]}
                  onChange={(next) => update.mutate({ settings: { [key]: next } satisfies Partial<HouseholdSettings> })}
                />
              </Fragment>
            ))}
          </div>
        </Card>

        <p className={styles.about}>
          PantryPal{version.data ? ` v${version.data}` : ""}
          <br />
          Self-hosted. Your pantry stays on your own server.
          <br />
          Food icons by{" "}
          <a href="https://openmoji.org" target="_blank" rel="noreferrer">
            OpenMoji
          </a>{" "}
          (CC BY-SA 4.0). UI icons by{" "}
          <a href="https://phosphoricons.com" target="_blank" rel="noreferrer">
            Phosphor
          </a>{" "}
          (MIT).
        </p>
      </div>
    </>
  );
}

function NameForm({ name, saving, onSave }: { name: string; saving: boolean; onSave: (name: string) => void }) {
  const inputId = useId();
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();
  const dirty = trimmed !== name && trimmed !== "";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (dirty) onSave(trimmed);
  }

  return (
    <form className={styles.nameForm} onSubmit={submit}>
      <div className={styles.field}>
        <Label.Root className={styles.label} htmlFor={inputId}>
          Household name
        </Label.Root>
        <input
          id={inputId}
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={80}
        />
      </div>
      <Button type="submit" variant="primary" disabled={!dirty} loading={saving}>
        Save
      </Button>
    </form>
  );
}

interface ServingsRowProps {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
}

function ServingsRow({ label, hint, value, onChange }: ServingsRowProps) {
  return (
    <div role="listitem" className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.label}>{label}</span>
        <span className={styles.hint}>{hint}</span>
      </div>
      <Stepper
        label={label}
        value={value}
        onDecrement={() => onChange(Math.max(MIN_SERVINGS, value - 1))}
        onIncrement={() => onChange(Math.min(MAX_SERVINGS, value + 1))}
        disableDecrement={value <= MIN_SERVINGS}
        disableIncrement={value >= MAX_SERVINGS}
      />
    </div>
  );
}

type SaveStatus = "idle" | "saving" | "saved";

/** "Saving…" while a patch is in flight, "Saved" for a couple of seconds after the last one lands. */
function useSaveStatus(pending: boolean, success: boolean, submittedAt: number): SaveStatus {
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (!success || pending) {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(t);
  }, [success, pending, submittedAt]);
  return pending ? "saving" : showSaved ? "saved" : "idle";
}
