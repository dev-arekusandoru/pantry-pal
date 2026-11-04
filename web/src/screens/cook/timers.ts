import { useCallback, useEffect, useRef, useState } from "react";

export interface StepTimer {
  durationSec: number;
  /** Epoch ms when it rings. Wall-clock based, so a throttled background tab never drifts. */
  endsAt: number;
  finished: boolean;
}

const TICK_MS = 250;

/** Short triple beep. Needs an AudioContext that was created/resumed in a user gesture. */
function beep(ctx: AudioContext | null): void {
  if (!ctx) return;
  try {
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.35;
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  } catch {
    // Sound is a nicety.
  }
}

/**
 * Independent per-step countdowns that survive step changes (state lives above
 * the step view). Finishing vibrates and beeps where the browser allows it; the
 * screen shows the visual alert from `ringing`.
 */
export function useStepTimers() {
  const [timers, setTimers] = useState<Record<number, StepTimer>>({});
  const [ringing, setRinging] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const timersRef = useRef(timers);
  const audioRef = useRef<AudioContext | null>(null);

  const running = Object.values(timers).some((t) => !t.finished);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const done = Object.entries(timersRef.current).filter(([, v]) => !v.finished && v.endsAt <= t);
      if (done.length === 0) return;
      const next = { ...timersRef.current };
      for (const [step, v] of done) next[Number(step)] = { ...v, finished: true };
      timersRef.current = next;
      setTimers(next);
      setRinging((r) => [...r, ...done.map(([step]) => Number(step))]);
      if (typeof navigator.vibrate === "function") navigator.vibrate([400, 150, 400, 150, 400]);
      beep(audioRef.current);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const set = useCallback((next: Record<number, StepTimer>) => {
    timersRef.current = next;
    setTimers(next);
  }, []);

  const start = useCallback(
    (step: number, durationSec: number) => {
      // Created inside the tap so the browser lets it play later.
      try {
        audioRef.current ??= new AudioContext();
        void audioRef.current.resume();
      } catch {
        audioRef.current = null;
      }
      const t = Date.now();
      setNow(t);
      set({ ...timersRef.current, [step]: { durationSec, endsAt: t + durationSec * 1000, finished: false } });
      setRinging((r) => r.filter((s) => s !== step));
    },
    [set],
  );

  const cancel = useCallback(
    (step: number) => {
      const { [step]: _removed, ...rest } = timersRef.current;
      set(rest);
      setRinging((r) => r.filter((s) => s !== step));
    },
    [set],
  );

  const dismiss = useCallback((step: number) => setRinging((r) => r.filter((s) => s !== step)), []);

  /** Seconds left, 0 when finished. */
  const remaining = (step: number): number => {
    const t = timers[step];
    return t === undefined || t.finished ? 0 : Math.max(0, (t.endsAt - now) / 1000);
  };

  return { timers, ringing, start, cancel, dismiss, remaining };
}
