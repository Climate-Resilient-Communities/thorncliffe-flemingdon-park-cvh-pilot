# CVH Pilot PRD — Addendum

Technical direction and supporting detail given by the product owner that belongs to architecture rather than the PRD. Inputs for `bmad-architecture`.

## Stated technology choices (pilot)

| Concern | Choice | Notes for architecture |
|---|---|---|
| Hosting | Vercel | Default function region is in the US; acceptable for the pilot (P9). |
| Data store | Supabase, if data collection is needed | A Canadian region is available and would ease the MVP move to Canadian residency. Holds subscribers, accounts, buildings, providers, alerts, audit trail. |
| SMS | Twilio, small pilot budget | Two-way SMS needed for double opt-in, STOP and keywords. Non-Latin scripts (Urdu, Pashto, Dari, Bengali, Tamil, Gujarati, Punjabi, Hindi, Greek, Mandarin) use UCS-2 encoding: 70 characters per segment instead of 160, so cost per alert varies by language. |
| Translation | **Cohere models only**, routed by language (see "Translation routing") | Product owner decision 2026-10-01: no non-Cohere translation service. Command A Translate officially covers 7 of the 15 languages; North Small Translate handled Pashto and Dari in a hands-on test; Tiny Aya (on the Cohere API) lists the South Asian languages, Tagalog and Slovak. |
| Search matching | **Cohere multilingual embeddings** (embed-multilingual-v3; Embed 5 once its language list is confirmed) | Officially lists 13 of 15 languages (not Pashto; Dari only as Persian). |
| Resident client | Installable web app (PWA) | Web push on iPhone works only after the app is added to the Home Screen (iOS 16.4+). Push is a stretch goal. |
| Directory search | **In-memory search over a generated JSON file** | See the design below. No Elasticsearch, OpenSearch or vector database. |
| Sharing | Web Share API and WhatsApp share links | Covers WhatsApp chats and Status without the WhatsApp Business API. |
| Map | Neutral open base map (e.g. OpenStreetMap tiles) with marker clustering | Google Maps is not embedded. |

## Translation routing (Cohere only)

| Language | First choice | Second choice | Basis |
|---|---|---|---|
| Pashto, Dari | north-small-translate-09-2026 | Command A Translate (Dari only) | Product-owner test: North was the only model producing real Pashto; Command A Translate returned Dari for Pashto |
| English, French, Spanish, Chinese, Greek, Hindi | Command A Translate | North Small Translate | Officially supported by Command A Translate (23 languages) |
| Urdu, Tagalog, Gujarati, Slovak, Bengali, Tamil, Punjabi | North Small Translate, **if on its 50-language list** | Tiny Aya Fire (Urdu, Hindi, Bengali, Gujarati, Tamil, Punjabi) or Tiny Aya Water (Tagalog, Slovak) via the Cohere API | Not supported by Command A Translate. Tiny Aya lists them (vendor-reported Flores chrF 0.32–0.56) but is CC-BY-NC; confirm non-commercial use is allowed for the Hub |

