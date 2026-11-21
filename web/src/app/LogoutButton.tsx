import { useState } from "react";
import { Button } from "../ui";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error();
      // No session any more: the listener in BrowserSession clears the cache and
      // re-reads /auth/session, which swaps the app for the login form.
      window.dispatchEvent(new Event("pantrypal:unauthorized"));
    } catch {
      setError("Couldn't log out. Check your connection and try again.");
      setBusy(false);
    }
  }
  return <div><Button onClick={() => void logout()} loading={busy} disabled={busy}>Log out</Button>
    {error && <p role="alert">{error}</p>}</div>;
}
