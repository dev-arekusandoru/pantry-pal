import styles from "./motion.module.css";

/**
 * Optional enter-fade class names for screen content that mounts after loading
 * or in place of a skeleton. Apply to a wrapper; nothing animates at rest.
 * `fadeInRise` also lifts the content by `--shift` (8px).
 */
export const fadeIn = styles.fadeIn;
export const fadeInRise = styles.fadeInRise;

/**
 * True while the document is inside a View Transition (the router wraps each
 * navigation in one). Any mount-time fade started now would be baked into the
 * new page snapshot at opacity 0 and would then fade in *after* the page
 * transition, i.e. content appearing in stages. Components that fade in on
 * mount can skip the animation for that navigation; the page-level crossfade
 * already covers the arrival. Falls back to `false` where the pseudo-class is
 * unknown (jsdom, older browsers), so the fade still runs there.
 */
export function isViewTransitionActive(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.documentElement.matches(":active-view-transition");
  } catch {
    return false;
  }
}
