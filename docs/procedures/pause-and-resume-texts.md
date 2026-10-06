# Pausing and resuming texts

**Owner:** Hub Admin on call
**Last reviewed:** 2026-10-06

One switch stops every text that has not yet been handed to the provider: alerts, sign-up and reply texts alike. Texts to the on-call Admins still go out, so a problem with sending is still reported. A text already handed to the provider cannot be called back. Pausing is the first thing to do for a wrong alert that is going out, a provider problem, and before anyone changes the Messaging Service ([changing Messaging Service settings](messaging-service-change.md)). Only an Admin signed in with the authenticator code can pause or resume.

## Pause

1. Open **Pause texts** (Administration, `/staff/texts`). The page is **Pause or resume texts**.
2. Under **Why are you pausing texts?** write the reason in a sentence (everyone at the Hub sees it on every screen, with your name and the time; never a resident's number or name).
3. Press **Pause all texts**. The page says **Texts are paused.**, how many texts are waiting, and how many were already handed to the provider and cannot be recalled.
4. Every Hub screen now shows **Texts are paused** with who, when and why. Tell the Hub team in the usual chat why, and who will decide when to resume.
5. While paused, alerts can still be written and approved (the approver sees "Texts are paused; this will send when resumed"); their texts wait.

## Fix the cause

- A wrong alert: correct or withdraw it ([correcting or withdrawing](correct-or-withdraw.md)). Approving the correction or withdrawal cancels the original's waiting texts.
- A provider problem or a Messaging Service change: follow [a health alert](health-alert.md) or [changing Messaging Service settings](messaging-service-change.md), and run the service check before resuming.

## Resume

1. Open **Pause or resume texts** again (or press **Resume texts** in the banner).
2. Press **Resume texts**. The page says how many texts were waiting and now go out in order. Each one is checked again just before it is handed over: a text of an alert that was corrected, withdrawn or closed meanwhile, or whose valid-until has passed, is cancelled or skipped instead of sent (a final entry, and the withdrawal that closed an alert, are still sent).
3. Check **See sending progress** of the alerts that were waiting.
4. Write the pause in this week's notes (`docs/procedures/weekly-notes/`): the weekly review lists every pause with its start, end and duration.

If a screen says **Texts are not going out** and "The pause switch is missing from the database", tell IT now: every text is being held.
