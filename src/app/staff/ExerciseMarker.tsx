import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";

/** What the exercise marker says (X-10, the prototype's own words): the title and the line under it. Resolved from the catalog; a screen's view model carries them. */
export interface ExerciseWords {
  title: string;
  sub: string;
}

/** The exercise marker's words in English: "Exercise. This is practice." and "Nothing here is sent to residents." */
export const exerciseWords = (): ExerciseWords => ({ title: englishText("x10.running"), sub: englishText("x10.runningSub") });

/**
 * The exercise marker (X-10, S06.05): shown at the top of every Hub screen that belongs to a drill (the composers, the audience pages, the approval, the
 * drill pages), so no one mistakes a rehearsal for a real alert. A status note in the Hub's own flag style. It holds no behaviour, so the layout tests and the
 * screenshots draw the very same markup.
 */
export function ExerciseMarker({ words }: { words: ExerciseWords }) {
  return (
    <div className="hub-flag" role="status" data-testid="exercise-marker">
      <Stack gap="subline">
        <p>
          <strong className="hub-flag__label">{words.title}</strong>
        </p>
        <p>{words.sub}</p>
      </Stack>
    </div>
  );
}
