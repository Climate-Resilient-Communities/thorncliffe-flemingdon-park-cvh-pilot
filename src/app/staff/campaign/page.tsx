import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { campaignService, logCampaignError, staffName, textCounts } from "../campaignSeam";
import { capNoticeFor } from "../spendSeam";
import { CampaignForms } from "./CampaignForms";
import { CAMPAIGN_PAGE, campaignPageText, campaignScreen, namedStaff, type CampaignScreen } from "./view";

export const metadata: Metadata = { title: englishText("staff.campaign.title") };

// "Rehearse on the drill roster" and "Start the campaign" run in this page's server actions and, once their texts are queued, start a dispatcher run that lives in
// this function after the response (kickDispatcher, src/app/dispatch.ts): the segment needs the same 60 seconds as the job route's run, a literal Next.js reads
// statically.
export const maxDuration = 60;

const t = (key: string) => englishText(`staff.campaign.${key}`);

function Heading() {
  return (
    <Stack gap="related">
      <h1>{t("title")}</h1>
      <p>{t("lead")}</p>
    </Stack>
  );
}

/** What the page shows: the campaign as subscriptions reads it, with the names of the Admins it names, its texts' counts and the cap's sentence. */
async function readScreen(): Promise<CampaignScreen> {
  const overview = await campaignService().overview();
  const ids = namedStaff(overview);
  const names = new Map(await Promise.all(ids.map(async (id) => [id, await staffName(id).catch(() => null)] as const)));
  const [rehearsalTexts, campaignTexts] = await Promise.all([
    overview.rehearsal ? textCounts(overview.rehearsal.id) : null,
    overview.campaign ? textCounts(overview.campaign.id) : null,
  ]);
  const capNotice = overview.campaign === null ? await capNoticeFor(overview.estimate.costCents, undefined, "staff.campaign.start.capNotice") : null;
  return campaignScreen({ overview, names, rehearsalTexts, campaignTexts, capNotice });
}

/**
 * "End of the pilot" (S09.07): rehearse the re-consent campaign on the drill roster, then, after the confirmation (the deadline, the subscribers who will be asked
 * per language, the estimated cost and the monthly cap), start it; follow it while it runs; and once it has ended, reopen sign-ups for the MVP. The policy action
 * `campaign.run`, Admins only (S01.12); its actions run at aal2 (S01.10). Another role sees "Only an Admin can run the end of the pilot." and nothing else. Each
 * page view makes the idempotency keys its two sending buttons carry, so a retried request changes nothing. Responses are no-store. The shell owns the <main>.
 */
export default staffPage(
  {
    route: CAMPAIGN_PAGE,
    access: "hub",
    action: "campaign.run",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <Heading />
          <p role="alert" className="hub-error">
            {t("errors.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async () => {
    let screen: CampaignScreen;
    try {
      screen = await readScreen();
    } catch (error) {
      logCampaignError("campaign.read_failed", { error: error instanceof Error ? error.name : "NonError" });
      return (
        <Screen surface="staff">
          <Stack gap="section-hub">
            <Heading />
            <p role="alert" className="hub-error" data-testid="campaign-unreadable">
              {t("errors.unreadable")}
            </p>
          </Stack>
        </Screen>
      );
    }
    return (
      <Screen surface="staff">
        <CampaignForms
          text={campaignPageText()}
          screen={screen}
          rehearseKey={randomUUID()}
          startKey={randomUUID()}
          labels={{
            rehearse: t("rehearsal.button"),
            rehearsing: t("rehearsal.sending"),
            confirm: t("start.confirm"),
            start: t("start.button"),
            starting: t("start.starting"),
            reopen: t("signups.button"),
            reopening: t("signups.reopening"),
          }}
        />
      </Screen>
    );
  },
);
