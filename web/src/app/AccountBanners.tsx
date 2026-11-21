import { useState } from "react";
import { Button } from "../ui";
import { formatDate, openPortal, useSession } from "./session";
import { ResendLink } from "./AccountScreens";
import styles from "./AccountBanners.module.css";

/** Notes above the app: verify your email, or your plan is about to end. Shows nothing outside a session. */
export function AccountBanners() {
  const context = useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!context) return null;
  const { account, billing } = context.session;
  const verify = !account.emailVerified && account.verifyBy;
  const ending = billing?.cancelAtPeriodEnd && billing.currentPeriodEnd;
  if (!verify && !ending) return null;

  return <div className={styles.banners}>
    {verify && <section className={styles.banner} aria-label="Verify your email">
      <p>Verify your email by {formatDate(account.verifyBy!)}.</p>
      <ResendLink />
    </section>}
    {ending && <section className={styles.banner} aria-label="Plan ends">
      <p>Your plan ends on {formatDate(billing.currentPeriodEnd!)}.</p>
      <Button loading={busy} disabled={busy} onClick={() => {
        setBusy(true);
        setError("");
        void openPortal().then(setError).finally(() => setBusy(false));
      }}>Manage billing</Button>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>}
  </div>;
}
