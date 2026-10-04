# Weekly reliability notes

One file per week, named `{week}.md` (the Monday of the week, `YYYY-MM-DD`, Toronto time).

Each file holds:

- Issues: what the weekly review showed (health conditions, failed texts, resends, pauses, cap overruns, translation fallbacks, publish failures, slow deliveries, late access requests).
- Actions: what will be done, with an owner for each.

To produce the review for the meeting, run `node --env-file=<env file> scripts/export-weekly` (a week may be given; the default is the last full week) and open the CSV in a spreadsheet.

The notes hold no personal data: no phone numbers, names or message texts.
