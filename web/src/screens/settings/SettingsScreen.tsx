import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Label, Separator } from "radix-ui";
import { errorMessage } from "@/api";
import { useTheme, type ThemePreference } from "@/app/theme";
import { LogoutButton } from "@/app/BrowserSession";
import {
  Button,
  Card,
  ErrorState,
  Icon,
  IconButton,
  PageHeader,
  SegmentedControl,
  Sheet,
  Skeleton,
  Stepper,
  cx,
  toast,
  type SegmentOption,
} from "@/ui";
import styles from "./Settings.module.css";
import {
  useCreateMember,
  useDeleteMember,
  useHousehold,
  useMembers,
  useRenameMember,
  useServerVersion,
  useUpdateHousehold,
  type HouseholdMember,
  type HouseholdSettings,
} from "./queries";

const THEME_OPTIONS: ReadonlyArray<SegmentOption<ThemePreference>> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match device" },
];

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
          <SegmentedControl
            label="Theme"
            className={styles.themeOptions}
            options={THEME_OPTIONS}
            value={theme}
            onChange={(value) => {
              if (isThemePreference(value)) setTheme(value);
            }}
          />
          <p className={styles.hint}>Saved on this device only.</p>
        </Card>

        <Card as="section" aria-labelledby="settings-household" className={styles.section}>
          <h2 id="settings-household" className={styles.heading}>
            Household
          </h2>
          <NameForm key={name} name={name} saving={update.isPending} onSave={(next) => update.mutate({ name: next })} />
        </Card>

        <Card as="section" aria-labelledby="settings-people" className={styles.section}>
          <h2 id="settings-people" className={styles.heading}>
            People
          </h2>
          <PeopleSection />
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

        <LogoutButton />

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

function PeopleSection() {
  const members = useMembers();
  const create = useCreateMember();
  const remove = useDeleteMember();
  const [pending, setPending] = useState<HouseholdMember | null>(null);

  return (
    <>
      <p className={cx(styles.hint, styles.sectionHint)}>Pick these people as cooks in cook mode to split a recipe's steps.</p>

      {members.isPending ? (
        <div className={styles.rows} aria-busy="true" aria-label="Loading people">
          <Skeleton height={44} radius={999} />
        </div>
      ) : members.isError ? (
        <p className={cx(styles.hint, styles.error)} role="alert">
          {errorMessage(members.error)}
        </p>
      ) : members.data.length === 0 ? (
        <p className={styles.hint}>No people yet. Add everyone who cooks here.</p>
      ) : (
        <div className={styles.rows} role="list">
          {members.data.map((member, index) => (
            <Fragment key={member.id}>
              {index > 0 && <Separator.Root decorative className={styles.sep} />}
              <MemberRow member={member} onRemove={() => setPending(member)} />
            </Fragment>
          ))}
        </div>
      )}

      <AddPersonForm
        adding={create.isPending}
        onAdd={(name) => create.mutate(name, { onError: (error) => toast.error(errorMessage(error)) })}
      />

      <Sheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Remove ${pending?.name ?? ""}?`}
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={remove.isPending}
              onClick={() => {
                if (!pending) return;
                remove.mutate(pending.id, {
                  onError: (error) => toast.error(errorMessage(error)),
                  onSettled: () => setPending(null),
                });
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p>Dietary rules for {pending?.name ?? ""} are removed too.</p>
      </Sheet>
    </>
  );
}

interface MemberRowProps {
  member: HouseholdMember;
  onRemove: () => void;
}

function MemberRow({ member, onRemove }: MemberRowProps) {
  const rename = useRenameMember();
  const [draft, setDraft] = useState(member.name);
  // Follow server renames (e.g. from another device) without clobbering a draft
  // this row did not produce.
  const [serverName, setServerName] = useState(member.name);
  if (member.name !== serverName) {
    setServerName(member.name);
    setDraft(member.name);
  }
  const trimmed = draft.trim();
  const dirty = trimmed !== "" && trimmed !== member.name;

  function commit() {
    if (!dirty) {
      setDraft(member.name);
      return;
    }
    rename.mutate(
      { id: member.id, name: trimmed },
      {
        onError: (error) => {
          setDraft(member.name);
          toast.error(errorMessage(error));
        },
      },
    );
  }

  return (
    <div role="listitem" className={styles.row}>
      <input
        className={styles.memberName}
        aria-label={`Name for ${member.name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          // Blur commits once; Enter and blur must not fire two renames.
          e.currentTarget.blur();
        }}
        autoComplete="off"
        enterKeyHint="done"
        maxLength={80}
      />
      <IconButton label={`Remove ${member.name}`} icon={<Icon name="trash" />} variant="plain" onClick={onRemove} />
    </div>
  );
}

function AddPersonForm({ adding, onAdd }: { adding: boolean; onAdd: (name: string) => void }) {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft("");
  }

  return (
    <form className={cx(styles.nameForm, styles.addPerson)} onSubmit={submit}>
      <div className={styles.field}>
        <Label.Root className={styles.label} htmlFor={inputId}>
          Name
        </Label.Root>
        <input
          id={inputId}
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a person"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={80}
        />
      </div>
      <Button type="submit" variant="primary" disabled={!trimmed} loading={adding}>
        Add
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
