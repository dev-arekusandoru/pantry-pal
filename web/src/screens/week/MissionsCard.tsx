import { Icon, Pal } from "@/ui";
import type { DoneCook } from "@/game/history";
import { readSweepCount, useTreat, weekMissions } from "@/game/missions";
import type { PlanView } from "./model";
import styles from "./Week.module.css";

export function MissionsCard({ plan, history, today }: { plan: PlanView; history: readonly DoneCook[]; today: string }) {
  const missions = weekMissions(plan, history, today, readSweepCount(plan.weekStart));
  const dinnerMission = missions.find((mission) => mission.id === "dinners");
  const treat = useTreat(plan.weekStart, dinnerMission?.done ?? false);

  return (
    <section className={styles.missions} data-ui="missions" aria-labelledby="missions-title">
      <header className={styles.missionsHead}>
        <h2 id="missions-title">This week's missions</h2>
      </header>
      <ul className={styles.missionList}>
        {missions.map((mission) => (
          <li key={mission.id} className={styles.mission} data-done={mission.done || undefined}>
            <span className={styles.missionCheck} aria-hidden="true">
              {mission.done && <Icon name="check" size={17} />}
            </span>
            <span className={styles.missionCopy}>
              <span className={styles.missionTitle}>{mission.title}</span>
              <span className={styles.missionProgress}>{mission.progress} of {mission.target}</span>
              {mission.hint && <span className={styles.missionHint}>{mission.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.treat} data-state={treat.spent ? "used" : treat.earned ? "earned" : "locked"}>
        {treat.spent ? (
          <div className={styles.treatUsed}>
            <Pal mood="cheer" size={42} />
            <span>Treat night enjoyed</span>
          </div>
        ) : treat.earned ? (
          <>
            <span className={styles.treatTitle}>Treat Stamp earned!</span>
            <button type="button" className={styles.treatButton} onClick={treat.spend}>Use my treat</button>
          </>
        ) : (
          <span className={styles.treatLocked}>Cook your dinners to earn a treat</span>
        )}
      </div>
    </section>
  );
}
