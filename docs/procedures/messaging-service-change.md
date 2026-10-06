# Changing Messaging Service settings

**Owner:** IT lead (changes the service); a Hub Admin pauses and resumes texts
**Last reviewed:** 2026-10-06

Every text goes through one Twilio Messaging Service on the verified toll-free number. Its settings decide whether residents get exactly the words that were approved, and whether someone could run up texting costs. There is no Hub screen for it: changes are made in the Twilio Console. The configuration-control rule (`docs/config.md`, "Messaging sender"): only named Admins (with IT) change the Messaging Service, texts are paused while they do, and the service check is run again before texts resume.

## Settings that must hold

- **Smart Encoding: off** (it would change characters after approval).
- **Geo permissions: Canada only**; **SMS pumping protection: on**.
- **Sender pool**: the verified toll-free number only.
- **Advanced Opt-Out: on** (STOP, START and HELP are Twilio's); **YES is not an opt-in (START) keyword**.
- **Integration, "Send a webhook"**: `PUBLIC_BASE_URL/api/twilio/inbound`, HTTP POST, exactly as written.
- **No status callback URL** on the service itself (each text carries its own).

## Steps

1. Agree the change and a time with the Hub Admin on call. Write down which setting changes, from what to what, and why.
2. The Admin pauses texts with the reason "Messaging Service change" ([pausing and resuming](pause-and-resume-texts.md), steps 1 to 4).
3. IT signs in to the Twilio Console (production subaccount), opens Messaging, Services, the CVH service, and makes the change. Change nothing else.
4. IT runs the service check: `curl -X POST -H "Authorization: Bearer <JOB_SECRET>" <production URL>/api/jobs/messaging-config` (the secret from Vercel's production environment, typed, never pasted into a chat or a file in the repository).
5. Check the answer and the Hub: the health banner shows no "Smart Encoding is on" or "allows texts to countries other than Canada" line within a few minutes. If the check could not read a setting, it is never taken as right: fix it before resuming.
6. If the inbound webhook or opt-out settings changed, IT texts HELP and then YES from a staff phone that is on no list and checks the answers.
7. The Admin resumes texts and checks **See sending progress** of anything that was waiting.
8. Write the change, who made it and when in this week's notes (`docs/procedures/weekly-notes/`).
