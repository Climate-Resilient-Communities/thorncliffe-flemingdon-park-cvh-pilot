// The body of the alert's staff view of its sending progress (S06.09), `/staff/alerts/sending`, and of the list of the texts that did not arrive,
// `/staff/alerts/sending/texts`: what the entry is, and the progress block or the reason there is none. Pure; the pages are staffPage()s that load the data.
import type { ReactNode } from "react";
import { Stack } from "@/ui";
import type { ProblemListScreen, SendingScreen } from "./load";
import type { ResendAllView, ResendControlView } from "./view";
import { SendingProgress, SendingProgressBody } from "./SendingProgress";

export function SendingBody({ screen, live = true }: { screen: SendingScreen; /** The layout tests and the screenshots draw it without the timer. */ live?: boolean }) {
  const Progress = live ? SendingProgress : SendingProgressBody;
  return (
    <Stack gap="section-hub-review">
      <Stack gap="related">
        <h1 className="hub-wrap" data-testid="sending-heading">
          {screen.heading}
        </h1>
        {screen.notice ? (
          <>
            <p role="note" className="hub-flag hub-wrap" data-testid="sending-notice">
              {screen.notice.message}
            </p>
            {screen.notice.link ? (
              <a className="tap hub-link hub-wrap" href={screen.notice.link.href} data-testid="sending-notice-link">
                {screen.notice.link.label}
              </a>
            ) : null}
          </>
        ) : null}
      </Stack>
      {screen.block?.kind === "progress" ? <Progress view={screen.block.view} /> : null}
      {screen.block?.kind === "unavailable" ? (
        <p role="alert" className="hub-error hub-wrap" data-testid="sending-unavailable">
          {screen.block.note}
        </p>
      ) : null}
      <a className="tap hub-link hub-wrap" href={screen.back.href} data-testid="sending-back">
        {screen.back.label}
      </a>
    </Stack>
  );
}

/** How the Admin's resend forms are drawn (S09.02): the page gives the real forms, the layout tests and the screenshots the same markup without behaviour. */
export interface ResendSlots {
  one: (view: ResendControlView) => ReactNode;
  all: (view: ResendAllView) => ReactNode;
}

export function ProblemListBody({ screen, resend }: { screen: ProblemListScreen; resend?: ResendSlots }) {
  const { list } = screen;
  return (
    <Stack gap="section-hub-review">
      <Stack gap="related">
        <h1 className="hub-wrap" data-testid="sending-list-title">
          {list.title}
        </h1>
        <p className="hub-wrap">{screen.heading}</p>
        <p className="hub-wrap">{list.lead}</p>
      </Stack>
      {resend && list.resendIntro ? (
        <section aria-labelledby="resend-title" data-testid="resend-intro">
          <Stack gap="related">
            <h2 id="resend-title">{list.resendIntro.title}</h2>
            <p className="hub-wrap">{list.resendIntro.lead}</p>
            {list.resendAll.length > 0 ? (
              <Stack as="ul" gap="related" testId="resend-all-forms">
                {list.resendAll.map((form) => (
                  <li key={form.lang} className="hub-list-item">
                    {resend.all(form)}
                  </li>
                ))}
              </Stack>
            ) : null}
          </Stack>
        </section>
      ) : null}
      {list.none ? (
        <p className="hub-wrap" data-testid="sending-list-none">
          {list.none}
        </p>
      ) : (
        <Stack as="ul" gap="related" testId="sending-list-items">
          {list.items.map((item) => (
            <li key={item.key} className="hub-list-item" data-testid="sending-list-item" data-meaning={item.meaningId}>
              <Stack gap="subline">
                <p className="hub-wrap">{item.line}</p>
                <p className="hub-wrap">
                  <strong>{item.meaning}</strong>
                </p>
                {item.note ? (
                  <small className="hub-wrap" data-testid="sending-list-note">
                    {item.note}
                  </small>
                ) : null}
                {resend && item.resend ? resend.one(item.resend) : null}
              </Stack>
            </li>
          ))}
        </Stack>
      )}
      {list.more ? <small className="hub-wrap">{list.more}</small> : null}
      <a className="tap hub-link hub-wrap" href={list.back.href} data-testid="sending-list-back">
        {list.back.label}
      </a>
    </Stack>
  );
}
