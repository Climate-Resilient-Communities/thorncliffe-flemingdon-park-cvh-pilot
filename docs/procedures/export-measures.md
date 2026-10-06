# Exporting the pilot measures

**Owner:** Hub Admin lead runs the export; IT lead holds the environment file; Hub Coordinator records the translation survey
**Last reviewed:** 2026-10-06

The pilot measures (PRD section 9) are what the Hub's leadership uses at the week-8 go / no-go review: subscribers and installs; acknowledgement, approval and delivery times; check-ins; directory, map and search use; translation fallbacks and the translation survey; corrections and their reach; drills; cost per alert and total spend; coverage. The Hub's **Pilot measures** page (`/staff/measures`) shows some of them to Coordinators, Directors and Admins, read-only; the full set is a file an Admin writes with `scripts/export-measures`, daily and for the review. Nobody can change a measure, on the page or in the file.

The export writes two files for the day (Toronto): `pilot-measures-{day}-{edition}.csv` (for a spreadsheet) and `pilot-measures-{day}-{edition}.html` (open it in a browser and print it, or save it as PDF). There are two editions:

- **director**: the Admin and Director edition, with spend and cost per alert. Share it only with Admins and Directors.
- **coordinator**: the Coordinator edition, without spend and cost per alert.

Counts only: a count of 1 to 4 reads "fewer than 5", a percentage made from one reads "not shown", more figures read "not shown" where the totals and the other figures would give a hidden one away, and a total of fewer than 5 is not broken down. Check-ins are given for the pilot to date (asked for, and how each request ended) and per closed round (asked for, by building and floor). Drills are at the end, apart. The files hold no phone number, name, subscriber id or message text.

## Each day (Admin, with IT)

1. IT gives you production's environment file for the session (`vercel env pull --environment=production .env.production.local`), on a computer only Hub staff use.
2. Run the Admin and Director edition: `node --env-file=.env.production.local scripts/export-measures --edition director --out-dir <a folder only Admins and Directors can open>`.
3. Run the Coordinator edition: `node --env-file=.env.production.local scripts/export-measures --edition coordinator --out-dir <the Coordinators' folder>`.
4. Read what the script prints: the files it wrote, and how many alerts sent for a rehearsal it left out. If it says an entry listed in the rehearsal log was not found, check the id in [the rehearsal log](rehearsals.md) ("Alerts sent for a rehearsal") against the alert in the Hub.
5. Open the `.html` file and check the date at the top and the edition under it.
6. Delete the environment file. Keep the day's files in their folders; never post them in a chat or email them outside the Hub.

If the script refuses to run, it says why: a file it reads has a mistake (it names the file and the line: correct it and run it again), the environment file is missing or not production's, or the role policy no longer matches the editions (tell IT: the script must change with the policy).

## For the week-8 review (Admin lead)

1. On the morning of the review, run both editions as above, with `--week <the Monday of the last complete week>` if the review wants a week other than the last complete one (installs, directory and map use and search are given for that week and for the pilot to date).
2. Print or save as PDF the Admin and Director edition's `.html` for the Directors and Admins; the Coordinator edition for everyone else at the review, the Community Experts Board included (spend is seen by Admins and Directors only).
3. Write the review's decision and actions in this week's notes (`docs/procedures/weekly-notes/`).

## Alerts sent for a rehearsal

1. A real (non-drill) alert sent only to rehearse, such as the resend rehearsal before launch ([resending texts that failed](resend-failed-texts.md)), is listed by its alert entry id in [the rehearsal log](rehearsals.md), "Alerts sent for a rehearsal", the day it is sent. The export refuses a row without the entry id, so a rehearsal is never counted by mistake.
2. The export leaves every alert listed there out of every measure about alerts (times, check-ins, translation, corrections and their reach, cost per alert) and says how many. The money it cost stays in the total spend, because it was spent.

## Recording the translation survey (Coordinator)

The survey asks residents and ambassadors, in their language, whether they understood a translated alert. Its counts are kept in `docs/procedures/survey-results.csv`, which the export reads.

1. After each round of asking, add one line per language to `docs/procedures/survey-results.csv`: `date,lang,asked,understood`, for example `2026-10-20,ur,12,9` (the day, the language code as the Hub uses it: `ur`, `ps`, `tl`, `prs`, `gu`, `ta`, `el`, `sk`, `bn`, `hi`, `pa`, `zh`, `zh-Hant`, `es`, `fr` or `en`; how many were asked; how many understood).
2. Write counts only: never a name, a number, a building, a note or a quote. The export refuses a file with anything else in it, a language code it does not know, or more understood than asked, and says which line.
3. Change the file in a pull request (or ask the Admin lead to), so each change is reviewed. The export adds up every line of a language; to correct a line, change that line.
