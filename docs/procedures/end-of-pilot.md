# The end of the pilot: asking subscribers, then deleting everyone else

**Owner:** Hub Admin lead (the campaign and the final report); IT lead (the jobs, Twilio's replies, deleting the texts from Twilio and the secrets)
**Last reviewed:** 2026-10-06

At the end of the pilot every subscriber is asked by text whether to keep getting alerts (S09.07). Those who reply YES by the deadline stay. Everyone else is deleted by the purge after the deadline, as the text told them (S09.08). The campaign is started from the Hub's **End of the pilot** page (`/staff/campaign`, not in the menu: type the address), by an Admin signed in with the authenticator code. The purge needs no one: it runs by itself. This page holds no phone number, name or secret; write counts and dates only.

## Before (by day 55)

1. **Native readers** check the campaign texts (the campaign text, "You will keep getting CVH alerts", "The CVH pilot has ended", "sign-ups are paused") and the terms page's "Resident data deleted" line in every language. They were written by AI and are marked for review in the string files. A fix goes in a pull request before the rehearsal.
2. **IT** schedules the two jobs in production, once, as `docs/config.md` shows: `cvh-campaign-end` (the end of the campaign) and `cvh-end-of-pilot-purge` (the purge). Both do nothing until there is a campaign.
3. **An Admin** opens **End of the pilot** and presses **Rehearse on the drill roster**. Every phone on the **Drill roster** gets exactly the text subscribers will get, in its language. Check each one arrived and reads well; the page shows the texts' outcome. Write the rehearsal in the record below (and in the [rehearsal log](rehearsals.md)).

## Start the campaign (by day 60)

1. Open **End of the pilot**. Read the deadline (the end of that day in Toronto, 30 days from today), the subscribers who will be asked, by language, and the estimated cost. If the page says the texts take the month past the spending cap, they are still sent: follow [a spending cap overrun](cap-overrun.md) afterwards.
2. Tick "I have checked the rehearsal, the deadline, the number of subscribers and the cost" and press **Start the campaign**.
3. Read the answer: how many were asked, how many texts are queued and how many pending sign-ups were deleted. Sign-ups are now paused everywhere ("Sign-ups are paused while the pilot ends").
4. If the page says the deadline changed (it was opened before midnight), read the new deadline and start again.
5. **IT**, the same day: Twilio answers START and HELP itself, and its replies carry the sign-up link, which is now refused. In the Twilio Console (the Messaging Service's Opt-Out Management) set both replies to the paused wording in `docs/config.md` ("The end-of-pilot re-consent campaign", Twilio's START and HELP replies), following [changing Messaging Service settings](messaging-service-change.md): texts are paused while it is changed, so the campaign's texts wait a few minutes and then go.
6. Write the start and the deadline in the record below.

## While it runs

- The page shows how many have replied YES and how far the texts have gone. A resident who replies YES before the deadline stays and is told so; STOP still deletes them at once.
- Nobody cancels the campaign from the Hub. If it must stop, the owner does it (`docs/config.md`, "Cancelling"), and the purge then does not run.

## The deadline and the purge

1. At the deadline, subscribers who have not replied stop receiving anything at once. A YES after it is answered "The CVH pilot has ended; your number was not kept" and changes nothing.
2. Within 15 minutes the campaign shows as ended on the page (the end job counts who stayed and who did not reply), and the purge begins 5 minutes after that: it never starts before the end job has run. It deletes each subscriber who did not reply YES the way STOP does, a few hundred a minute; a long list takes a few runs, 15 minutes apart. Nobody needs to do anything.
3. **IT** checks that it completed: in the Supabase SQL editor, `select at, detail from ops_event where kind = 'campaign.purge_completed'` gives the time, how many were deleted and how many stayed. The terms page (`/en/terms`) then states "Resident data deleted" with the date.
4. If the health banner says a scheduled job failed around then, the purge could not delete someone: IT looks in the logs for `purge.subscriber_failed` (it names the error's kind only), fixes the cause, and the next run deletes them. The purge records its completion only once no one is left.
5. **IT** unschedules both jobs: `select cron.unschedule('cvh-end-of-pilot-purge')` and `select cron.unschedule('cvh-campaign-end')`.

## Delete the pilot's texts from Twilio (IT)

The purge deletes everything the CVH holds about the residents who did not stay, and their past texts in the CVH's database lose their recipient and their words (alerts and the end-of-pilot question, the same text everyone got, keep theirs). The check-in escalation texts to the on-call Admins ("Needs help: {building}, floor {n}") already lost their words 23 hours 45 minutes after they were sent. **Twilio keeps its own copy** of every text it sent and received, in its message log: the resident's phone number, the words of each text (the building and floor a menu saved, the edit links) and every reply the resident sent, STOP included. The database still holds each text's Twilio message id (the monthly price reconciliation matches Twilio's prices with it), and that id leads to the copy in Twilio. So Twilio's copies are deleted once the purge and the reconciliation no longer need them. The terms page tells residents this ("Twilio's copies ... stay until the Hub deletes them from Twilio after the pilot ends").

**When:** after both of these, so in the month after the purge:

- the purge completed (step 3 of "The deadline and the purge": `campaign.purge_completed` is recorded), and
- every month with pilot texts is reconciled: **Spend** shows the month of the purge, and every month before it, at actual prices, not "Pending reconciliation" ([a spending cap overrun](cap-overrun.md), "After each month ends"). The reconciliation reads Twilio's message log for the prices: a month whose messages were deleted before it was reconciled stays pending for good.

**What:** every message in the CVH's Twilio account sent or received on or before the day the purge completed, outbound and inbound. The messages of the subscribers who stayed go too: the CVH never reads Twilio's log for anything else. Nothing the CVH needs is lost: the database keeps the counts, the spend and the texts' outcomes.

**How**, with the Twilio CLI signed in to the CVH's account (`twilio profiles:list` shows which) in a terminal on IT's own machine, never in a shared log. `DAY_AFTER` is the day after the purge completed (YYYY-MM-DD); Twilio's filter takes the messages sent before it:

```sh
twilio api:core:messages:list --date-sent-before DAY_AFTER --limit 1000000 --properties sid -o tsv \
  | grep -E '^(SM|MM)[0-9a-f]{32}$' > /tmp/cvh-twilio-sids.txt
wc -l < /tmp/cvh-twilio-sids.txt
while read -r sid; do twilio api:core:messages:remove --sid "$sid" || echo "not deleted: $sid"; done < /tmp/cvh-twilio-sids.txt
rm /tmp/cvh-twilio-sids.txt
```

The list holds message ids only, never a number or a body. Each `remove` is the Messages API's `DELETE /2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}.json`, which deletes the message, inbound or outbound, with its body and numbers. A message still on its way cannot be deleted: run the loop again the next day for any id it printed. Then check that nothing is left: the first command, run again, lists no id; in the Twilio Console, **Monitor > Logs > Messaging** for those dates shows nothing. Write the count deleted and the date in the record below.

Twilio's opt-out list (Advanced Opt-Out: the numbers that texted STOP) is not a message and stays: it is what keeps Twilio from texting a number that said STOP.

## The final report (Hub Admin lead, with IT)

1. Write the counts from step 3 above (deleted, stayed) in the report and in the record below. No names, no numbers.
2. The staff audit trail and the measures are kept: the purge deletes none of them (the Hub's Measures page, the weekly review from `scripts/export-weekly`, the usage counts and the texts already sent stay; sent texts no longer name anyone, and the escalation texts to the on-call Admins keep no building or floor). How far corrections reached is counted from who received each text, which the deletions forget, so the database kept it as it stood when the purge began (`correction_reach_kept`): the Measures page shows those figures, not a count of the few who stayed.
3. Check the terms page states the date in English and in one right-to-left language (`/ur/terms`).
4. **IT** rotates the secrets at pilot end, following the "At pilot end" steps of [rotating secrets](rotate-secrets.md), writes the rotation in that page's rotation record, and writes the date here.
5. Sign-ups stay paused. An Admin reopens them only when the MVP is ready, with **Reopen sign-ups for the MVP** on **End of the pilot**. **IT** then puts the sign-up link back in Twilio's START and HELP replies, the same way as in step 5 of "Start the campaign".

## End-of-pilot record

| Step | Date | Who (role) | Outcome |
| --- | --- | --- | --- |
| Native readers checked the texts and the terms line | | | |
| Jobs scheduled (`cvh-campaign-end`, `cvh-end-of-pilot-purge`) | | | |
| Rehearsal on the drill roster | | | |
| Campaign started (deadline) | | | |
| Twilio's START and HELP replies set to the paused wording | | | |
| Purge completed (deleted, stayed: from `campaign.purge_completed`) | | | |
| Terms page states the date | | | |
| Jobs unscheduled | | | |
| Pilot's texts deleted from Twilio (count deleted; after the purge and the last month's reconciliation) | | | |
| Secrets rotated at pilot end ([rotating secrets](rotate-secrets.md)) | | | |
| Final report written | | | |
| Sign-ups reopened for the MVP, and the link back in Twilio's START and HELP replies | | | |
