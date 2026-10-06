# Resending texts that failed

**Owner:** Hub Admin on call
**Last reviewed:** 2026-10-06

A resend sends the same words once more, to the same person, in its usual place in the queue. Nothing is ever resent by itself: an Admin decides. A text can be resent twice at most, only the latest text of a chain can be resent, and each resend counts in spend like any text. Only alert texts to residents are resent here; a drill's texts are checked on the Drills page and are not resent. Only an Admin signed in with the authenticator code can resend; Coordinators see the same lists without the buttons.

## Find the texts

1. On **Right now** (`/staff`), open the alert and press **See sending progress** (`/staff/alerts/sending`). It shows, per language, what became of the alert's texts.
2. Under **Texts that did not arrive**, open **See the failed texts**, **See the undelivered texts** or **See the texts with an unknown outcome**. The list (`/staff/alerts/sending/texts`) shows why each one did not arrive. No phone numbers are shown.

## Decide and resend

1. Do not resend a text whose reason says the number cannot receive texts (not in service, not a valid number, a landline, or the person replied STOP): the Hub refuses it, and a resend would only fail again. A note on the text says so.
2. If texts are paused, resume first or the resends wait in the queue ([pausing and resuming](pause-and-resume-texts.md)). If the provider is failing (a health alert), fix that first: a resend into a failing provider fails again.
3. For one text, press **Resend** on it.
4. For a text with an **unknown outcome**, read the warning "This text may already have arrived; resending may send it twice", tick the box if you still want to, and press **Resend**. Unknown texts are never in a resend of all.
5. For all of a language, press **Resend the failed and undelivered texts in {language}**. It takes the latest text of each person in that language that failed or was not delivered, at most 1,000 at a time ("There are more texts to resend": press it again).
6. Read the answer on the page: how many were resent and how many were left out, with why ("resent twice already", "the number cannot receive texts", "the person left", "the alert no longer sends it", ...). If the answer says the resends took the month past the cap, follow [a spending cap overrun](cap-overrun.md); they were still resent.
7. A few minutes later, check **See sending progress** again. A resent text that failed again can be resent once more (two in all).

## Refusals and what they mean

- "This text is now {status}, not {seen}": a late answer from the carrier changed it; reload the page.
- "A newer text was already made for this one": someone else resent it; reload.
- "This alert can no longer send this text": the entry was replaced, discarded or closed, or its valid-until passed. Write an update instead.

## Rehearsal before launch

S09.02 refuses to resend a drill's texts, so the launch rehearsal of a resend uses a real alert sent in production before launch, while residents' alerts are still off and only staff phones are signed up for texts: one staff phone is switched off (or out of service) so its text ends undelivered or failed, and an Admin resends it following this page. Record the alert in the [rehearsal log](rehearsals.md) so the week-8 measures leave it out.
