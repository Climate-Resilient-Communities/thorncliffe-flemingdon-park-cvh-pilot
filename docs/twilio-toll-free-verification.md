# Twilio toll-free verification

The toll-free number (TWILIO_FROM_NUMBER) sends nothing until Twilio approves its verification (every text fails with 30032 until then).

## History

- 2026-10-13: rejected (request HHeaac1567d7f9658109472928a504188e) with two reasons:
  - 30499, message content does not align with the use case or is incomplete;
  - 30505, agreeing to receive messages must be optional.

  Fixes in the app:
  - The sign-up form at `/en/text-alerts` has its own unticked box to agree to text alerts, separate from the terms box. The CTIA disclosures sit right under it, and a line says text alerts are optional and the app works without them.
  - Hub alerts name the sender in full, as "Thorncliffe Park Community Hub alert".

  Resubmit within 7 days (by 2026-10-20) to keep the priority queue.

## What to submit (Console → Messaging → Regulatory compliance → Toll-free verifications → Edit)

- **Use case category:** Public Service Announcement
- **Use case description:** Thorncliffe Park Community Hub, run by Sprout Climate Association, sends community safety alerts to residents of Thorncliffe Park and Flemingdon Park, Toronto, who choose to sign up. Alerts are about their building or neighbourhood: power, water or elevator outages, heat and air-quality warnings, evacuations. Hub staff check every alert before it is sent. No marketing or promotional content is ever sent. Signing up is optional: the web app, map and directory work fully without it.
- **Opt-in type:** Web form (also staff-assisted at the Hub desk, confirmed by the resident's own YES reply)
- **Opt-in workflow description:** The resident opens https://project-6qcs4.vercel.app/en/text-alerts, enters their phone number and neighbourhood, and ticks an unchecked box: "Yes, text me CVH alerts from the Thorncliffe Park Community Hub at this number." Directly under it the page says: "CVH text alerts from the Thorncliffe Park Community Hub. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to stop." The page also says text alerts are optional and the app can be used without signing up. A separate box accepts the terms and privacy page (https://project-6qcs4.vercel.app/en/terms). One confirmation text is sent. No alerts are sent unless the resident replies YES within 48 hours (double opt-in). Hub staff can start the same flow for a resident at the Hub desk, and the resident still has to reply YES from their own phone. Consent is not a condition of using any part of the service. Phone numbers and consent are never sold or shared for marketing.
- **Opt-in image URL:** a screenshot of `/en/text-alerts` showing the unticked box and the disclosures.
- **Privacy policy URL:** https://project-6qcs4.vercel.app/en/terms
- **Sample message 1:** CVH alerts from the Thorncliffe Park Community Hub: reply YES to confirm. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to stop.
- **Sample message 2:**

  ```
  Verified by the Hub
  Thorncliffe Park Community Hub alert
  Power is out on floors 4 to 6 at 10 Thorncliffe Park Dr. Toronto Hydro is on site.
  The Hub is not an emergency service. If someone is in danger, call 911.
  More: https://project-6qcs4.vercel.app/a/k3x9a2
  To stop all messages from the Hub, reply STOP.
  ```
- **Estimated monthly volume:** 1,000

STOP, START and HELP are answered by Twilio's Advanced Opt-Out (see procedures/messaging-service-change.md). Set its HELP reply to name the Thorncliffe Park Community Hub and give a contact.
