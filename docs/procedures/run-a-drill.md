# Running a drill

**Owner:** Hub Admin (drill lead); the approver is a second Coordinator or Admin
**Last reviewed:** 2026-10-06

A drill rehearses a real alert on the live system with staff phones only. It is marked as an exercise on every screen and first in every text, is never shown on the web app, and reaches no one but the phones on the drill roster. Drill counts are kept apart from real alerts. Only an Admin signed in with the authenticator code can start one.

## Before the drill (Admin)

1. Open **Drills** (Administration, `/staff/drills`) and press **Open the drill roster** (`/staff/drills/roster`).
2. Under **Add a phone**, add each staff phone that takes part: **Name or role** (for example "Hub phone"), **Mobile number**, **Language of the drill text**; press **Add phone**. Only the last four digits are shown afterwards. Use a spread of languages so the drill checks the translations.
3. Remove phones of people who are no longer taking part (**Remove**). The roster has at most 20 phones.
4. Tell everyone on the roster when the drill runs and that each text starts with the exercise marker.

## Run it

1. On **Drills**, press **Start a drill**. On **Start a drill** (`/staff/drills/start`), answer the three questions as for a real disruption and press **Continue to the drill acknowledgement**.
2. Write, **Save draft** and **Submit for approval** exactly as for an alert ([writing and approving an alert](write-and-approve-an-alert.md)). The composer shows the exercise marker.
3. A second Coordinator or Admin finds it on **Right now**, in the **Drills** section (drills are never listed with real alerts), presses **Review** and approves it on **Approve an alert**, which says **This is a drill. It never reaches residents.** The page ends on **Practice publish: nothing was sent to residents**.
4. A full production drill (the launch rehearsal) also covers an update, a correction and a final: on **Right now**, under **Drills**, use the drill's own **Add an update**, **Correct an entry** and **Mark resolved**, each written and approved as for an alert.

## Check what happened

1. On **Drills**, under **Recent drills**, read **What happened to the texts** for each entry, roster phone and language: **Handed off**, **Delivered**, **Undelivered**, **Failed**, **Unknown**, **Still waiting to be sent**, **Never sent**.
2. Each roster phone confirms it got each text, in its language, with the marker first. Note any that did not.
3. An **Unknown** text may or may not have arrived: find out what happened before launch (IT checks the message in Twilio's logs). A drill's texts are not resent from the Hub.
4. Record the drill in the [rehearsal log](rehearsals.md): date, who, what worked, what did not. Fix this page if a step did not work.
