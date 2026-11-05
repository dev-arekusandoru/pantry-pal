import type { CSSProperties } from "react";
import { Link, Outlet, useMatches } from "@tanstack/react-router";
import { Emoji, Icon, cx, emojiSrc } from "../ui";
import styles from "./Shell.module.css";
import { TABS, type TabId } from "./tabs";

/** Tab id and chrome options come from the deepest match's `staticData`. */
function useChrome(): { tab: TabId; hideNavOnMobile: boolean } {
  const matches = useMatches();
  let tab: TabId = "week";
  let hideNavOnMobile = false;
  for (const m of matches) {
    if (m.staticData.tab) tab = m.staticData.tab;
    if (m.staticData.hideNavOnMobile !== undefined) hideNavOnMobile = m.staticData.hideNavOnMobile;
  }
  return { tab, hideNavOnMobile };
}

export function Shell() {
  const { tab, hideNavOnMobile } = useChrome();
  const sticker = TABS.find((t) => t.id === tab)!.sticker;
  return (
    <div
      className={cx(styles.shell, hideNavOnMobile && styles.hideNavOnMobile)}
      data-tab={tab}
      style={{ "--tab-sticker": `url("${emojiSrc(sticker)}")` } as CSSProperties}
    >
      <nav className={styles.nav} aria-label="Main">
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <Emoji code="1FAD9" size={34} />
          </span>
          <span className={styles.brandName}>PantryPal</span>
        </div>
        <div className={styles.tabs}>
          {TABS.map((t) => (
            <Link
              key={t.id}
              to={t.to}
              data-tab={t.id}
              className={cx(styles.tab, t.id === tab && styles.on)}
              aria-current={t.id === tab ? "page" : undefined}
            >
              <span className={styles.tabIcon}>
                <Icon name={t.icon} size="100%" />
              </span>
              <span>{t.label}</span>
            </Link>
          ))}
        </div>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
