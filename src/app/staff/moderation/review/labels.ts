// The words of O-09's Accept and O-10's decline (PRD §6.3), resolved on the server from the English catalog and handed to the forms as props.
import { englishText } from "@/i18n/text";
import type { DecideLabels } from "./DecideView";

const t = (key: string, values?: Record<string, string>) => englishText(`staff.moderation.${key}`, values);

export function decideLabels(name: string, kind: "add" | "correct"): DecideLabels {
  return {
    decideTitle: englishText("O09.decideTitle"),
    accept: englishText("O09.accept"),
    accepting: t("accepting"),
    // O09's own line ("It goes on the map and in search") would not be true: accepting publishes nothing (AD-11).
    acceptLine: t(`acceptLine.${kind}`),
    declineLink: t("declineLink"),
    declineLine: englishText("O09.declineLine"),
    declineTitle: englishText("O10.title", { name }),
    declineLead: englishText("O10.lead"),
    reasonsTitle: englishText("O10.reasonsTitle"),
    suggested: englishText("O10.suggested"),
    note: t("note"),
    noteHint: t("noteHint"),
    send: englishText("O10.send"),
    declining: t("declining"),
    cancel: englishText("O10.cancel"),
    toQueue: englishText("O09.toQueue"),
  };
}
