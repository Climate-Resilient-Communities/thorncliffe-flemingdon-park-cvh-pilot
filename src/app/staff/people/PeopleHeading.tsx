import { englishText } from "@/i18n/text";
import { Stack } from "@/ui";
import { ProcedureLink } from "../ProcedureLink";
import { procedureLink } from "../procedures";

/**
 * People's heading and lead, shown to everyone who reaches the page, and the procedure for rotating secrets (S09.03): someone leaving the Hub starts here, with a
 * password reset that signs them out on every device. No behaviour, so the page and its screenshot fixture draw the same heading.
 */
export function PeopleHeading() {
  return (
    <Stack gap="related">
      <h1>{englishText("staff.people.title")}</h1>
      <p>{englishText("staff.people.lead")}</p>
      <ProcedureLink link={procedureLink("rotate-secrets")} />
    </Stack>
  );
}
