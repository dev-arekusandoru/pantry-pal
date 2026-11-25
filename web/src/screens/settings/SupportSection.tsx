import { useSession } from "@/app/session";
import { Card, buttonClass } from "@/ui";
import styles from "./Settings.module.css";

/** "Contact support" mail link. Renders nothing when the server has no support email. */
export function SupportSection() {
  const email = useSession()?.session.supportEmail;
  if (!email) return null;

  return (
    <Card as="section" aria-labelledby="settings-support" className={styles.section}>
      <h2 id="settings-support" className={styles.heading}>
        Help
      </h2>
      <p className={styles.hint}>Questions or problems? Email {email}. We reply within 2 days.</p>
      <a href={`mailto:${email}`} className={buttonClass({ variant: "secondary" })}>
        Contact support
      </a>
    </Card>
  );
}
