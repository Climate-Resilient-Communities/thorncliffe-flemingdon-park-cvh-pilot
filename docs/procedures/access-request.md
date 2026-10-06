# A resident access request

**Owner:** Hub Admin (privacy contact) handles the request; IT lead runs the script
**Last reviewed:** 2026-10-06

A resident may ask what the CVH holds about their phone number, ask to correct it, or ask for it to be deleted (PIPEDA). It is answered **within 30 days**. The pilot has no screen for it (the access-request screen is the MVP's): an Admin verifies that the person controls the number by calling it back, and IT runs `scripts/access-request` with production's environment. Each request is recorded in the audit trail with its dates, its outcome and the Admin, **never the number**, and the weekly review flags a request open longer than 25 days.

The script, for IT (`node --env-file=.env.production.local scripts/access-request` with no command prints its help):

- `receive --admin <username> --request access|correction|deletion` records a request and prints its id;
- `list` shows the open requests and the days each has been open;
- `show --id <id> --verified-control` asks for the number at a prompt and shows what is held, on screen only (read-only, nothing saved);
- `delete --id <id> --admin <username> --verified-control` asks for the number, shows what is held for it (its last four digits, the subscriber, the pending sign-up), asks for the number again and for `DELETE`, and deletes everything held for it (the same deletion as a STOP), closing the request;
- `close --id <id> --admin <username> --outcome answered|not_verified|withdrawn` closes it.

The number is always typed at the prompt, never on the command line (it would stay in the shell's history). `show` and `delete` run only in a terminal with nothing redirected or piped (not `> file`, not `2> file`, not `| less`), and an error is printed by its code only, since a database error's text can quote the number. Delete the environment file after use.

## 1. Receive the request (Admin, the day it arrives)

1. Write down the date, the number the resident says is theirs and how to reach them, only where the request arrived (the privacy contact's mailbox or phone log). Never in the repository, the weekly notes, a chat or the Hub.
2. Ask IT to record it the same day: `receive --admin <your username> --request access` (or `correction`, `deletion`). Keep the request id it prints next to the resident's contact: it is the only link between them and the audit trail.

## 2. Verify control of the number (Admin)

1. Call the number the request is about yourself, from the Hub's phone; never use another number the person gives you to call instead. Ask the person who answers to confirm they made the request and what they asked for.
2. If they confirm, control is verified: go to step 3.
3. If the number cannot receive calls or texts any more, nobody answers after three tries on different days, or the person who answers did not make the request: control is **not** verified. Go to "Without verified control" below. Reveal nothing on these calls.

## 3. Answer it (Admin and IT, with verified control)

1. IT runs `show --id <id> --verified-control` on a screen only IT and the Admin can see, and types the number at the prompt.
2. The Admin reads it to the resident on a call back to the number: whether they are subscribed, since when and how, the language, the neighbourhood, the buildings and floors, the groups, the muted topics, the terms version they accepted, the retention state (whether they were asked at the end of the pilot and whether they replied YES), any open prompt (a deletion waiting for a second 0, a text menu and where they are in it, the offer of a link, or the end-of-pilot question and until when it can be answered), any link texted to change the subscription on the web (when it was asked for and whether it was used); any pending sign-up; texts held for them (dates, kinds, languages, outcomes: never their words, which the Hub cannot read back); keyed traces of the number kept for at most 24 hours (texts received, menus started, the sign-up link sent); check-in records. IT clears the screen afterwards; nothing is copied.
3. If the output says a check-in table exists that the script cannot read yet, or that the CVH holds more for the number than the script can read yet ("NOT SHOWN"), stop: do not answer the request as complete until IT has added it to the script.
4. **A correction**: the Hub cannot edit a subscription. Tell the resident how: reply **1** (building or floor) or **2** (language) to the CVH number and follow the text menu; a menu closed with nothing changed (reply **0** on its first page), or a reply 1 or 2 once the day's 5 menus are used, offers a link (reply **1**) to the resident's own web page, **Change your text alerts**, which works once, for 30 minutes, and changes the language, buildings, groups and muted topics (or deletes the subscription); or text **STOP** and sign up again on the web or with a staff member's help (**Text sign-up**, `/staff/text-signup`). While the end-of-pilot campaign runs sign-ups are paused, so only the menus and the link work then.
5. **A deletion**: IT runs `delete --id <id> --admin <your username> --verified-control` and types the number. The script shows the number's last four digits and what is held for it: the Admin checks the four digits against the number they called back, then IT types the number again and `DELETE`. Everything held for the number goes, at once and for good (the pilot keeps no backups); texts already sent keep no link to it; nothing more is sent to it. Tell the resident on the call that it is done. The request is closed as `deleted`. If the script refuses because check-ins exist that it cannot delete yet, nothing was deleted: ask IT to add them first.
6. Otherwise IT closes it: `close --id <id> --admin <your username> --outcome answered` (or `withdrawn` if the resident withdrew it).
7. Delete your note of the number and contact once the request is closed.

## Without verified control

The request is recorded (step 1, without the number). **Nothing is revealed and nothing is deleted.** Tell the person, in their language where you can, that the Hub can go ahead only when control of the number is shown, and offer these:

1. **A one-time phrase by text.** Give them a short phrase made up for this request only (three ordinary words, never STOP, START, HELP, YES or a digit), and ask them to text it to the CVH number from that phone within 7 days. The CVH keeps no words of the texts it receives, so IT checks for it in the Twilio Console (Monitor, Logs, Messaging, filtered by the number and the dates). If it arrived from that number, control is verified: go to step 3 of the answer above, calling the number back.
2. **STOP.** Texting STOP from that number deletes the subscription and everything held for the number at once, with no request needed.
3. **The end of the pilot.** Subscribers who do not reply YES to the end-of-pilot message are deleted after its stated deadline, with everything held for them ([the end of the pilot](end-of-pilot.md)).

If none of these is possible, or the 30 days are nearly up, IT closes the request: `close --id <id> --admin <your username> --outcome not_verified`.

## Each week

`list` (or the weekly review's `access_request_overdue` lines from `scripts/export-weekly`) flags a request open longer than 25 days: the Admin answers or closes it before day 30. A rehearsal's request is recorded with `--rehearsal` and reported apart.
