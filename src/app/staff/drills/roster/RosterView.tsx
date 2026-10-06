import type { ReactNode } from "react";
import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import { ProcedureLink } from "../../ProcedureLink";
import { procedureLink } from "../../procedures";
import { DRILLS_PAGE } from "../view";
import { countLine } from "./view";

const t = (key: string) => englishText(`staff.drillRoster.${key}`);

/**
 * The drill roster page's body (S06.05), as it is drawn: the heading, who a drill reaches, how many phones are on the roster, and the list and forms. `unreadable` is a
 * roster the Hub could not read: the page says so and still offers the forms, because a change is judged by the database either way. No behaviour, so the tests draw
 * the very same markup.
 */
export function RosterView({ count, unreadable = false, forms }: { count: number; unreadable?: boolean; forms: ReactNode }) {
  return (
    <Stack gap="section-hub">
      <Stack gap="related">
        <h1>{t("title")}</h1>
        <p>{t("lead")}</p>
        <ProcedureLink link={procedureLink("run-a-drill")} />
        <a className="tap hub-link" href={DRILLS_PAGE} data-testid="drill-roster-back">
          {t("back")}
        </a>
      </Stack>
      {unreadable ? (
        <p role="alert" className="hub-error" data-testid="drill-roster-unreadable">
          {t("errors.unreadable")}
        </p>
      ) : (
        <p role="status" data-testid="drill-roster-count">
          {countLine(count)}
        </p>
      )}
      {forms}
    </Stack>
  );
}