- **To confirm before build:** the exact 50-language list of north-small-translate-09-2026. If it covers all 15, use it as the first choice everywhere and keep the others as second choices; one model is simpler to test and operate.
- **Language check on every output.** Detect the language and script of each translation before it is published or sent (Command A Translate's Pashto→Dari swap shows this failure happens silently). On failure, try the second choice; if both fail, show the English original labelled "Translation not available".
- **Pricing.** Per-token prices for Command A Translate, North Small Translate and Tiny Aya on the API were not found on Cohere's pricing page; confirm with Cohere. Trial keys cannot be used in production.
- **Test set.** The pilot's translation tests (native-speaker review) cover every language on its routed model, and are re-run whenever a model version changes.

## Directory search design (from research)

Source: `docs/research/multilingual-program-search/research.md`.

- **Publish step.** When the Hub publishes provider changes in Supabase, a job translates each listing into the 15 languages, embeds each English description once, and writes one JSON file: listings in every language plus one vector per provider (about 100 vectors; well under a few MB). The file is deployed with the app or fetched once and cached.
- **Question time.** The function holds the JSON in memory.
  1. Embed the question as typed (one call).
  2. If the question is detected as Pashto or Dari, or romanized or mixed-language, also translate it to English with the routed Cohere model (in parallel) and embed the translation.
  3. Compare against the ~100 vectors in memory and merge rankings (reciprocal rank fusion) when there are two.
  4. Return the top three to five listings in the resident's language, straight from the JSON. **Nothing is translated back at question time.**
- **No match.** Below a similarity threshold, return "no clear match" with categories and the Hub's number.
- **No generated answers** in the pilot (safety: NYC MyCity incident; Government of Canada GenAI guidance).
- **Latency.** One network call for 13 of 15 languages, two for the rest. Call latencies were not measured in research; log them per question.
- **Test set.** About 150 real questions (10 per language, including romanized Urdu and Hinglish), each with an expected provider; compare with and without the translation leg before launch.
- **Supabase** stays the editing store. Use Pro or a keep-alive, because free projects pause after 7 days without activity.
- **Tiny Aya** (open weights, offline, 70+ languages, no Pashto, non-commercial licence) is an MVP candidate for on-device translation, not a pilot component.

## MVP direction (for later)

- Native iOS and Android apps; email channel.
- Canadian data residency for storage and processing; Twilio and other non-Canadian processors to be re-evaluated.
- Evaluate open-EWS (multi-channel alerting) and ADMS (directory data model) before MVP build.

## Seed data

### Buildings — `data/seed/apartment_building_reg.geojson`

City of Toronto Apartment Building Registration extract, 103 point features (CRS84), 70 attributes each.

- Pilot set: postal area M4H (32 buildings, 5,734 units, ward 15) and M3C (11 buildings, 2,741 units, ward 16) = 43 buildings, 8,475 units.
- Outside the pilot: M4A (32), M4C (16), M1R (10), M1L (1), no postal code (1, 5 Deauville Lane, whose neighbourhood should be checked).
- Useful fields: `SITE_ADDRESS`, `CONFIRMED_STOREYS`, `CONFIRMED_UNITS`, `NO_OF_ELEVATORS`, `ELEVATOR_STATUS`, `IS_THERE_EMERGENCY_POWER`, `IS_THERE_A_COOLING_ROOM`, `AIR_CONDITIONING_TYPE`, `BARRIER_FREE_ACCESSIBILTY_ENTR`, `PROP_MANAGEMENT_COMPANY_NAME`, `PROPERTY_TYPE`, `RSN` (stable registration number, a good building key), `LATITUDE`, `LONGITUDE`.
- Data notes: duplicate address "85-95 Thorncliffe Park Dr"; several duplicate column variants with null values (e.g. `NO_OF_STOREYS` vs `CONFIRMED_STOREYS`).
- Floors are derived from `CONFIRMED_STOREYS`; the Hub confirms them.

### Providers — `data/seed/TPCH_Community_Assets_v2.csv`

134 rows, one per organization per category: 97 distinct organizations at 99 locations. Columns: Category, Subcategory, Organization, Street Address, City, Postal Code, latitude, longitude, Phone Number, Email Address, Social Media, Website, Day-to-Day Services & Programs, Emergency Services & Role.

- Data model implication: provider (1) — locations (n) — categories (n). The two description columns belong to the provider (identical across its rows except for one organization), not to the category row.
- Day-to-Day Services & Programs: filled for all rows, median about 360 characters, up to about 820. Free text; hours appear in about 14 rows and languages served in about 5, not as structured fields.
- Emergency Services & Role: 52 rows describe a role; 82 read "No emergency-specific services listed."
- Translating about 100 descriptions into 14 languages is a one-off batch job; cache the results and re-translate only when a description changes.
- Research notes in 35 rows and 18 rows marked unconfirmed must be cleaned or held back before loading; the loader should support a "published" flag per provider.
- 40 organizations at 45 Overlea Boulevard; map needs clustering.
- Quality issues listed in PRD Section 10.

## Data the pilot stores centrally

| Entity | Fields | Personal? |
|---|---|---|
| SMS subscriber | phone number, language, neighbourhood, building (optional), floor (optional), groups (optional), check-in request and contact method (optional), opt-in confirmation time | Yes (phone number) |
| Staff / ambassador account | name, sign-in identity, role, assigned buildings and floors | Yes (staff) |
| Building | RSN, address, coordinates, storeys, facts, last updated | No |
| Provider | name, locations, categories, contacts, last confirmed | No (organizational) |
| Alert | text, translations, audience, channels, author, approver, valid until, drill flag, corrections | No |
| Check-in record | subscriber, alert, status | Yes, deleted when the alert closes |
| Audit event | actor, action, time | Staff only |

Residents who do not sign up for SMS have nothing stored centrally; their choices live in the browser's local storage.
