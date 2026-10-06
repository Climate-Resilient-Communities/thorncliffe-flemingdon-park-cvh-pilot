# The end of the pilot: asking subscribers, then deleting everyone else

**Owner:** Hub Admin lead (the campaign and the final report); IT lead (the jobs and the secrets)
**Last reviewed:** 2026-10-06

At the end of the pilot every subscriber is asked by text whether to keep getting alerts (S09.07). Those who reply YES by the deadline stay. Everyone else
is deleted by the purge after the deadline, as the text told them (S09.08). The campaign is started from the Hub's **End of the pilot** page
(`/staff/campaign`, not in the menu: type the address), by an Admin signed in with the authenticator code. The purge needs no one: it runs by itself.
This page holds no phone number, name or secret; write counts and dates only.

## Before (by day 55)

1. **Native readers** check the campaign texts (the campaign text, "You will keep getting CVH alerts", "The CVH pilot has ended", "sign-ups are paused") and
   the terms page's "Resident data deleted" line in every language. They were written by AI and are marked for review in the string files. A fix goes in a
   pull request before the rehearsal.
2. **IT** schedules the two jobs in production, once, as `docs/config.md` shows: `cvh-campaign-end` (the end of the campaign) and `cvh-end-of-pilot-purge`
   (the purge). Both do nothing until there is a campaign.
3. **An Admin** opens **End of the pilot** and presses **Rehearse on the drill roster**. Every phone on the **Drill roster** gets exactly the text subscribers
   will get, in its language. Check each one arrived and reads well; the page shows the texts' outcome. Write the rehearsal in the record below (and in the
   rehearsal log, `docs/procedures/rehearsals.md`).

## Start the campaign (by day 60)

1. Open **End of the pilot**. Read the deadline (the end of that day in Toronto, 30 days from today), the subscribers who will be asked, by language, and the
   estimated cost. If the page says the texts take the month past the spending cap, they are still sent: follow the cap overrun procedure afterwards.
2. Tick "I have checked the rehearsal, the deadline, the number of subscribers and the cost" and press **Start the campaign**.
3. Read the answer: how many were asked, how many texts are queued and how many pending sign-ups were deleted. Sign-ups are now paused everywhere ("Sign-ups
   are paused while the pilot ends").
4. If the page says the deadline changed (it was opened before midnight), read the new deadline and start again.
5. Write the start and the deadline in the record below.

## While it runs

- The page shows how many have replied YES and how far the texts have gone. A resident who replies YES before the deadline stays and is told so; STOP still
  deletes them at once.
- Nobody cancels the campaign from the Hub. If it must stop, the owner does it (`docs/config.md`, "Cancelling"), and the purge then does not run.

## The deadline and the purge

1. At the deadline, subscribers who have not replied stop receiving anything at once. A YES after it is answered "The CVH pilot has ended; your number was not
   kept" and changes nothing.
2. Within 15 minutes the campaign shows as ended on the page (the end job counts who stayed and who did not reply), and the purge begins 5 minutes after
   that: it never starts before the end job has run. It deletes each subscriber who did not reply YES the way STOP does, a few hundred a minute; a long list
   takes a few runs, 15 minutes apart. Nobody needs to do anything.
3. **IT** checks that it completed: in the Supabase SQL editor, `select at, detail from ops_event where kind = 'campaign.purge_completed'` gives the time, how
   many were deleted and how many stayed. The terms page (`/en/terms`) then states "Resident data deleted" with the date.
4. If the health banner says a scheduled job failed around then, the purge could not delete someone: IT looks in the logs for `purge.subscriber_failed` (it
   names the error's kind only), fixes the cause, and the next run deletes them. The purge records its completion only once no one is left.
5. **IT** unschedules both jobs: `select cron.unschedule('cvh-end-of-pilot-purge')` and `select cron.unschedule('cvh-campaign-end')`.

## The final report (Hub Admin lead, with IT)

1. Write the counts from step 3 above (deleted, stayed) in the report and in the record below. No names, no numbers.
2. The staff audit trail and the measures are kept: the purge deletes none of them (the Hub's Measures page, the weekly review from
   `scripts/export-weekly`, the usage counts and the texts already sent stay; sent texts no longer name anyone). How far corrections reached is counted
   from who received each text, which the deletions forget, so the database kept it as it stood when the purge began (`correction_reach_kept`): the
   Measures page shows those figures, not a count of the few who stayed.
3. Check the terms page states the date in English and in one right-to-left language (`/ur/terms`).
4. **IT** rotates the secrets at pilot end, following the "At pilot end" steps of `docs/procedures/rotate-secrets.md` (S09.03), writes the rotation in that
   page's rotation record, and writes the date here.
5. Sign-ups stay paused. An Admin reopens them only when the MVP is ready, with **Reopen sign-ups for the MVP** on **End of the pilot**.

## End-of-pilot record

| Step | Date | Who (role) | Outcome |
| --- | --- | --- | --- |
| Native readers checked the texts and the terms line | | | |
| Jobs scheduled (`cvh-campaign-end`, `cvh-end-of-pilot-purge`) | | | |
| Rehearsal on the drill roster | | | |
| Campaign started (deadline) | | | |
| Purge completed (deleted, stayed: from `campaign.purge_completed`) | | | |
| Terms page states the date | | | |
| Jobs unscheduled | | | |
| Secrets rotated at pilot end (`docs/procedures/rotate-secrets.md`) | | | |
| Final report written | | | |
