import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { can } from "@/modules/identity";
import { Screen, Stack } from "@/ui";
import { staffPage } from "../guard";
import { logSpendError, readOverview } from "../spendSeam";
import { CapForm } from "./CapForm";
import type { CapLabels } from "./CapFormView";
import { SpendBody } from "./SpendBody";
import { spendScreen, type SpendScreen } from "./view";

export const metadata: Metadata = { title: englishText("staff.spend.title") };

const t = (key: string) => englishText(`staff.spend.${key}`);

const labels = (): CapLabels => ({ label: t("cap.label"), hint: t("cap.hint"), save: t("cap.save"), saving: t("cap.saving") });

/** The page as words, or null when the spend could not be read (the page says so and shows no figure). */
async function readScreen(): Promise<{ screen: SpendScreen; capCents: number | null } | null> {
  try {
    const overview = await readOverview();
    return { screen: spendScreen(overview, { setOn: overview.capSetAt }), capCents: overview.capCents };
  } catch (error) {
    logSpendError("spend.read_failed", { error: error instanceof Error ? error.name : "NonError" });
    return null;
  }
}

/**
 * "Spend" (S07.08): the policy action `spend.view`, which an Admin and a Director have (a Director read-only, AD-4). Text message and Cohere spend this
 * month and for the pilot to date against the pilot budget, every figure labelled (actual, unmatched actual, unresolved estimate, pending reconciliation,
 * a known price, an estimate, "price unknown"), and the monthly cap on texts. Only an Admin (`spend.cap`, at aal2 in the action) is given the form to
 * set the cap; the action refuses everyone else on its own. Another role sees "Only an Admin or a Director can see spend." and nothing else. Responses
 * are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/spend",
    access: "hub",
    action: "spend.view",
    refused: () => (
      <Screen surface="staff">
        <Stack gap="section-hub">
          <h1>{t("title")}</h1>
          <p role="alert" className="hub-error">
            {t("errors.forbidden")}
          </p>
        </Stack>
      </Screen>
    ),
  },
  async (session) => {
    const read = await readScreen();
    const form = can(session.role, "spend.cap") ? (
      <CapForm labels={labels()} current={read?.capCents != null ? (read.capCents / 100).toFixed(2) : ""} />
    ) : (
      <p data-testid="cap-read-only">{t("cap.readOnly")}</p>
    );
    return (
      <Screen surface="staff">
        <SpendBody screen={read?.screen ?? null} unreadable={read === null} form={form} />
      </Screen>
    );
  },
);
