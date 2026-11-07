import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { listExercises, type ExerciseRow } from "@/modules/partners";
import { getDb } from "@/platform/db";
import { Screen, Stack } from "@/ui";
import { readinessLinks } from "../../partners/area";
import { partnerPage } from "../../partners/guarded";
import { AreaHeading, AreaLinks, Pill } from "../../partners/parts";
import { PARTNER_PAGES } from "../../partners/view";
import { day, hazardWord, pw } from "../../partners/words";

export const metadata: Metadata = { title: englishText("hub.nav.exercise") };

/** An exercise as a card: what is practised, the level, the date and how often it repeats, or how many took part. */
function Exercise({ exercise }: { exercise: ExerciseRow }) {
  return (
    <li className={`hub-card hub-card--${exercise.kind === "scheduled" ? "waiting" : "closed"}`} data-testid={`exercise-${exercise.id}`}>
      <Stack gap="subline">
        <div className="hub-card__head">
          <span className="hub-card__title">{exercise.title}</span>
          <Pill tone={exercise.kind === "scheduled" ? "waiting" : "closed"}>{hazardWord(exercise.hazard)}</Pill>
        </div>
        <p>
          {exercise.kind === "scheduled"
            ? englishText("P14.schedLine", { date: day(exercise.onDate), repeat: englishText(`P14.repeats.${exercise.repeats}`), level: exercise.level })
            : pw("exercises.pastLine", { date: day(exercise.onDate), level: exercise.level, n: exercise.tookPart ?? 0 })}
        </p>
        <p className="hub-card__meta">{englishText(`P14.levelLine.${exercise.level}`)}</p>
      </Stack>
    </li>
  );
}

/**
 * "Exercises" (P-14, 2026-11-07, read-only in this release): the scheduled exercises, soonest first, and the past ones, whose records are in the
 * look back. Running an exercise (a practice disruption that reaches no resident) is not in this release.
 */
export default partnerPage(PARTNER_PAGES.exercise, () => englishText("hub.nav.exercise"), async () => {
  const exercises = await listExercises(getDb());
  const scheduled = exercises.filter((e) => e.kind === "scheduled");
  const past = exercises.filter((e) => e.kind === "past").reverse();
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P14.title")} lead={englishText("P14.lead")} area="readiness" />
        <section aria-labelledby="scheduled-title" data-testid="exercises-scheduled">
          <Stack gap="related">
            <h2 id="scheduled-title">{englishText("P14.schedTitle")}</h2>
            <p>{englishText("P14.schedLead")}</p>
            {scheduled.length === 0 ? (
              <p>{pw("exercises.noneScheduled")}</p>
            ) : (
              <Stack as="ul" gap="related">
                {scheduled.map((e) => (
                  <Exercise key={e.id} exercise={e} />
                ))}
              </Stack>
            )}
          </Stack>
        </section>
        <section aria-labelledby="past-title" data-testid="exercises-past">
          <Stack gap="related">
            <h2 id="past-title">{englishText("P14.pastTitle")}</h2>
            <Stack as="ul" gap="related">
              {past.map((e) => (
                <Exercise key={e.id} exercise={e} />
              ))}
            </Stack>
            <a className="hub-link" href={PARTNER_PAGES.lookBack}>
              {englishText("P14.pastOpen")}
            </a>
          </Stack>
        </section>
        <p className="hub-flag">{englishText("P14.safeLine")}</p>
        <AreaLinks label={englishText("P11.alsoTitle")} links={readinessLinks()} />
      </Stack>
    </Screen>
  );
});
