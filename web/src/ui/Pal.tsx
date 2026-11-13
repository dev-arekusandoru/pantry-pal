import { useId } from "react";
import { cx } from "./cx";
import styles from "./Pal.module.css";

export type PalMood = "happy" | "hungry" | "cheer" | "sleepy";

const LINE = "var(--pal-line, #6b2d0a)";
const GLASS = "var(--pal-glass, #fdf3dc)";
const FILL = "var(--pal-fill, #a9d68a)";
const LID = "var(--pal-lid, #f2a65a)";
const CHEEK = "var(--pal-cheek, #ffa59a)";

const BODY =
  "M36 34 H84 C84 42 100 44 100 60 V92 C100 102 94 108 84 108 H36 C26 108 20 102 20 92 V60 C20 44 36 42 36 34 Z";

// ~3px outline at 96px render (96/120 = 0.8 scale)
const W = 3.75;

function Eyes({ mood }: { mood: PalMood }) {
  const arc = { fill: "none", stroke: LINE, strokeWidth: 3.2 } as const;
  if (mood === "cheer")
    return (
      <g {...arc}>
        <path d="M38 76 Q46 66 54 76" />
        <path d="M66 76 Q74 66 82 76" />
      </g>
    );
  if (mood === "sleepy")
    return (
      <g {...arc}>
        <path d="M39 73 Q46 78 53 73" />
        <path d="M67 73 Q74 78 81 73" />
      </g>
    );
  const r = mood === "hungry" ? 6.5 : 5;
  return (
    <g className={cx(styles.eyes, styles.blink)}>
      <circle cx="46" cy="74" r={r} fill={LINE} />
      <circle cx="74" cy="74" r={r} fill={LINE} />
      <circle cx="47.8" cy="72" r={mood === "hungry" ? 2.4 : 1.8} fill="#fff" />
      <circle cx="75.8" cy="72" r={mood === "hungry" ? 2.4 : 1.8} fill="#fff" />
      {mood === "hungry" && (
        <>
          <circle cx="44.5" cy="76.5" r="1.1" fill="#fff" />
          <circle cx="72.5" cy="76.5" r="1.1" fill="#fff" />
        </>
      )}
    </g>
  );
}

function Mouth({ mood }: { mood: PalMood }) {
  const s = { stroke: LINE, strokeWidth: 3, fill: "none" } as const;
  if (mood === "cheer")
    return <path d="M50 82 Q60 98 70 82 Z" fill="#c9524a" stroke={LINE} strokeWidth={3} />;
  if (mood === "hungry")
    return (
      <>
        <path d="M54 83 Q60 94 66 83 Z" fill="#c9524a" stroke={LINE} strokeWidth={3} />
        <path d="M58 89 Q60 93 62 89" fill="#ff8f8f" stroke="none" />
        <path d="M67 86 q3 3 1 8 q-3 -1 -1 -8 Z" fill="#cfeeff" stroke={LINE} strokeWidth={1.6} />
      </>
    );
  if (mood === "sleepy") return <ellipse cx="60" cy="85" rx="2.6" ry="2" fill={LINE} />;
  return <path d="M53 83 Q60 91 67 83" {...s} />;
}

function Extras({ mood }: { mood: PalMood }) {
  const spark = (x: number, y: number, k: number) => (
    <path
      key={`${x}${y}`}
      transform={`translate(${x} ${y}) scale(${k})`}
      d="M0 -6 Q1 -1 6 0 Q1 1 0 6 Q-1 1 -6 0 Q-1 -1 0 -6 Z"
      fill="#ffe27a"
      stroke={LINE}
      strokeWidth={2.2}
    />
  );
  if (mood === "cheer")
    return (
      <>
        <path d="M20 66 Q8 62 8 48" fill="none" stroke={LINE} strokeWidth={9.5} strokeLinecap="round" />
        <path d="M20 66 Q8 62 8 48" fill="none" stroke={GLASS} strokeWidth={3.2} strokeLinecap="round" />
        <path d="M100 66 Q112 62 112 48" fill="none" stroke={LINE} strokeWidth={9.5} strokeLinecap="round" />
        <path d="M100 66 Q112 62 112 48" fill="none" stroke={GLASS} strokeWidth={3.2} strokeLinecap="round" />
        {spark(18, 24, 1)}
        {spark(104, 22, 0.8)}
        {spark(110, 84, 0.6)}
      </>
    );
  if (mood === "hungry") return <>{spark(100, 30, 0.9)}</>;
  if (mood === "sleepy")
    return (
      <g fill="none" stroke={LINE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M92 26 h10 l-10 11 h10" />
        <path d="M104 12 h6 l-6 7 h6" strokeWidth={2.4} />
      </g>
    );
  return null;
}

export function Pal({
  mood = "happy",
  size = 96,
  className,
  title,
}: {
  mood?: PalMood;
  size?: number | string;
  className?: string;
  title?: string;
}) {
  const clip = useId();
  const a11y = title
    ? ({ role: "img" } as const)
    : ({ "aria-hidden": true, focusable: false } as const);
  return (
    <svg
      className={cx(styles.pal, className)}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      strokeLinejoin="round"
      strokeLinecap="round"
      {...a11y}
    >
      {title && <title>{title}</title>}
      <clipPath id={clip}>
        <path d={BODY} />
      </clipPath>
      <Extras mood={mood} />
      {/* feet */}
      <ellipse cx="42" cy="110" rx="11" ry="6" fill={LID} stroke={LINE} strokeWidth={W} />
      <ellipse cx="78" cy="110" rx="11" ry="6" fill={LID} stroke={LINE} strokeWidth={W} />
      {/* body */}
      <path d={BODY} fill={GLASS} />
      <g clipPath={`url(#${clip})`}>
        <path d="M10 62 Q25 55 40 62 T70 62 T110 62 V120 H10 Z" fill={FILL} />
        <path d="M10 62 Q25 55 40 62 T70 62 T110 62" fill="none" stroke={LINE} strokeWidth={1.6} opacity={0.35} />
      </g>
      <path d={BODY} fill="none" stroke={LINE} strokeWidth={W} />
      {/* inner contour */}
      <path d="M95 66 V92 C95 98 91 103 84 103" fill="none" stroke={LINE} strokeWidth={1.8} opacity={0.35} />
      {/* shine */}
      <path d="M27 66 C27 58 31 55 35 55 C38 55 38 60 34 64 C31 68 30 76 29 80 C27 80 27 72 27 66 Z" fill="#fff" opacity={0.9} />
      <circle cx="29" cy="88" r="2.4" fill="#fff" opacity={0.9} />
      {/* lid */}
      <rect x="30" y="14" width="60" height="22" rx="8" fill={LID} stroke={LINE} strokeWidth={W} />
      <path d="M38 25 H82" stroke={LINE} strokeWidth={1.8} opacity={0.4} />
      <path d="M38 20 q6 -2 16 -2" stroke="#fff" strokeWidth={3} opacity={0.8} fill="none" />
      {/* sprout */}
      <path d="M60 14 Q60 8 62 5" fill="none" stroke={LINE} strokeWidth={3} />
      <path d="M62 6 C62 -2 74 -3 78 2 C76 10 66 11 62 6 Z" fill={FILL} stroke={LINE} strokeWidth={2.6} />
      {/* face */}
      <ellipse cx="34" cy="84" rx="6" ry="3.8" fill={CHEEK} opacity={0.75} />
      <ellipse cx="86" cy="84" rx="6" ry="3.8" fill={CHEEK} opacity={0.75} />
      <Eyes mood={mood} />
      <Mouth mood={mood} />
    </svg>
  );
}
