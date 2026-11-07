import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { readLookBack } from "@/modules/partners";
import { partnersDb } from "../../partners/db";
import { Screen, Stack } from "@/ui";
import { readinessLinks } from "../../partners/area";
import { partnerPage } from "../../partners/guarded";
import { AreaHeading, AreaLinks, Pill } from "../../partners/parts";
import { PARTNER_PAGES, recurringLessons } from "../../partners/view";
import { day, hazardWord, month } from "../../partners/words";

export const metadata: Metadata = { title: englishText("hub.nav.lookBack") };

/**
 * "Look back and actions" (P-16, 2026-11-07, read-only, dummy records): what happened more than once across past disruptions and exercises,
 * the past records with their lessons, and the actions made from them with an owner role and a due date, open ones first.
 */
export default partnerPage(PARTNER_PAGES.lookBack, () => englishText("hub.nav.lookBack"), async () => {
  const { records, actions } = await readLookBack(partnersDb());
  const recurring = recurringLessons(records);
  const open = actions.filter((a) => a.status === "open").length;
  return (
    <Screen surface="staff">
      <Stack gap="section-hub">
        <AreaHeading title={englishText("P16.title")} lead={englishText("P16.lead")} area="readiness" />
        <p className="hub-flag">{englishText("P16.reviewLine")}</p>
        <section aria-labelledby="gaps-title" data-testid="look-back-recurring">
          <Stack gap="related">
            <h2 id="gaps-title">{englishText("P16.gapsTitle")}</h2>
            <p>{englishText("P16.gapsLead")}</p>
            <Stack as="ul" gap="related">
              {recurring.map((gap) => (
                <li key={gap.lesson} className="hub-card hub-card--gap">
                  <Stack gap="subline">
                    <p className="hub-card__title">{gap.lesson}</p>
                    <p>
                      {englishText("P16.cameUp")} {gap.records.join("; ")}
                    </p>
                  </Stack>
                </li>
              ))}
            </Stack>
          </Stack>
        </section>
        <section aria-labelledby="actions-title" data-testid="look-back-actions">
          <Stack gap="related">
            <h2 id="actions-title">{englishText("P16.actionsTitle")}</h2>
            <p>{englishText("P16.actionsLead", { open, done: actions.length - open })}</p>
            <Stack as="ul" gap="related">
              {actions.map((a) => (
                <li key={a.id} className={`hub-card hub-card--${a.status === "open" ? "waiting" : "covered"}`} data-testid={`action-${a.id}`}>
                  <Stack gap="subline">
                    <div className="hub-card__head">
                      <span className="hub-card__title">{a.body}</span>
                      <Pill tone={a.status === "open" ? "waiting" : "covered"}>{englishText(`P16.${a.status}`)}</Pill>
                    </div>
                    <p className="hub-card__meta">{englishText("P16.from", { lesson: a.lesson })}</p>
                    <p>
                      {englishText("P16.owner", { owner: a.ownerRole })} · {englishText("P16.due", { due: day(a.due) })}
                    </p>
                    {a.changed && <p>{englishText("P16.changed", { label: a.changed })}</p>}
                  </Stack>
                </li>
              ))}
            </Stack>
          </Stack>
        </section>
        <section aria-labelledby="records-title" data-testid="look-back-records">
          <Stack gap="related">
            <h2 id="records-title">{englishText("P16.recordsTitle")}</h2>
            <p>{englishText("P16.recordsLead")}</p>
            <Stack as="ul" gap="related">
              {records.map((r) => (
                <li key={r.id} className={`hub-card hub-card--${r.kind === "real" ? "full" : "closed"}`} data-testid={`record-${r.id}`}>
                  <Stack gap="subline">
                    <div className="hub-card__head">
                      <span className="hub-card__title">{r.title}</span>
                      <Pill tone={r.kind === "real" ? "full" : "closed"}>{englishText(r.kind === "real" ? "P16.kindReal" : "P16.kindExercise")}</Pill>
                    </div>
                    <p className="hub-card__meta">
                      {hazardWord(r.hazard)} · {r.place} · {month(r.period)}
                    </p>
                    <p className="hub-card__title">{englishText("P16.lessons")}</p>
                    <ul>
                      {r.lessons.map((lesson) => (
                        <li key={lesson}>{lesson}</li>
                      ))}
                    </ul>
                  </Stack>
                </li>
              ))}
            </Stack>
          </Stack>
        </section>
        <AreaLinks label={englishText("P11.alsoTitle")} links={readinessLinks()} />
      </Stack>
    </Screen>
  );
});
