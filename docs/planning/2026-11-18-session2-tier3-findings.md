# Resident testing session 2: Tier 2 and 3 findings and proposals

Date: 2026-11-18. Source: the "Resident App Feedback" tab of "Functional Prototype Testing - Session #2" (consolidated by Helena Yu) and the fixes brief of 2026-11-18. This covers the items that needed a diagnosis, a decision or a proposal, not only a build. What was built is in the PR of the same date.

## #1 "Not receiving confirmation text after signing up for text alert"

**Confirmed cause and fix (2026-11-18, evening):** the Twilio Messaging Service "Resident Notifications", which every text goes through, had **no phone number in its sender pool**.
- Twilio refused all four test texts (3 on 2026-11-10, 1 on 2026-11-16) about 0.17 seconds after they were created, with error **21704** ("The Messaging Service contains no phone numbers"). The "From" field was empty and none reached a carrier.
- The toll-free verification itself was approved (2026-10-22), so 30032 was not the cause.
- **Fix:** the approved toll-free number was added as the service's only sender. In the same change, done by the procedure (texts paused, then resumed):
  - incoming messages were set to the app's webhook (they were "Defer to sender's webhook", so a YES would not have reached the app);
  - Smart Encoding was turned off;
  - Advanced Opt-Out was turned on, with YES removed from its default opt-in keywords;
  - SMS pumping protection was turned on.
- **Checked:** a test sign-up's YES reached the app, and the "You are signed up" reply was delivered within seconds.
- **Geo permissions:** these stay at Canada and the US, because Twilio cannot allow one without the other (both are +1). The daily settings check now accepts that, and the procedure says so.
- **Still to do:** the every-minute sending job (`cvh-dispatch`) is not scheduled yet; it waits for launch day (launch checklist). Until it is, a text that is not sent straight after a sign-up waits, and the Hub's "texts waiting" warning shows.

The diagnosis below was made before that, by reading the code and the Twilio notes only. **No text was sent.** Cause 2 (shared phones) still holds as a design point.

The app shows "Check your phone" for every accepted sign-up, by design: the answer is the same whether the number is new, already waiting for YES, or already subscribed, so that the page cannot be used to find out whether a number is signed up (AD-22). So "Check your phone" with no text does not mean a text was sent. There are four ways it can happen. The first two are the likely ones in a testing session:

1. **The toll-free number is not verified yet.** Twilio refuses every text from a toll-free number until its verification is approved: error 30032, shown on the Hub as `sender_not_ready` (`src/modules/messaging/domain/sendingProgress.ts`). The verification was rejected on 2026-10-13 and resubmitted after the fixes in `docs/twilio-toll-free-verification.md`. The repository does not record an approval. **Check first:** Twilio Console, Messaging, Regulatory compliance, Toll-free verifications, the status of the number. Then Monitor, Messaging logs, for the session's time: error 30032 on the confirmations confirms this cause.
2. **The same phone was signed up more than once.** A number that already has a pending sign-up (in its 48 hours) or is already subscribed gets **no new confirmation text** (`webSignup.ts`, step 4: the savepoint is rolled back for a pending or subscribed number). In a session where pairs share demo phones, only the first sign-up on each phone gets a text. The same applies if the first text was lost for any reason other than STOP (cause 1 included): signing up again sends nothing until the 48 hours are over, even though the page says "No text within 5 minutes? Text START ..., then sign up again".
3. **The phone had replied STOP to the number before.** Twilio's Advanced Opt-Out blocks it (error 21610). The app then deletes the pending sign-up, so that texting START and signing up again works, which is what the page says.
4. **Texts were paused** on the Hub, or the dispatcher job was not running. The Hub's sending progress and health banner show both.

