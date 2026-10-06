import type { ProcedureLinkView } from "./procedures";

/**
 * The link to a written procedure (S09.03), the same on every Hub screen that starts one: "Procedure: {title} (opens in a new tab)", under the page's lead
 * (on the approval view, after what the approver should know), to its page in docs/procedures on GitHub (`procedureLink(id)` builds it on the server). A new
 * tab, so the screen (a half-written alert, a form) stays as it is; no referrer, so the staff page's address, which can name an alert entry, is not sent to
 * GitHub. No behaviour, so client and server screens draw it alike.
 */
export function ProcedureLink({ link }: { link: ProcedureLinkView }) {
  return (
    <a className="tap hub-link hub-wrap" href={link.href} target="_blank" rel="noreferrer" data-testid="procedure-link" data-procedure={link.id}>
      {link.text}
    </a>
  );
}
