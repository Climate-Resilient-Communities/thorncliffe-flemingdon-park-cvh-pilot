# Procedures

**Owner:** Hub Admin lead (keeps this index and the review dates current)
**Last reviewed:** 2026-10-06

Short procedures for the Hub to follow under pressure, so sending, correcting and recovering are done the same way every time (S09.03, NFR-N6). Each page is in plain steps with the Hub's own screen names, names its owner (a role) and the date it was last reviewed. Each Hub screen that starts one of these tasks shows a link under its heading, "Procedure: ... (opens in a new tab)", which opens the page here on GitHub.

The pages hold no secret value, phone number or name: they name roles and where things are kept. Change a page in a pull request and update its **Last reviewed** date; a step that did not work in a rehearsal is fixed here before launch.

| Procedure | Owner | Starts on |
| --- | --- | --- |
| [Writing and approving an alert](write-and-approve-an-alert.md) | Hub Coordinator on duty | Log a disruption, Compose an alert, Approve an alert |
| [Correcting or withdrawing an entry](correct-or-withdraw.md) | Hub Coordinator on duty | Correct an alert, Withdraw an alert, Approve a correction or withdrawal |
| [Closing an alert](close-an-alert.md) | Hub Coordinator on duty | Mark resolved, Approve a final message |
| [Running a drill](run-a-drill.md) | Hub Admin (drill lead) | Drills, Start a drill, Drill roster |
| [Pausing and resuming texts](pause-and-resume-texts.md) | Hub Admin on call | Pause or resume texts |
| [Resending texts that failed](resend-failed-texts.md) | Hub Admin on call | The list of failed, undelivered or unknown texts |
| [A spending cap overrun](cap-overrun.md) | Hub Admin on call | Spend |
| [A health alert and who owns the incident](health-alert.md) | Hub Admin on call | The health banner on every Hub screen |
| [Changing Messaging Service settings](messaging-service-change.md) | IT lead | No Hub screen: Twilio Console (texts paused first) |
| [Rotating secrets](rotate-secrets.md) | IT lead | People (someone leaving); otherwise Vercel, Supabase, Twilio, Cohere, GitHub |
| [A resident access request](access-request.md) | Hub Admin (privacy contact) | No Hub screen: `scripts/access-request` (the screen is the MVP's) |

Also here:

- [Rehearsal log](rehearsals.md): who rehearsed which procedure, when and with what outcome. The launch rehearsals (a production drill, a pause and resume, a resend, the access-request process) are recorded there before launch.
- [Weekly reliability notes](weekly-notes/README.md): one file per week, from `scripts/export-weekly`.

The end-of-pilot re-consent campaign and the purge have their own procedures (S09.07, S09.08), not here.

## Roles used on these pages

- **Hub Coordinator on duty**: the Coordinator (or Admin) handling alerts that shift. Writes, corrects and closes alerts.
- **Second person**: a Coordinator or Admin who did not write or change the entry. Only they can approve it.
- **Hub Admin on call**: the Admin whose number is on the On-call numbers page and who answers the on-call texts and the outside monitor's emails that shift. Pauses texts, resends, owns health incidents.
- **Hub Admin lead**: the Admin who keeps these pages reviewed and runs the weekly review.
- **IT lead**: holds the production credentials (Vercel, Supabase, Twilio, Cohere, GitHub), runs the scripts, changes provider settings.
- **Director**: reads spend and measures; decides on the budget.

Every Admin and Coordinator signs in with their authenticator code: the actions on these pages need it.
