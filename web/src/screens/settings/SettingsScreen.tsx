import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Label, Separator } from "radix-ui";
import { errorMessage } from "@/api";
import { useTheme, type ThemePreference } from "@/app/theme";
import { LogoutButton } from "@/app/LogoutButton";
import { PlanSection } from "./PlanSection";
import {
  Button,
  Card,
  Emoji,
  ErrorState,
  Icon,
  IconButton,
  IconPicker,
  PageHeader,
  SegmentedControl,
  Sheet,
  Skeleton,
  Stepper,
  buttonClass,
  cx,
  hasIcon,
  ingredientEmoji,
  toast,
  type SegmentOption,
} from "@/ui";
import { AttentionLink } from "../ingredients/AttentionLink";
import styles from "./Settings.module.css";
import {
  useCreateMember,
  useCreateToken,
  useDeleteMember,
  useHousehold,
  useIngredients,
  useMembers,
  useRenameMember,
  useRevokeToken,
  useServerVersion,
  useTokens,
  useUpdateHousehold,
  type ApiToken,
  type HouseholdMember,
  type HouseholdSettings,
  type Ingredient,
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
  const ingredients = useIngredients();
  const [iconIngredient, setIconIngredient] = useState<Pick<Ingredient, "id" | "name" | "imageUrl"> | null>(null);
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

        <PlanSection />

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

        <Card as="section" aria-labelledby="settings-tokens" className={styles.section}>
          <h2 id="settings-tokens" className={styles.heading}>
            API tokens
          </h2>
          <TokensSection />
        </Card>

        <Card as="section" aria-labelledby="settings-ingredients" className={styles.section}>
          <h2 id="settings-ingredients" className={styles.heading}>
            Ingredients
          </h2>
          <p className={styles.hint}>
            Browse every ingredient, link foods, fix odd names and check custom entries.
          </p>
          <div className={styles.ingredientLinks}>
            <Link to="/ingredients" className={buttonClass({ variant: "secondary" })}>
              Open ingredients
            </Link>
            <AttentionLink variant="secondary" />
          </div>
        </Card>

        <MissingIcons
          ingredients={ingredients.data ?? []}
          onPick={(ingredient) =>
            setIconIngredient({ id: ingredient.id, name: ingredient.name, imageUrl: ingredient.imageUrl })
          }
        />

        <LogoutButton />

        <p className={styles.about}>
          Rakumi{version.data ? ` v${version.data}` : ""}
          <br />
          Self-hosted. Your pantry stays on your own server.
          <br />
          UI icons by{" "}
          <a href="https://phosphoricons.com" target="_blank" rel="noreferrer">
            Phosphor
          </a>{" "}
          (MIT).
        </p>
      </div>

      <IconPicker ingredient={iconIngredient} onClose={() => setIconIngredient(null)} />
    </>
  );
}

function MissingIcons({ ingredients, onPick }: { ingredients: Ingredient[]; onPick: (ingredient: Ingredient) => void }) {
  const missing = ingredients.filter((ingredient) => !hasIcon(ingredient.name, ingredient.imageUrl));
  if (missing.length === 0) return null;
  const params = new URLSearchParams({
    title: "Ingredient icons needed",
    body: `Rakumi has no icon for these ingredients:\n\n${missing.map((i) => `- ${i.name}`).join("\n")}`.slice(0, 3000),
  });
  return (
    <Card as="section" aria-labelledby="settings-icons" className={styles.section}>
      <h2 id="settings-icons" className={styles.heading}>
        Items without an icon
      </h2>
      <p className={styles.hint}>Pick an icon so these are easy to spot in lists.</p>
      <ul className={styles.iconList}>
        {missing.map((ingredient) => (
          <li key={ingredient.id}>
            <button type="button" className={styles.iconRow} onClick={() => onPick(ingredient)}>
              <span className={styles.missingIcon} aria-hidden="true">
                <Emoji code={ingredientEmoji(ingredient.name)} size={26} />
              </span>
              <span className={styles.label}>{ingredient.name}</span>
              <small>Choose icon</small>
            </button>
          </li>
        ))}
      </ul>
      <a
        className={styles.requestIcon}
        href={`https://github.com/dev-arekusandoru/pantry-pal/issues/new?${params}`}
        target="_blank"
        rel="noreferrer"
      >
        Request an icon
      </a>
    </Card>
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

function TokensSection() {
  const tokens = useTokens();
  const create = useCreateToken();
  const revoke = useRevokeToken();
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState<ApiToken | null>(null);
  const trimmed = draft.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    create.mutate(trimmed, {
      onSuccess: (created) => {
        setSecret(created.token);
        setDraft("");
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret ?? "");
      toast.show({ message: "Copied" });
    } catch {
      toast.error("Could not copy. Select the token and copy it by hand.");
    }
  }

  return (
    <>
      <p className={cx(styles.hint, styles.sectionHint)}>
        Tokens let apps and AI agents use the API and MCP server for this household.
      </p>

      {secret !== null && (
        <div className={styles.secret} role="status">
          <code aria-label="New API token">{secret}</code>
          <p className={styles.hint}>Copy it now. It won't be shown again.</p>
          <div className={styles.secretActions}>
            <Button onClick={() => void copy()}>Copy</Button>
            <Button onClick={() => setSecret(null)}>Done</Button>
          </div>
        </div>
      )}

      {tokens.isPending ? (
        <div className={styles.rows} aria-busy="true" aria-label="Loading tokens">
          <Skeleton height={44} radius={999} />
        </div>
      ) : tokens.isError ? (
        <p className={cx(styles.hint, styles.error)} role="alert">
          {errorMessage(tokens.error)}
        </p>
      ) : tokens.data.length === 0 ? (
        <p className={styles.hint}>No tokens yet.</p>
      ) : (
        <div className={styles.rows} role="list">
          {tokens.data.map((token, index) => (
            <Fragment key={token.id}>
              {index > 0 && <Separator.Root decorative className={styles.sep} />}
              <div role="listitem" className={styles.row}>
                <div className={styles.rowText}>
                  <span className={styles.label}>{token.name}</span>
                  <span className={styles.hint}>
                    {token.prefix}… · {token.lastUsedAt ? `Used ${new Date(token.lastUsedAt).toLocaleDateString()}` : "Never used"}
                  </span>
                </div>
                <Button onClick={() => setPending(token)} aria-label={`Revoke ${token.name}`}>
                  Revoke
                </Button>
              </div>
            </Fragment>
          ))}
        </div>
      )}

      <form className={cx(styles.nameForm, styles.addPerson)} onSubmit={submit}>
        <div className={styles.field}>
          <Label.Root className={styles.label} htmlFor={inputId}>
            Token name
          </Label.Root>
          <input
            id={inputId}
            className={styles.input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Claude"
            autoComplete="off"
            enterKeyHint="done"
            maxLength={80}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!trimmed} loading={create.isPending}>
          Create
        </Button>
      </form>

      <Sheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Revoke ${pending?.name ?? ""}?`}
        footer={
          <>
            <Button onClick={() => setPending(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={revoke.isPending}
              onClick={() => {
                if (!pending) return;
                revoke.mutate(pending.id, {
                  onError: (error) => toast.error(errorMessage(error)),
                  onSettled: () => setPending(null),
                });
              }}
            >
              Revoke token
            </Button>
          </>
        }
      >
        <p>Apps that use this token stop working right away.</p>
      </Sheet>
    </>
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
