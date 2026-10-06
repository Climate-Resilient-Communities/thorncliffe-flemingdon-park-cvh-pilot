# A health alert and who owns the incident

**Owner:** Hub Admin on call (owns each incident); IT lead (technical lead)
**Last reviewed:** 2026-10-06

The health job checks every minute for the failures the CVH knows about. When one begins, the on-call Admins (the numbers on **On-call numbers**, `/staff/oncall`) get one short text, at most once per condition every 30 minutes, and every Admin and Coordinator screen shows the health banner naming it in plain words until it clears. Everyone else at the Hub sees "Sending is failing" when the sender itself is failing. If the health job itself stops, or the database or the app is down, an uptime monitor outside the CVH emails the on-call Admins (it does not depend on the CVH's own texting).

## Who owns the incident

1. The first on-call Admin who sees the text, the email or the banner says "I have it" in the Hub's chat. From then on they are the **incident owner** until they hand over.
2. If nobody has taken it within 15 minutes, the Hub Admin lead takes it.
3. The owner decides what the Hub does (pause texts, tell residents through an alert, wait), keeps a short timeline (times and what was done, no residents' numbers or names) and tells the Hub team.
4. The IT lead is the technical lead for causes in Vercel, Supabase, Twilio or Cohere. The owner calls IT for anything marked "IT" below and stays the owner.
5. Hand over in the chat by name ("X now owns this"). The incident ends when the banner clears and the owner has said so in the chat.
6. Afterwards the owner writes it in this week's notes (`docs/procedures/weekly-notes/`): what happened, how long, what to change. The weekly review lists every condition with its start, end and duration.

## First steps by condition (the banner's words)

| The banner says | First steps |
| --- | --- |
| Texts have waited more than 5 minutes to be sent | Check whether texts are paused (Pause texts). If not, IT checks the dispatcher job (`cvh-dispatch` in pg_cron) and Twilio. Residents are not getting texts: consider telling them through the web app. |
| No sender has run for more than 3 minutes while texts are waiting | IT: the dispatcher job or the app (Vercel) is down. |
| Some texts may or may not have arrived | Open **See sending progress** of the alert, then the texts with an unknown outcome; decide on a resend ([resending texts that failed](resend-failed-texts.md)). |
| Smart Encoding is on in the Twilio Messaging Service | Pause texts, then IT turns it off ([changing Messaging Service settings](messaging-service-change.md)), runs the check, resume. |
| The Twilio Messaging Service allows texts to countries other than Canada, or SMS pumping protection is off | As above: pause, IT fixes the setting, runs the check, resume. |
| Twilio refused the CVH sign-in, so texts are not being sent | IT: the Twilio account (suspended? the auth token rotated?) and `TWILIO_AUTH_TOKEN` in Vercel ([rotating secrets](rotate-secrets.md)). On-call texts may not arrive either. |
| Many messages from Twilio failed the signature check | IT: a wrong `TWILIO_AUTH_TOKEN` after a rotation, or someone posting to the webhooks. |
| A scheduled job failed in the last 10 minutes | IT: pg_cron's run history and the job's logs (sending, closing expired alerts, the health check, the reconciliation, the measures). |
| An alert was submitted with a whole language in English | Read the alert in that language on the approval page; if it matters, **Try translation again** or write an update. |
| The last directory publish failed | Residents still see the previous directory. An Admin publishes again from **Directory**; if it fails again, IT. |
| More sign-up and reply texts were sent today than the daily limit | Someone may be misusing the sign-up form. IT looks at the sign-up and inbound counts; texts keep sending. |
| An approval this month went over the monthly text message spending cap | [A spending cap overrun](cap-overrun.md). |
| The health check has not run for more than 3 minutes | The banner may be out of date. IT: the `cvh-health` job. |

## The outside monitor's email

The email names the cause when the monitor includes the response body: `health_job_stale` (the health job has not run for 3 minutes: pg_cron, the job secret, or Vercel), `provider_auth` (Twilio refuses the CVH's sign-in) or `database_unreachable` (Supabase). No answer at all means the app is down. The owner calls IT at once: nothing in the CVH can text anyone about these.

## When it clears

The health job records the recovery and the banner goes. The owner checks **See sending progress** of any alert sent during the incident and resends what needs it.
