"use client";

import { useActionState } from "react";
import type { CampaignPageText, CampaignScreen } from "./view";
import { reopenSignupsAction, rehearseCampaignAction, startCampaignAction } from "./actions";
import type { CampaignState } from "./control";
import { CampaignAnswerView, RehearseFormView, ReopenFormView, StartFormView, latestAnswer, type CampaignFormLabels } from "./CampaignFormsView";
import { CampaignView } from "./CampaignView";

const IDLE: CampaignState = { status: "idle" };

/**
 * The End of the pilot page with its three buttons wired to the server actions (S09.07). Each is a plain form action, so it works before any script has run. The
 * page re-renders when an action finishes (the campaign is read again), which moves it to its next phase; this component stays mounted, so the answer of the press
 * that made the change is still on the screen. The keys are made by the server for this page view: a retried request carries the same one.
 */
export function CampaignForms({
  text,
  screen,
  labels,
  rehearseKey,
  startKey,
}: {
  text: CampaignPageText;
  screen: CampaignScreen;
  labels: CampaignFormLabels;
  rehearseKey: string;
  startKey: string;
}) {
  const [rehearseState, rehearse, rehearsing] = useActionState(rehearseCampaignAction, IDLE);
  const [startState, start, starting] = useActionState(startCampaignAction, IDLE);
  const [reopenState, reopen, reopening] = useActionState(reopenSignupsAction, IDLE);
  const deadlineDate = screen.start?.deadlineDate ?? "";
  return (
    <CampaignView
      text={text}
      screen={screen}
      answer={<CampaignAnswerView answer={latestAnswer(rehearseState, startState, reopenState)} />}
      forms={{
        rehearse: <RehearseFormView labels={labels} requestKey={rehearseKey} deadlineDate={deadlineDate} pending={rehearsing} action={rehearse} />,
        start: <StartFormView labels={labels} requestKey={startKey} deadlineDate={deadlineDate} pending={starting} action={start} />,
        reopen: <ReopenFormView labels={labels} pending={reopening} action={reopen} />,
      }}
    />
  );
}
