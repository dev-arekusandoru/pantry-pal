import { Fragment, useState } from "react";
import { Separator } from "radix-ui";
import { formatDate, openPortal, useSession, type AuthenticatedSession } from "@/app/session";
import { Button, Card, cx } from "@/ui";
import styles from "./Settings.module.css";

type Billing = NonNullable<AuthenticatedSession["billing"]>;

function statusWords(billing: Billing): string {
  if (billing.exempt) return "Free plan. No charge.";
  switch (billing.status) {
    case "trialing": return "Free trial";
    case "active": return billing.cancelAtPeriodEnd ? "Active. Ends soon." : "Active";
    case "past_due": return "Payment failed";
    case "canceled": return "Ended";
    case "none": return "No plan";
    default: return billing.status.replace(/_/g, " ");
  }
}

function dateRow(billing: Billing): { label: string; date: string } | null {
  if (billing.status === "trialing" && billing.trialEndsAt) return { label: "Trial ends", date: billing.trialEndsAt };
  if (billing.status === "active" && billing.currentPeriodEnd) {
    return { label: billing.cancelAtPeriodEnd ? "Plan ends" : "Renews", date: billing.currentPeriodEnd };
  }
  return null;
}

/** Plan status and email status for hosted Rakumi. Renders nothing outside a session or when both are off. */
export function PlanSection() {
  const context = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!context) return null;
  const { account, billing, features } = context.session;
  if (!billing && !features.email) return null;

  const rows: Array<{ label: string; value: string }> = [];
  if (billing) {
    rows.push({ label: "Status", value: statusWords(billing) });
    if (billing.interval) rows.push({ label: "Billed", value: billing.interval === "year" ? "Every year" : "Every month" });
    const date = dateRow(billing);
    if (date) rows.push({ label: date.label, value: formatDate(date.date) });
  }
  if (features.email) {
    rows.push({
      label: "Email",
      value: account.emailVerified
        ? `${account.email} is verified`
        : `${account.email} is not verified${account.verifyBy ? `. Verify by ${formatDate(account.verifyBy)}` : ""}`,
    });
  }

  return (
    <Card as="section" aria-labelledby="settings-plan" className={styles.section}>
      <h2 id="settings-plan" className={styles.heading}>
        {billing ? "Plan and billing" : "Account"}
      </h2>
      <div className={styles.rows} role="list">
        {rows.map((row, index) => (
          <Fragment key={row.label}>
            {index > 0 && <Separator.Root decorative className={styles.sep} />}
            <div role="listitem" className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.label}>{row.label}</span>
                <span className={styles.hint}>{row.value}</span>
              </div>
            </div>
          </Fragment>
        ))}
      </div>
      {billing && !billing.exempt && (
        <Button
          loading={busy}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void openPortal().then(setError).finally(() => setBusy(false));
          }}
        >
          Manage billing
        </Button>
      )}
      {error && (
        <p className={cx(styles.hint, styles.error)} role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