**Proposal for cause 2** (not built: it changes what a re-sign-up does, so it needs the owner's decision):
- A sign-up for a number that is already pending, whose confirmation **failed or was never sent**, queues a new confirmation. The answer stays the same bytes (AD-22 holds). The per-client rate limit and the transactional daily ceiling still cap it.
- A pending number whose confirmation **was delivered** still gets nothing new, so a stranger cannot make the app text someone again and again.

**For the next session:** use one demo phone per pair, or delete the test numbers' pending sign-ups between rounds (S07.04 "delete my number" through the web link, or the Hub).

## #2, #12 Human verification on sign-up and "Add a place"

**Built, and off.** Cloudflare Turnstile, as the feedback suggested, behind two environment variables (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`; `docs/config.md`). With both unset, nothing changes: no widget, no token asked for, no Cloudflare origin in the CSP.

**Why off:**
- **Escalation, vendor account:** the Hub has no Cloudflare account. Someone at the Hub creates one (free), adds a Turnstile site for the production domain in "Managed" mode, and sets the two keys in Vercel. The secret key is a secret, so it goes in Vercel only, never in the repository.
- **Privacy decision (AD-3):** the widget runs in the resident's browser and sends Cloudflare browser signals and the resident's IP address. Cloudflare says it does not use them for advertising or tracking across sites. It is still a third party, outside Canada, seeing that this browser opened the sign-up form. The server's own check sends Cloudflare the token and the secret only, not the address. The Hub decides whether this is acceptable before turning it on. If it is, the terms page should name it.
- **Accessibility:** in "interaction-only" mode most residents see and do nothing. A resident Cloudflare is unsure of sees one checkbox. Cloudflare states the widget meets WCAG 2.1 AA, but it is only partly translated into the app's 15 languages ("auto" follows the phone's language).

**What protects the forms now, with it off:** a per-connection rate limit on both forms, a hidden honeypot field on "Add a place", the double opt-in on sign-up (no alerts until the phone's own YES), and the Hub's review of every suggestion.

**If Cloudflare is down:** the form goes through, logged as `*.human_check_unavailable`. A resident is never kept from alerts because a third party is down. Only a token Cloudflare says is not valid is refused, with "We could not check that a person is sending this. Wait a few seconds, then send again." The message is in all 15 languages, machine-drafted.

**Tested** on a local build with Cloudflare's published test keys, in a browser that loaded the real widget from Cloudflare:
- "always passes": the sign-up is accepted and the suggestion is sent with a token.
- "always fails": both forms show the message, and nothing is stored.
- The server's check against Cloudflare's real siteverify returned passed, failed, and failed for a used token.

## #3 "Nothing relevant came up when search 'need help with rent' in multiple languages"

Production, before this change:
- **English:** "need help with rent" and "I need help paying rent" returned one result, The Neighbourhood Organization (TNO: Toronto Rent Bank access centre). The scores were 0.295 and 0.311, just over the 0.27 line.
- **Chinese, Urdu, Tagalog, Bengali:** TNO first, then Don Valley Community Legal Services.
- **Spanish and French:** TNO and Don Valley Community Legal Services among the results, at lower scores (0.21 to 0.28).

So search found the right place, but weakly. Only TNO's listing mentions rent at all ("rent bank access", "housing assistance"), and the margin was thin. A tester in another language, or with other words, could easily land below it.

**Change:** a rent-help concept in search (`concept:rent-help` in `searchKeywords.ts`), like the cooling, eviction and seniors ones:
- **What it matches:** rent the resident cannot pay, is behind on or needs help with, against the listings' rent bank and housing assistance.
- **What it does not match:** "apartments for rent", or "parent" and "current".
- **Other languages:** they reach it through their English translation.
- **Test set:** 9 rent questions were added (en, zh, ur, es, fr, tl, bn, hi), expecting TNO's two listings.

**Not fixable in code:** the catalogue has few rent and housing listings. Toronto Rent Bank, the City's Housing Help Centres and the Landlord and Tenant Board are not in it. The Hub could add them, which is the real fix for "nothing relevant".

## #5 "The search results were ranked in alphabetical order but they should be ranked by relevance/capacity"

Where residents saw alphabetical order:
- **"Find help" with filters** (the directory, `listProviders` in `src/ui/directory/filters.ts`) lists the filtered providers alphabetically. Task 3's "filter housing and rent" is this list.
- **The search box** ranks by relevance already: the similarity of the meaning, plus the keyword and concept boost.

**Capacity:** no data on capacity exists, and the catalogue has no field for it. "Capacity" could mean three different things:
- how many people a place can serve;
- whether it has room today;
- how much it can do (a large agency, a volunteer group).

Only the last can be read from what exists: the new "Established service" or "Community group" label (#4).

**Proposal** (needs the Hub's decision; the brief's open question): in the filtered directory list, show established services first, then community groups, each alphabetical, with a heading over each group. This answers both "formal resources before grassroots" and "grassroots should be in a separate list" from the session notes. It is about 30 lines in `listProviders` and the list view, and it needs the providers re-seed (#4's `run_by`) to be live. Ranking a filtered list by relevance would need a question to be relevant to; the search box is that.

## #20 "Use more icons, colors, images and videos to guide/engage users"

**Done in this round:**
- the established and community marks (#4);
- the coloured public cooling spaces toggle (#9);
- the Aa button with two letter sizes (#13);
- the selected stage tab in the guides (#14).

**Proposals, in order of value for effort:**
1. **An icon for each category** on the directory's topic buttons and the map legend. There are 8 plain-named categories (#10), and the app already has an icon set for the bottom navigation. About 8 SVGs plus a lookup; no new data.
2. **One picture per Be Ready guide**, at the top: for example a thermometer and a water glass for heat. Simple drawings with no text, so one image serves every language. The Hub chooses or commissions them; the licence must allow use on the app.
3. **30-second videos or audio** for each guide ("what to do"), as the session suggested. They need a script per guide (the reviewed guide text), recording in each language by native speakers, captions, and hosting that works on a poor connection. They are not cached for offline use, because they are too large. This is content work for the Hub first, then a small player in the guide page.
4. **A short "How to use the app" tour:** three screens, shown once after the welcome. It is cheap to build, but every word must be translated and reviewed.

## #21 "Incorporate local preparedness toolkit into the app"

The repository and the Hub's shared drive hold **no local preparedness toolkit**. The drive search found the City of Vancouver's "Resilient Neighbourhoods Toolkit", which is about running neighbourhood workshops, not a resident's kit.

The prototype's own words refer to a printed one: R25.kit, "This guide matches the printed Local Preparedness Kit". So one may exist on paper or be planned.

**Proposal:**
- **Once the Hub shares the kit (PDF or Word):** its emergency kit list goes into the draft "Emergency kit" section (`docs/planning/2026-11-18-guide-content-draft.md`, #16). Its local contacts go into "Important numbers", and its situation pages are checked against the six guides, so the app and the paper say the same thing.
- **The printed kit itself:** a "Print or save this guide" button on each guide, giving a one-page printable version in the resident's language. That is the app feeding the paper kit, and it costs little.
- **Until the kit is shared:** nothing else to build.
