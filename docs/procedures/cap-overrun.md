# A spending cap overrun

**Owner:** Hub Admin on call (with the Director for the budget)
**Last reviewed:** 2026-10-06

The monthly cap on text messages warns and never blocks: alerts, corrections, replies to STOP and on-call texts keep going out when it is passed. An overrun is recorded when an approval (or a resend) takes the month's text spending, plus the texts still waiting, past the cap. The pilot budget is CAD 1,000.

## How you hear about it

- Before approving, the approval page says the alert would go over the monthly cap, and by how much.
- When it happens: one text to the on-call Admins, and on every Admin and Coordinator screen the health banner "An approval this month went over the monthly text message spending cap. Texts keep sending." until the month ends (Toronto time).

## What to do (Admin)

1. Do not hold back an alert residents need because of the cap. Never pause texts to save money.
2. Open **Spend** (`/staff/spend`). Read **This month** and **The pilot to date** under **Text messages** and **Cohere (translation and search)**, and **Pilot budget** ("Budget ... Counted so far ... left").
3. Find out why: one large alert (a neighbourhood-wide alert to every subscriber), many updates, resends, or sign-up and reply texts (the health banner's "daily limit" means someone may be misusing the sign-up form: follow [a health alert](health-alert.md)).
4. Tell the Director the amount over the cap and what is left of the budget, the same day.
5. Decide with the Director:
   - the cap was too low for a real emergency: under **Monthly cap on texts**, type the new **Monthly cap (CAD)** and press **Save cap** (it is audited with the old and new amounts); or
   - keep the cap and write fewer or narrower updates for the rest of the month (choose buildings or groups instead of a whole neighbourhood when that is right).
6. Write the overrun and the decision in this week's notes (`docs/procedures/weekly-notes/`); the weekly review lists each overrun with its amount.

## After each month ends

1. A few days after the month ends (Toronto time), IT checks the month's reconciliation is complete: **Spend** shows the month's text messages as actual prices, not "Pending reconciliation". If it is still pending, IT runs the reconciliation by hand (`docs/config.md`, "What each text costs, and the reconciliation") and checks it again once Twilio has priced the last messages.
2. IT compares the month's count and total with Twilio's usage page.
