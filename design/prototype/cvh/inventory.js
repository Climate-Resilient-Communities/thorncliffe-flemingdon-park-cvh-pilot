/* Screen and flow inventory (brief Sections 4 and 5). Index and placeholders read this. */
window.CVH_INVENTORY = {
 "screens": [
  {
   "id": "R-01",
   "name": "Language selection (first run)",
   "stories": "3.2.2, 3.2.5, 3.1.7",
   "priority": "P1",
   "states": [
    "All fifteen launch languages in their own scripts, with no English-first ordering",
    "pre-selected from a printed notice or link",
    "selected",
    "basic mode settable here by a helper",
    "reached from a forwarded link by a first-time visitor"
   ],
   "app": "resident",
   "file": "R01_Language",
   "status": "done",
   "flows": [
    "F1",
    "F2",
    "F7",
    "F13"
   ]
  },
  {
   "id": "R-26",
   "name": "Which groups do I belong to?",
   "stories": "3.2.6, 3.7.1",
   "priority": "P1",
   "states": [
    "Four options with one line each",
    "none chosen",
    "one or more chosen",
    "skipped",
    "helper confirming the resident has agreed",
    "check-in chosen (continues to R-35, then R-33)"
   ],
   "app": "resident",
   "file": "R26_Groups",
   "status": "done",
   "flows": [
    "F1",
    "F2",
    "F12"
   ]
  },
  {
   "id": "R-35",
   "name": "Where I live — alerts for my building",
   "stories": "3.2.1, 3.1.2, 3.2.6, 3.7.1, 3.2.7",
   "priority": "P1",
   "states": [
    "Neighbourhood only",
    "building chosen (search at pilot scale)",
    "building and floor chosen",
    "building pre-selected from a printed notice",
    "skipped",
    "helper choosing with the resident's agreement",
    "continues to R-33 when check-in was chosen",
    "finished, with a summary and the invitation to set up text alerts, accepted (opens R-05) or declined"
   ],
   "app": "resident",
   "file": "R35_WhereILive",
   "status": "done",
   "flows": [
    "F1",
    "F2",
    "F12"
   ]
  },
  {
   "id": "R-02",
   "name": "Language control (overlay from anywhere)",
   "stories": "3.2.2",
   "priority": "P1",
   "states": [
    "Open",
    "changed and returned in place",
    "language not yet available"
   ],
   "app": "resident",
   "file": "R02_LanguageControl",
   "status": "done",
   "flows": [
    "F1",
    "F5"
   ]
  },
  {
   "id": "R-03",
   "name": "Home / Now",
   "stories": "All",
   "priority": "P1",
   "states": [
    "\"Get text alerts\" at the top until signed up",
    "Alerts now section — my building and floor first, then my neighbourhood",
    "Every day section — Find help, Map and Be ready as large labelled buttons, as easy to see as the alerts",
    "nothing active",
    "one active alert",
    "an official alert relayed alongside a community alert",
    "an ongoing alert that stays up across days",
    "seasonal heads-up card in season",
    "basic-mode variant drawn"
   ],
   "app": "resident",
   "file": "R03_Home",
   "status": "done",
   "flows": [
    "F1",
    "F2",
    "F3",
    "F11",
    "F13"
   ]
  },
  {
   "id": "R-34",
   "name": "What I have told the CVH",
   "stories": "3.2.6, 3.2.1, 3.7.1, 3.5.4, 3.2.5, 3.2.2, 3.2.7",
   "priority": "P1",
   "states": [
    "Reached from \"Tailored to your choices\"",
    "language",
    "building and floor",
    "basic mode",
    "groups chosen, with the check-in option in view",
    "check-in requested",
    "heads-up on",
    "each changeable or removable",
    "removed and confirmed",
    "nothing chosen",
    "text-alert invitation while not subscribed"
   ],
   "app": "resident",
   "file": "R34_MyChoices",
   "status": "done",
   "flows": [
    "F2",
    "F12",
    "F13"
   ]
  },
  {
   "id": "R-04",
   "name": "Text message specimen (device frame)",
   "stories": "3.2.1, 3.1.1–3.1.6, 3.2.6, 3.7.1, 3.2.7",
   "priority": "P1",
   "states": [
    "Lock screen",
    "level line on every message (official alert relayed from a named source, or community alert)",
    "official alert relayed, from the human-checked template",
    "community alert with origin and verified state",
    "acknowledgement",
    "update",
    "correction",
    "resolved with final entry",
    "nearest open space line",
    "confirmation request (double opt-in)",
    "keyword change to groups",
    "check-in withdrawal",
    "Urdu, Greek and English",
    "stop instruction visible",
    "at most one tailored line, after the action",
    "carries no targeting criteria in any state"
   ],
   "app": "resident",
   "file": "R04_TextMessage",
   "status": "done",
   "flows": [
    "F3",
    "F4",
    "F15",
    "F16",
    "F21"
   ]
  },
  {
   "id": "R-05",
   "name": "Text alert sign-up",
   "stories": "3.2.1, 3.2.6",
   "priority": "P1",
   "states": [
    "Empty, with required fields marked (phone, neighbourhood) and language pre-filled from R-01",
    "building and floor optional, pre-filled from R-35",
    "\"My building isn't listed\"",
    "phone accepted in any common format, validated as typed, shown back formatted, with a one-line error",
    "form error naming what is missing at the top",
    "groups step (skippable",
    "pre-filled from R-26)",
    "sent — \"Check your phone… reply YES\" with resend and fix-the-number",
    "signed up",
    "no account path anywhere"
   ],
   "app": "resident",
   "file": "R05_TextSignup",
   "status": "done",
   "flows": [
    "F2",
    "F3"
   ]
  },
  {
   "id": "R-06",
   "name": "Sign-up confirmation, how to stop, how to change",
   "stories": "3.2.1, 3.2.6, 3.7.1",
   "priority": "P1",
   "states": [
    "Confirmation requested",
    "confirmed",
    "groups changed by keyword",
    "check-in withdrawn",
    "stopped"
   ],
   "app": "resident",
   "file": "R06_SignupConfirm",
   "status": "done",
   "flows": [
    "F3"
   ]
  },
  {
   "id": "R-07",
   "name": "Alert detail",
   "stories": "3.1.1–3.1.7, 3.2.3, 3.2.5, 3.4.4, 3.5.1, 3.2.7",
   "priority": "P1",
   "states": [
    "Official alert relayed (source named, wording unedited, template or labelled machine translation)",
    "Hub-issued",
    "partner-issued",
    "ambassador post (not yet verified)",
    "promoted to verified",
    "acknowledgement",
    "thread of updates, newest first",
    "update with support offer",
    "corrected with what changed",
    "official alert linked",
    "open-near-you block",
    "audio control",
    "tailored block (X-12)",
    "version everyone gets",
    "ambassador post's one line machine-translated and labelled",
    "share",
    "ongoing across days",
    "resolved with final entry",
    "expired",
    "opened from the archive",
    "route into filtered search",
    "route into guide",
    "basic-mode variant drawn",
    "fixed order — type icon (X-13) and headline, what is not yet known, verification line, where, one action",
    "times in hours and minutes"
   ],
   "app": "resident",
   "file": "R07_AlertDetail",
   "status": "done",
   "flows": [
    "F4",
    "F5",
    "F6",
    "F7",
    "F13",
    "F14",
    "F16",
    "F17",
    "F18",
    "F21",
    "F23"
   ]
  },
  {
   "id": "R-28",
   "name": "What \"verified\" means",
   "stories": "3.1.5",
   "priority": "P1",
   "states": [
    "Checked (who verified it, when)",
    "not yet verified",
    "opened in one step from the marker"
   ],
   "app": "resident",
   "file": "R28_Verified",
   "status": "done",
   "flows": [
    "F6"
   ]
  },
  {
   "id": "R-29",
   "name": "Share an alert",
   "stories": "3.1.7",
   "priority": "P1",
   "states": [
    "Standard version only (\"Everyone gets this version\")",
    "preview of a verified alert",
    "preview of an unverified ambassador post",
    "\"sharing is not recorded\" line",
    "handed to share sheet"
   ],
   "app": "resident",
   "file": "R29_Share",
   "status": "done",
   "flows": [
    "F7"
   ]
  },
  {
   "id": "R-30",
   "name": "Shared alert in a messaging app (device frame)",
   "stories": "3.1.7",
   "priority": "P1",
   "states": [
    "As received in a group",
    "link removed",
    "link opened later showing a newer update and a correction"
   ],
   "app": "resident",
   "file": "R30_WhatsApp",
   "status": "done",
   "flows": [
    "F7"
   ]
  },
  {
   "id": "R-08",
   "name": "Archived alerts",
   "stories": "3.1.6",
   "priority": "P1",
   "states": [
    "Resolved alerts",
    "expired alerts",
    "each opens R-07 read-only",
    "empty"
   ],
   "app": "resident",
   "file": "R08_Archive",
   "status": "done",
   "flows": [
    "F6",
    "F17"
   ]
  },
  {
   "id": "R-09",
   "name": "Search entry",
   "stories": "3.3.1",
   "priority": "P1",
   "states": [
    "Idle with ten category tiles",
    "category chosen, then search within it",
    "focused",
    "typing"
   ],
   "app": "resident",
   "file": "R09_SearchEntry",
   "status": "done",
   "flows": [
    "F8"
   ]
  },
  {
   "id": "R-10",
   "name": "Search results",
   "stories": "3.3.1, 3.3.2, 3.2.7",
   "priority": "P1",
   "states": [
    "Results",
    "match reason per result",
    "cross-language result labelled",
    "filtered from an alert, with the resident's own filters pre-applied and named",
    "includes at least one contributed entry",
    "filters applied with X-11",
    "no match with nearest alternative",
    "help list from an alert or guide — only services that can help with this disruption, each with a \"How they can help\" box (X-14), ranked by fit to the disruption, open now, distance and confirmation date",
    "the five first-session test queries each reaching the right service"
   ],
   "app": "resident",
   "file": "R10_SearchResults",
   "status": "done",
   "flows": [
    "F6",
    "F8",
    "F11"
   ]
  },
  {
   "id": "R-27",
   "name": "Filters",
   "stories": "3.3.2",
   "priority": "P1",
   "states": [
    "Seven filters as plain questions",
    "some chosen",
    "applied"
   ],
   "app": "resident",
   "file": "R27_Filters",
   "status": "done",
   "flows": [
    "F8"
   ]
  },
  {
   "id": "R-11",
   "name": "No results — route to a person",
   "stories": "3.3.1",
   "priority": "P1",
   "states": [
    "Single state, designed rather than an error"
   ],
   "app": "resident",
   "file": "R11_NoResults",
   "status": "done",
   "flows": [
    "F8"
   ]
  },
  {
   "id": "R-12",
   "name": "Service / asset listing detail",
   "stories": "3.3.3, 3.4.1, 3.4.4",
   "priority": "P1",
   "states": [
    "Open now",
    "closed",
    "all nine attributes",
    "attribute unknown",
    "community offer",
    "machine-translated",
    "correction affordance",
    "space block (open, full, closed, unconfirmed)",
    "information confirmed by the organisation, with date",
    "from public sources, not yet confirmed",
    "kind of organisation",
    "service types in one line",
    "languages not known",
    "\"How they can help\" box when reached from a disruption"
   ],
   "app": "resident",
   "file": "R12_Listing",
   "status": "done",
   "flows": [
    "F6",
    "F8",
    "F9",
    "F23"
   ]
  },
  {
   "id": "R-13",
   "name": "Organisation page",
   "stories": "3.3.3",
   "priority": "P2",
   "states": [
    "Default"
   ],
   "app": "resident",
   "file": "R13_Organisation",
   "status": "done",
   "flows": [
    "F8"
   ]
  },
  {
   "id": "R-14",
   "name": "Asset map — map view",
   "stories": "3.4.1, 3.4.4",
   "priority": "P1",
   "states": [
    "Loaded",
    "loading",
    "tiles unavailable",
    "formal, informal and community-offer markers",
    "open-as-a-space filter applied",
    "no entries in view",
    "familiar pan, zoom and tap for hours, with no search box",
    "clusters labelled \"3 places\"",
    "utility filters (air conditioning, Wi-Fi, charging, washrooms, drinking water, food)",
    "preparedness-kit filter",
    "disruption view showing only places that can help",
    "neutral faith-based icon"
   ],
   "app": "resident",
   "file": "R14_MapView",
   "status": "done",
   "flows": [
    "F9",
    "F10"
   ]
  },
  {
   "id": "R-15",
   "name": "Asset map — list view",
   "stories": "3.4.1, 3.4.4, 3.2.5, 3.2.7",
   "priority": "P1",
   "states": [
    "Ordered by distance",
    "opened from an alert with the resident's own filters pre-applied and named",
    "open-as-a-space filter applied with X-09 on each entry",
    "empty",
    "basic-mode variant drawn",
    "utility filters",
    "preparedness-kit filter",
    "disruption view showing only places that can help, each saying how"
   ],
   "app": "resident",
   "file": "R15_MapList",
   "status": "done",
   "flows": [
    "F9",
    "F11",
    "F13"
   ]
  },
  {
   "id": "R-16",
   "name": "Map entry preview card",
   "stories": "3.4.1, 3.4.4",
   "priority": "P1",
   "states": [
    "Collapsed",
    "expanded",
    "with space status",
    "opens R-12"
   ],
   "app": "resident",
   "file": "R16_MapPreview",
   "status": "done",
   "flows": [
    "F9"
   ]
  },
  {
   "id": "R-17",
   "name": "Add an entry — entry point",
   "stories": "3.4.2",
   "priority": "P1",
   "states": [
    "From map",
    "from list",
    "from an entry that looks wrong"
   ],
   "app": "resident",
   "file": "R17_AddEntryPoint",
   "status": "done",
   "flows": [
    "F10"
   ]
  },
  {
   "id": "R-18",
   "name": "The rules, at the point of submission",
   "stories": "3.4.3",
   "priority": "P1",
   "states": [
    "Full statement",
    "marketplace prohibition on its own line",
    "every launch language"
   ],
   "app": "resident",
   "file": "R18_Rules",
   "status": "done",
   "flows": [
    "F10"
   ]
  },
  {
   "id": "R-19",
   "name": "Add an entry — template form",
   "stories": "3.4.2",
   "priority": "P1",
   "states": [
    "Empty",
    "partially complete",
    "ADMS field set",
    "optional fields carrying only an \"Optional\" tag and a \"Not sure\" choice",
    "hours per day by drop-down, with \"same every weekday\" and \"not sure\"",
    "community-offer type chosen",
    "ready to submit"
   ],
   "app": "resident",
   "file": "R19_AddForm",
   "status": "done",
   "flows": [
    "F10"
   ]
  },
  {
   "id": "R-20",
   "name": "Locate without an address",
   "stories": "3.4.2",
   "priority": "P1",
   "states": [
    "Drop a pin",
    "building and described place",
    "nearby landmark",
    "no address given"
   ],
   "app": "resident",
   "file": "R20_Locate",
   "status": "done",
   "flows": [
    "F10"
   ]
  },
  {
   "id": "R-21",
   "name": "Submitted — which lane, how long",
   "stories": "3.4.2",
   "priority": "P1",
   "states": [
    "General lane",
    "ambassador lighter-touch lane"
   ],
   "app": "resident",
   "file": "R21_Submitted",
   "status": "done",
   "flows": [
    "F10"
   ]
  },
  {
   "id": "R-22",
   "name": "Correct an existing entry",
   "stories": "3.4.2",
   "priority": "P1",
   "states": [
    "Opened with values in place",
    "one field changed",
    "submitted"
   ],
   "app": "resident",
   "file": "R22_CorrectEntry",
   "status": "done",
   "flows": [
    "F10"
   ]
  },
  {
   "id": "R-23",
   "name": "Declined — reason and route to resubmit",
   "stories": "3.4.3",
   "priority": "P1",
   "states": [
    "Reason stated",
    "what to change",
    "resubmit reopens the entry with content intact"
   ],
   "app": "resident",
   "file": "R23_Declined",
   "status": "done",
   "flows": [
    "F10",
    "F20"
   ]
  },
  {
   "id": "R-24",
   "name": "Be ready — toolkit index",
   "stories": "3.5.1, 3.5.2, 3.5.4, 3.7.1",
   "priority": "P1",
   "states": [
    "Six hazards, no more",
    "link to numbers",
    "heads-up choice",
    "link to ask for a check-in, opening the groups choice on R-34"
   ],
   "app": "resident",
   "file": "R24_BeReady",
   "status": "done",
   "flows": [
    "F11"
   ]
  },
  {
   "id": "R-25",
   "name": "Hazard guide (before / during / after)",
   "stories": "3.5.1, 3.2.3, 3.5.2, 3.2.7",
   "priority": "P1",
   "states": [
    "Opened at \"before\"",
    "opened at \"during\" from an alert",
    "AI-generated content labelled",
    "audio control per section",
    "link to numbers",
    "link to filtered services and spaces",
    "basic-mode variant drawn"
   ],
   "app": "resident",
   "file": "R25_HazardGuide",
   "status": "done",
   "flows": [
    "F5",
    "F6",
    "F11"
   ]
  },
  {
   "id": "R-31",
   "name": "Numbers I might need",
   "stories": "3.5.2",
   "priority": "P1",
   "states": [
    "911 apart with when to call",
    "numbers named by purpose including 211 and 311",
    "building contact known",
    "building contact not known with ambassador route",
    "call confirmation",
    "basic-mode variant drawn"
   ],
   "app": "resident",
   "file": "R31_Numbers",
   "status": "done",
   "flows": [
    "F11",
    "F13"
   ]
  },
  {
   "id": "R-32",
   "name": "Seasonal heads-up",
   "stories": "3.5.4",
   "priority": "P1-L",
   "states": [
    "Off (default)",
    "on, with \"never a text message\" line",
    "the three heads-ups as content"
   ],
   "app": "resident",
   "file": "R32_HeadsUp",
   "status": "done",
   "flows": [
    "F11"
   ]
  },
  {
   "id": "R-33",
   "name": "Ask for a check-in",
   "stories": "3.7.1",
   "priority": "P1-L",
   "states": [
    "Building and floor known from R-35, or asked here if skipped",
    "what it is and is not, including that the ambassador can help reach non-emergency services",
    "method chosen (call, text, knock)",
    "unit number shown only for a knock",
    "helper confirming agreement",
    "requested",
    "floor with no ambassador (Hub route offered)",
    "withdrawn"
   ],
   "app": "resident",
   "file": "R33_CheckIn",
   "status": "done",
   "flows": [
    "F2",
    "F12"
   ]
  },
  {
   "id": "O-01",
   "name": "Operator home — open incidents",
   "stories": "3.1.1, 3.1.4, 3.1.6, 3.6.1, 3.6.4, 3.7.2",
   "priority": "P1",
   "states": [
    "Open incidents with elapsed time",
    "none open",
    "incoming official alert at the very top",
    "every ambassador post as a priority review — waiting for approval, or already live",
    "stale flag with time since last update, against the period set for that disruption type",
    "ongoing alert not flagged within its period",
    "check-in escalations waiting",
    "control to open a shared space",
    "exercise marker (X-10)"
   ],
   "app": "hub",
   "file": "O01_OperatorHome",
   "status": "done",
   "flows": [
    "F14",
    "F15",
    "F17",
    "F18",
    "F21",
    "F22"
   ]
  },
  {
   "id": "O-11",
   "name": "Log a disruption",
   "stories": "3.1.1",
   "priority": "P1",
   "states": [
    "Empty",
    "type chosen",
    "area chosen",
    "ready to publish"
   ],
   "app": "hub",
   "file": "O11_LogDisruption",
   "status": "done",
   "flows": [
    "F14",
    "F26"
   ]
  },
  {
   "id": "O-12",
   "name": "Acknowledgement composer",
   "stories": "3.1.1, 3.1.2, 3.2.3, 3.2.7",
   "priority": "P1",
   "states": [
    "Generated in every launch language",
    "audio version listed per language",
    "tailored blocks listed by group, read-only",
    "language versions expanded",
    "channel status",
    "valid until",
    "publishing",
    "published"
   ],
   "app": "hub",
   "file": "O12_AckComposer",
   "status": "done",
   "flows": [
    "F14",
    "F26"
   ]
  },
  {
   "id": "O-13",
   "name": "Promote acknowledgement to full alert",
   "stories": "3.1.1",
   "priority": "P1",
   "states": [
    "Same object reopened with audience and languages intact",
    "published update"
   ],
   "app": "hub",
   "file": "O13_Promote",
   "status": "done",
   "flows": [
    "F14"
   ]
  },
  {
   "id": "O-02",
   "name": "Compose an alert",
   "stories": "3.1.2, 3.1.3, 3.1.5",
   "priority": "P1",
   "states": [
    "Empty",
    "message entered",
    "template identifier shown",
    "official alert on the same event linked",
    "valid until a time or until resolved",
    "aim by place, by group, or both"
   ],
   "app": "hub",
   "file": "O02_Compose",
   "status": "done",
   "flows": [
    "F15",
    "F16"
   ]
  },
  {
   "id": "O-03",
   "name": "Audience — place",
   "stories": "3.1.2",
   "priority": "P1",
   "states": [
    "Nothing selected",
    "neighbourhood",
    "buildings (with search at pilot scale)",
    "floors",
    "mixed selection"
   ],
   "app": "hub",
   "file": "O03_AudiencePlace",
   "status": "done",
   "flows": [
    "F15",
    "F16"
   ]
  },
  {
   "id": "O-04",
   "name": "Audience — group",
   "stories": "3.1.3",
   "priority": "P1",
   "states": [
    "Nothing selected",
    "language",
    "one of the four categories",
    "both",
    "live count",
    "small-group warning",
    "the stated limits of what can be targeted"
   ],
   "app": "hub",
   "file": "O04_AudienceGroup",
   "status": "done",
   "flows": [
    "F16"
   ]
  },
  {
   "id": "O-05",
   "name": "Pre-send review",
   "stories": "3.1.2, 3.1.3, 3.6.10",
   "priority": "P1",
   "states": [
    "Plain-language restatement (place, group, combined)",
    "reach by channel",
    "reach by language",
    "unreachable count stated separately",
    "intersection rather than sum",
    "exercise state (\"nothing will be sent to residents\")"
   ],
   "app": "hub",
   "file": "O05_PreSend",
   "status": "done",
   "flows": [
    "F15",
    "F16",
    "F26"
   ]
  },
  {
   "id": "O-06",
   "name": "Publish confirmation and handoff",
   "stories": "3.1.1, 3.1.2, 3.1.3",
   "priority": "P1",
   "states": [
    "What went where, in which languages",
    "named ambassadors receiving the follow-up"
   ],
   "app": "hub",
   "file": "O06_Published",
   "status": "done",
   "flows": [
    "F14",
    "F15",
    "F16"
   ]
  },
  {
   "id": "O-14",
   "name": "Post an update to a running alert",
   "stories": "3.1.6, 3.1.5",
   "priority": "P1-L",
   "states": [
    "Existing alert opened",
    "update from template",
    "support offer attached from the directory (listing or open space)",
    "official alert linked",
    "valid-until confirmed",
    "published"
   ],
   "app": "hub",
   "file": "O14_Update",
   "status": "done",
   "flows": [
    "F17"
   ]
  },
  {
   "id": "O-15",
   "name": "Correct an alert",
   "stories": "3.1.5",
   "priority": "P1",
   "states": [
    "Entry chosen",
    "corrected wording",
    "one line saying what changed",
    "published as a correction"
   ],
   "app": "hub",
   "file": "O15_Correct",
   "status": "done",
   "flows": [
    "F17"
   ]
  },
  {
   "id": "O-16",
   "name": "Resolve and close the thread",
   "stories": "3.1.6, 3.7.2",
   "priority": "P1-L",
   "states": [
    "Final entry required",
    "check-in records deletion notice",
    "resolved and moved to archived alerts"
   ],
   "app": "hub",
   "file": "O16_Resolve",
   "status": "done",
   "flows": [
    "F17"
   ]
  },
  {
   "id": "O-07",
   "name": "Ambassador post — approve or review",
   "stories": "3.1.4, 3.1.5",
   "priority": "P1",
   "states": [
    "Moderated type waiting — approve in one tap, edit and approve, or decline with a reason",
    "direct type already live and marked not yet verified — verify in one tap, correct, or withdraw with a reason",
    "at the top as a priority review"
   ],
   "app": "hub",
   "file": "O07_AmbReview",
   "status": "done",
   "flows": [
    "F18"
   ]
  },
  {
   "id": "O-17",
   "name": "Check-in round progress and escalations",
   "stories": "3.7.2",
   "priority": "P1-L",
   "states": [
    "Counts by building and floor (done, not reached, connected to a service)",
    "connected to a service, category only, to follow up",
    "needs help waiting",
    "not reached waiting",
    "taken",
    "none waiting"
   ],
   "app": "hub",
   "file": "O17_CheckinProgress",
   "status": "done",
   "flows": [
    "F19"
   ]
  },
  {
   "id": "O-18",
   "name": "Official alert received — relay and activate",
   "stories": "3.1.5, 3.6.4",
   "priority": "P1",
   "states": [
    "Official alert with source, area and valid-until",
    "matching trigger and level",
    "designated teams named",
    "relay confirmed",
    "activation confirmed (separately)",
    "dismissed with a reason",
    "Amber Alert with fictional placeholder content",
    "exercise state"
   ],
   "app": "hub",
   "file": "O18_OfficialReceived",
   "status": "done",
   "flows": [
    "F21",
    "F26"
   ]
  },
  {
   "id": "O-08",
   "name": "Moderation queue",
   "stories": "3.4.3",
   "priority": "P1",
   "states": [
    "Empty",
    "a handful waiting",
    "a realistic week",
    "oldest overdue",
    "ambassador and general lanes separate",
    "queue count and age",
    "batch selection"
   ],
   "app": "hub",
   "file": "O08_ModQueue",
   "status": "done",
   "flows": [
    "F20"
   ]
  },
  {
   "id": "O-09",
   "name": "Review a submission",
   "stories": "3.4.3",
   "priority": "P1",
   "states": [
    "Filled fields, not prose",
    "original and machine translation shown together",
    "accept",
    "decline",
    "edit (secondary)"
   ],
   "app": "hub",
   "file": "O09_ModReview",
   "status": "done",
   "flows": [
    "F20"
   ]
  },
  {
   "id": "O-10",
   "name": "Decline with a reason",
   "stories": "3.4.3",
   "priority": "P1",
   "states": [
    "Pre-written reasons in every launch language",
    "chosen",
    "sent"
   ],
   "app": "hub",
   "file": "O10_Decline",
   "status": "done",
   "flows": [
    "F20"
   ]
  },
  {
   "id": "P-06",
   "name": "Activation notification (device frame)",
   "stories": "3.6.4",
   "priority": "P1",
   "states": [
    "By text message",
    "by email",
    "disruption, level, what is asked, how to join",
    "exercise-marked"
   ],
   "app": "partner",
   "file": "P06_Activation",
   "status": "done",
   "flows": [
    "F21",
    "F24",
    "F26"
   ]
  },
  {
   "id": "P-01",
   "name": "Open a shared space",
   "stories": "3.6.1, 3.6.8, 3.6.9",
   "priority": "P1",
   "states": [
    "Opened from a disruption with type, level, location and start time carried in",
    "playbook and matching commitments loading",
    "purpose chosen",
    "organisations added. No blank-space path exists"
   ],
   "app": "partner",
   "file": "P01_OpenSpace",
   "status": "done",
   "flows": [
    "F22",
    "F26"
   ]
  },
  {
   "id": "P-02",
   "name": "The shared space",
   "stories": "3.6.1, 3.6.2, 3.6.7, 3.6.8, 3.6.9, 3.6.10",
   "priority": "P1",
   "states": [
    "Just opened (already populated, never empty)",
    "purpose and playbook checklist permanently at the head",
    "commitment confirm-or-decline prompts",
    "active",
    "six hours in",
    "checklist item adjusted for this disruption",
    "record a decision",
    "partner-facing treatment",
    "statements and conversation in one stream",
    "exercise marker"
   ],
   "app": "partner",
   "file": "P02_SharedSpace",
   "status": "done",
   "flows": [
    "F21",
    "F22",
    "F23",
    "F26"
   ]
  },
  {
   "id": "P-03",
   "name": "Post a structured statement",
   "stories": "3.6.2, 3.6.6",
   "priority": "P1",
   "states": [
    "Four statement types",
    "chosen",
    "supply item attached",
    "posted",
    "attributed to organisation and person"
   ],
   "app": "partner",
   "file": "P03_Statement",
   "status": "done",
   "flows": [
    "F23"
   ]
  },
  {
   "id": "P-04",
   "name": "Coverage view",
   "stories": "3.6.2, 3.6.3, 3.6.5, 3.6.6, 3.6.8, 3.6.9, 3.7.2",
   "priority": "P1",
   "states": [
    "Covered",
    "being worked on",
    "waiting on someone",
    "not covered (never below the fold)",
    "committed but not yet confirmed",
    "playbook items not yet taken",
    "need matched to a supply item",
    "spaces with status and capacity",
    "read-only ambassador coverage and check-in counts",
    "each item traced to its source",
    "updates when a gap is claimed"
   ],
   "app": "partner",
   "file": "P04_Coverage",
   "status": "done",
   "flows": [
    "F19",
    "F22",
    "F23",
    "F24",
    "F26"
   ]
  },
  {
   "id": "P-05",
   "name": "Our capacity",
   "stories": "3.6.2",
   "priority": "P1",
   "states": [
    "Not set",
    "available",
    "stretched",
    "at capacity",
    "appears beside the organisation name throughout"
   ],
   "app": "partner",
   "file": "P05_Capacity",
   "status": "done",
   "flows": [
    "F23"
   ]
  },
  {
   "id": "P-07",
   "name": "Our spaces",
   "stories": "3.6.5",
   "priority": "P1",
   "states": [
    "Own spaces only",
    "open, full, closed in one action",
    "hours and facilities confirmed as they stand",
    "capacity",
    "stale with \"still correct\"",
    "change shown alongside R-12"
   ],
   "app": "partner",
   "file": "P07_OurSpaces",
   "status": "done",
   "flows": [
    "F23"
   ]
  },
  {
   "id": "P-08",
   "name": "Supplies and space capacity",
   "stories": "3.6.6",
   "priority": "P1-L",
   "states": [
    "Supplies per organisation with location and rough quantity",
    "updated with time since",
    "space capacity beside supplies at the same site",
    "partner-facing treatment"
   ],
   "app": "partner",
   "file": "P08_Supplies",
   "status": "done",
   "flows": [
    "F23"
   ]
  },
  {
   "id": "P-09",
   "name": "Decision log",
   "stories": "3.6.7",
   "priority": "P1-L",
   "states": [
    "Decisions newest first, each with who, when, why",
    "empty",
    "\"kept with the disruption's record\" line"
   ],
   "app": "partner",
   "file": "P09_Decisions",
   "status": "done",
   "flows": [
    "F24"
   ]
  },
  {
   "id": "P-10",
   "name": "Handover on leaving",
   "stories": "3.6.7",
   "priority": "P1-L",
   "states": [
    "Pre-filled with held commitments",
    "each reassigned or released",
    "one-line note",
    "done"
   ],
   "app": "partner",
   "file": "P10_Handover",
   "status": "done",
   "flows": [
    "F24"
   ]
  },
  {
   "id": "P-11",
   "name": "Readiness home — standing commitments",
   "stories": "3.6.8",
   "priority": "P1-L",
   "states": [
    "By disruption type and mode",
    "contact role",
    "link to agreement",
    "review dates",
    "overdue at top, oldest first",
    "gap row",
    "confirmed as still correct"
   ],
   "app": "partner",
   "file": "P11_Readiness",
   "status": "done",
   "flows": [
    "F25"
   ]
  },
  {
   "id": "P-12",
   "name": "Hazard playbook",
   "stories": "3.6.9",
   "priority": "P1-L",
   "states": [
    "Six hazards listed",
    "power outage drafted in full",
    "five placeholders",
    "four parts each linked to where it is set",
    "version and history",
    "staleness period for alerts of this disruption type",
    "whether ambassador posts of this type go out directly or wait for the Hub"
   ],
   "app": "partner",
   "file": "P12_Playbook",
   "status": "done",
   "flows": [
    "F22",
    "F25",
    "F27"
   ]
  },
  {
   "id": "P-13",
   "name": "Designated teams and triggers",
   "stories": "3.6.4",
   "priority": "P1",
   "states": [
    "Type-by-level grid",
    "team role and channels in each cell",
    "external-event trigger and threshold",
    "empty cell as a gap"
   ],
   "app": "partner",
   "file": "P13_Teams",
   "status": "done",
   "flows": [
    "F25"
   ]
  },
  {
   "id": "P-14",
   "name": "Exercise — start, schedule, end",
   "stories": "3.6.10",
   "priority": "P1-L",
   "states": [
    "Type and level chosen",
    "enrolment",
    "running",
    "ended with the record named",
    "scheduled and repeating"
   ],
   "app": "partner",
   "file": "P14_Exercise",
   "status": "done",
   "flows": [
    "F26"
   ]
  },
  {
   "id": "P-15",
   "name": "Indicators",
   "stories": "3.6.11",
   "priority": "P1-L",
   "states": [
    "Aggregate tiles with definitions",
    "real, exercise and everyday split and labelled",
    "small numbers suppressed",
    "survey tile",
    "definitions agreed date",
    "export"
   ],
   "app": "partner",
   "file": "P15_Indicators",
   "status": "done",
   "flows": [
    "F27"
   ]
  },
  {
   "id": "P-16",
   "name": "Look back and actions",
   "stories": "3.6.12",
   "priority": "P1-L",
   "states": [
    "Records filtered by type, building and period",
    "recurring gaps",
    "lesson turned into an action with owner and date",
    "completed action linked to what changed",
    "next review date",
    "sample records labelled"
   ],
   "app": "partner",
   "file": "P16_LookBack",
   "status": "done",
   "flows": [
    "F26",
    "F27"
   ]
  },
  {
   "id": "A-01",
   "name": "Ambassador home — my building",
   "stories": "3.1.4, 3.7.2",
   "priority": "P1",
   "states": [
    "Assigned building or buildings stated plainly",
    "nothing active",
    "something active in my building",
    "check-in round waiting with a count",
    "one prominent control to post",
    "exercise marker"
   ],
   "app": "ambassador",
   "file": "A01_AmbHome",
   "status": "done",
   "flows": [
    "F18",
    "F19"
   ]
  },
  {
   "id": "A-02",
   "name": "Post a building update",
   "stories": "3.1.4",
   "priority": "P1",
   "states": [
    "Empty",
    "disruption types as a multi-select, building-level only (power, water or plumbing, elevator, fire alarm or evacuation, flood or leak) plus Other, each with its icon",
    "Other chosen — one line required and 911 shown first",
    "floors as a range, a multi-select or \"whole building\", across the whole assigned building",
    "optional photo and one line",
    "\"This will appear as: Building ambassador, [building]\"",
    "\"This will go out now\" or \"The Hub will check this before it goes out\", by type",
    "ready to post"
   ],
   "app": "ambassador",
   "file": "A02_PostUpdate",
   "status": "done",
   "flows": [
    "F18"
   ]
  },
  {
   "id": "A-03",
   "name": "Post confirmation and channel status",
   "stories": "3.1.4",
   "priority": "P1",
   "states": [
    "Direct type — live on every channel, text messages included, marked not yet verified",
    "moderated type — waiting for the Hub",
    "approved and sent",
    "declined, with the reason",
    "what went where and when",
    "slow or failed send in low signal",
    "verified by the Hub",
    "corrected or withdrawn by the Hub, with the reason"
   ],
   "app": "ambassador",
   "file": "A03_PostStatus",
   "status": "done",
   "flows": [
    "F18"
   ]
  },
  {
   "id": "A-04",
   "name": "My round — check-ins and follow-ups",
   "stories": "3.1.2, 3.7.2",
   "priority": "P1",
   "states": [
    "Check-ins requested on my floors with contact method, no reason",
    "households not reachable digitally with the alert text to carry",
    "done, not reached, needs help in one tap",
    "connected to a service",
    "offline with \"will send when you have signal\"",
    "passed to the Hub",
    "\"records deleted when the disruption closes\" line",
    "add a door at the resident's request — floor, door and method, with her agreement confirmed on screen — marked \"added at the resident's request\""
   ],
   "app": "ambassador",
   "file": "A04_Round",
   "status": "done",
   "flows": [
    "F15",
    "F19",
    "F26"
   ]
  },
  {
   "id": "A-05",
   "name": "Connect to a service",
   "stories": "3.7.2",
   "priority": "P1-L",
   "states": [
    "911 first for anything urgent",
    "non-emergency services open now in the resident's language, from the directory",
    "chosen and told to the resident, or written down for her (never sent by text message — Section 13, O6)",
    "recorded as a service category only"
   ],
   "app": "ambassador",
   "file": "A05_Connect",
   "status": "done",
   "flows": [
    "F19"
   ]
  },
  {
   "id": "X-01",
   "name": "Not-911 statement",
   "stories": "PRD 1, 10",
   "priority": "P1",
   "states": [
    "A designed component, not footer text. Appears on R-07, in the R-04 specimen, at the head of R-25, on R-31, on R-33 and in P-02 — the partner space is where an organisation is most likely to assume someone else has called."
   ],
   "app": "shared",
   "file": "X01_Not911",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-02",
   "name": "Origin and verification marker",
   "stories": "3.1.4, 3.1.5, 3.1.7, 3.2.1",
   "priority": "P1",
   "states": [
    "Official source relayed (City of Toronto, Environment and Climate Change Canada, Alert Ready); Hub-issued; partner-issued (named organisation); ambassador post attributed to role and building; verified; not yet verified; corrected. Opens R-28. Must survive a text message, a forwarded message and a printed sheet, and never depends on colour."
   ],
   "app": "shared",
   "file": "X02_Origin",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-03",
   "name": "The rules of the space / code of conduct",
   "stories": "3.4.3; PRD P7",
   "priority": "P1",
   "states": [
    "A required component, not a placeholder. Plain language, every launch language, marketplace prohibition explicit. Appears on R-18 and is reachable from R-12, R-14 and R-15."
   ],
   "app": "shared",
   "file": "X03_Rules",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-04",
   "name": "Machine-translation label and report-an-error control",
   "stories": "3.2.2",
   "priority": "P1",
   "states": [
    "Inline label plus report control, with a reported-state confirmation. Drawn on at least one listing and one contributed entry."
   ],
   "app": "shared",
   "file": "X04_MachineTranslation",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-05",
   "name": "Printed notice template",
   "stories": "3.2.1, 3.2.2",
   "priority": "P1",
   "states": [
    "George's first screen is paper. Greek, Urdu and English variants, short link and QR code landing in the language of the sheet, and space for an ambassador to write in a building or floor by hand."
   ],
   "app": "shared",
   "file": "X05_PrintedNotice",
   "status": "done",
   "flows": [
    "F1"
   ]
  },
  {
   "id": "X-06",
   "name": "Structured statement chip",
   "stories": "3.6.2",
   "priority": "P1",
   "states": [
    "Four types — doing this, can take this on, cannot cover this, need this — each visually distinct, legible alongside ordinary conversation, and the atom the coverage view is assembled from."
   ],
   "app": "shared",
   "file": "X06_Statement",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-07",
   "name": "Basic mode",
   "stories": "3.2.5",
   "priority": "P1",
   "states": [
    "A display mode across the same architecture, not a separate site. Persists alongside the language choice. Settable by the resident or by someone helping them."
   ],
   "app": "shared",
   "file": "X07_BasicMode",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-08",
   "name": "Audio control",
   "stories": "3.2.3",
   "priority": "P1",
   "states": [
    "Idle with length stated; loading; playing; paused; failed with a one-line explanation. Text always stays alongside. Placed on R-07 and at the head of each R-25 section."
   ],
   "app": "shared",
   "file": "X08_Audio",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-09",
   "name": "Space status badge",
   "stories": "3.4.4, 3.6.5",
   "priority": "P1",
   "states": [
    "Open, full, closed, unconfirmed; purpose (cooling, clean air, warming, device charging); last confirmed. Word, icon and shape; not drawn from the incident status colours."
   ],
   "app": "shared",
   "file": "X09_SpaceStatus",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-10",
   "name": "Exercise marker",
   "stories": "3.6.10",
   "priority": "P1-L",
   "states": [
    "A standing banner on every operator, partner and ambassador screen during an exercise, and a first-line label on every specimen message. Every launch language. Unmistakable, and not drawn from the incident status colours."
   ],
   "app": "shared",
   "file": "X10_Exercise",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-11",
   "name": "Applied-filter bar",
   "stories": "3.3.2",
   "priority": "P1",
   "states": [
    "Each filter named in words and removable in one tap; count of results hidden; stays visible while scrolling."
   ],
   "app": "shared",
   "file": "X11_FilterBar",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-12",
   "name": "Tailored block — \"What this means for you\"",
   "stories": "3.2.7",
   "priority": "P1",
   "states": [
    "Beneath the core of an alert, never above it. Advice for the resident's groups and her check-in line, never naming a group. \"Tailored to your choices\" link to R-34; \"Show the version everyone gets\" control; marked \"Advice from the Hub\" on a relayed official alert; audio; basic mode."
   ],
   "app": "shared",
   "file": "X12_Tailored",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-13",
   "name": "Disruption type icons",
   "stories": "3.1.1, 3.1.4, 3.1.5",
   "priority": "P1",
   "states": [
    "Fire, power, water, elevator, flood or leak, heat, smoke, winter storm, other — always with the word, never by icon alone, never in the incident status colours. Used on R-04 (as the word), R-07, R-03, A-02 and O-11."
   ],
   "app": "shared",
   "file": "X13_DisruptionType",
   "status": "done",
   "flows": []
  },
  {
   "id": "X-14",
   "name": "\"How they can help\" box",
   "stories": "3.5.1, 3.3.3, 3.4.1",
   "priority": "P1",
   "states": [
    "A highlighted box on a service reached from an alert, a guide or the disruption view of the map, saying in one line what it can do for this disruption. A service with nothing to say here is not in the help list."
   ],
   "app": "shared",
   "file": "X14_HowTheyHelp",
   "status": "done",
   "flows": []
  }
 ],
 "flows": [
  {
   "id": "F1",
   "name": "First open: language before anything else",
   "audience": "resident",
   "personas": "George, Nasrin",
   "stories": "3.2.2",
   "entry": "A printed notice with a short link or QR code",
   "steps": [
    "X-05",
    "R-01",
    "R-26",
    "R-35",
    "R-03",
    "R-02"
   ],
   "goal": "Arrive at a first screen he can read, with a few things on it.",
   "status": "done"
  },
  {
   "id": "F2",
   "name": "Tell the CVH where I live and which groups I belong to, if I choose to",
   "audience": "resident",
   "personas": "Nasrin, George and his grandson",
   "stories": "3.2.6, 3.2.1, 3.7.1",
   "entry": "Straight after the language choice on first run",
   "steps": [
    "R-01",
    "R-26",
    "R-35",
    "R-33",
    "R-05",
    "R-03",
    "R-34"
   ],
   "goal": "Say which groups she belongs to and where she lives, or skip, without feeling exposed.",
   "status": "done"
  },
  {
   "id": "F3",
   "name": "Signing up for text alerts, and confirming",
   "audience": "resident",
   "personas": "Amina, with her daughter",
   "stories": "3.2.1, 3.2.6",
   "entry": "\"Get text alerts\" at the top of home",
   "steps": [
    "R-03",
    "R-05",
    "R-04",
    "R-06"
   ],
   "goal": "Text alerts in Urdu on a basic phone, confirmed by Amina herself.",
   "status": "done"
  },
  {
   "id": "F4",
   "name": "An alert arrives, with no app and no account",
   "audience": "resident",
   "personas": "Amina",
   "stories": "3.2.1, 3.1.5, 3.2.7",
   "entry": "A text message on a basic phone",
   "steps": [
    "R-04",
    "R-07"
   ],
   "goal": "She knows what happened, who sent it, whether it is verified and one thing to do.",
   "status": "done"
  },
  {
   "id": "F5",
   "name": "Listen instead of reading",
   "audience": "resident",
   "personas": "Amina",
   "stories": "3.2.3",
   "entry": "The alert detail",
   "steps": [
    "R-07",
    "R-02",
    "R-25"
   ],
   "goal": "She hears the alert in Urdu with the text alongside.",
   "status": "done"
  },
  {
   "id": "F6",
   "name": "From an alert to what is open, what to do, and who can help",
   "audience": "resident",
   "personas": "Yusuf, Nasrin",
   "stories": "3.1.5, 3.1.6, 3.4.4, 3.5.1, 3.2.7",
   "entry": "An alert",
   "steps": [
    "R-07",
    "R-28",
    "R-12",
    "R-25",
    "R-10",
    "R-08"
   ],
   "goal": "From one alert to the guidance, open spaces and services that help with it.",
   "status": "done"
  },
  {
   "id": "F7",
   "name": "Pass it on without losing where it came from",
   "audience": "resident",
   "personas": "Yusuf, a Pashto-reading neighbour",
   "stories": "3.1.7",
   "entry": "Share on an alert",
   "steps": [
    "R-07",
    "R-29",
    "R-30",
    "R-01",
    "R-07"
   ],
   "goal": "Forward an alert into WhatsApp with its origin intact; the link opens in the opener's language.",
   "status": "done"
  },
  {
   "id": "F8",
   "name": "Search in ordinary words, narrow to what is available, arrive at a service you can walk into",
   "audience": "resident",
   "personas": "Nasrin, George",
   "stories": "3.3.1, 3.3.2, 3.3.3",
   "entry": "Home, or inside an alert",
   "steps": [
    "R-09",
    "R-10",
    "R-27",
    "R-10",
    "R-12",
    "R-13",
    "R-11"
   ],
   "goal": "Describe a problem in her own words, see only what will take her, and know enough to go.",
   "status": "done"
  },
  {
   "id": "F9",
   "name": "See what exists near me, and which spaces are open now",
   "audience": "resident",
   "personas": "Yusuf, George, Nasrin, Devon",
   "stories": "3.4.1, 3.4.4",
   "entry": "Home, or the open-near-you block on an alert",
   "steps": [
    "R-14",
    "R-15",
    "R-16",
    "R-12"
   ],
   "goal": "Find what is close, including what nobody funds, and a cooling space that is actually open.",
   "status": "done"
  },
  {
   "id": "F10",
   "name": "Add what I know",
   "audience": "resident",
   "personas": "Devon (Tagalog), Rashid (Bengali)",
   "stories": "3.4.2",
   "entry": "The map",
   "steps": [
    "R-14",
    "R-17",
    "R-18",
    "R-19",
    "R-20",
    "R-21",
    "R-22",
    "R-23"
   ],
   "goal": "Something he knows about is on the map in a few minutes, without writing an essay.",
   "status": "done"
  },
  {
   "id": "F11",
   "name": "Be ready: guides, numbers, and a heads-up before the season",
   "audience": "resident",
   "personas": "George, Nasrin, Yusuf",
   "stories": "3.5.1, 3.5.2, 3.5.4",
   "entry": "Home, on an ordinary Tuesday",
   "steps": [
    "R-24",
    "R-25",
    "R-10",
    "R-15",
    "R-31",
    "R-32",
    "R-03"
   ],
   "goal": "Know what to do before, during and after, reach the right number, and choose a heads-up.",
   "status": "done"
  },
  {
   "id": "F12",
   "name": "Ask for a check-in",
   "audience": "resident",
   "personas": "Amina with her daughter; George",
   "stories": "3.7.1",
   "entry": "The check-in option in the groups choice",
   "steps": [
    "R-26",
    "R-35",
    "R-33",
    "R-34"
   ],
   "goal": "A resident who lives alone asks to be checked on, and knows exactly what she asked for.",
   "status": "done"
  },
  {
   "id": "F13",
   "name": "The version with less in it",
   "audience": "resident",
   "personas": "George; Amina when helped",
   "stories": "3.2.5",
   "entry": "Home, or set by a helper",
   "steps": [
    "R-03",
    "R-07",
    "R-15",
    "R-31",
    "R-34",
    "R-01"
   ],
   "goal": "The same CVH with bigger text and fewer choices, and it stays that way.",
   "status": "done"
  },
  {
   "id": "F14",
   "name": "Acknowledge in under two minutes",
   "audience": "hub",
   "personas": "Priya; Daniel as partner author",
   "stories": "3.1.1",
   "entry": "A report that something is wrong",
   "steps": [
    "O-01",
    "O-11",
    "O-12",
    "O-06",
    "O-13",
    "R-07"
   ],
   "goal": "An acknowledgement in every launch language, on every channel, before the cause is known.",
   "status": "done"
  },
  {
   "id": "F15",
   "name": "Address an alert to a neighbourhood, a building, or a floor",
   "audience": "hub",
   "personas": "Priya, Daniel; Rashid receiving",
   "stories": "3.1.2",
   "entry": "A disruption is logged",
   "steps": [
    "O-01",
    "O-02",
    "O-03",
    "O-05",
    "O-06",
    "A-04",
    "R-04"
   ],
   "goal": "The right people are reached, and those who cannot be are handed to someone who can.",
   "status": "done"
  },
  {
   "id": "F16",
   "name": "Address an alert to a group, not a place",
   "audience": "hub",
   "personas": "Priya, Daniel; Amina receiving",
   "stories": "3.1.3",
   "entry": "A heat warning concerning seniors",
   "steps": [
    "O-02",
    "O-04",
    "O-03",
    "O-05",
    "O-06",
    "R-07",
    "R-04"
   ],
   "goal": "The right people are reached, and none of them can tell why they were chosen.",
   "status": "done"
  },
  {
   "id": "F17",
   "name": "Keep it current, correct it openly, and close it",
   "audience": "hub",
   "personas": "Priya, Daniel; Yusuf receiving",
   "stories": "3.1.6, 3.1.5",
   "entry": "An outage open for three hours",
   "steps": [
    "O-01",
    "O-14",
    "R-07",
    "O-15",
    "O-16",
    "R-08"
   ],
   "goal": "The alert stays current, a mistake is corrected in the open, and it ends with a final word.",
   "status": "done"
  },
  {
   "id": "F18",
   "name": "Post a building update as an ambassador",
   "audience": "ambassador",
   "personas": "Rashid; Priya receiving",
   "stories": "3.1.4, 3.1.5",
   "entry": "Standing in the corridor, elevator out",
   "steps": [
    "A-01",
    "A-02",
    "A-03",
    "R-07",
    "O-01",
    "O-07"
   ],
   "goal": "An accurate update is live, attributed to his building, in under a minute, one-handed.",
   "status": "done"
  },
  {
   "id": "F19",
   "name": "Work my check-in round",
   "audience": "ambassador",
   "personas": "Rashid; Priya receiving",
   "stories": "3.7.2, 3.1.2",
   "entry": "A heat warning is sent for his building",
   "steps": [
    "A-01",
    "A-04",
    "A-05",
    "O-17",
    "P-04"
   ],
   "goal": "Every check-in and unreachable household is seen to, one tap each.",
   "status": "done"
  },
  {
   "id": "F20",
   "name": "Moderate in the time available",
   "audience": "hub",
   "personas": "Priya",
   "stories": "3.4.3",
   "entry": "A week of accumulated submissions",
   "steps": [
    "O-08",
    "O-09",
    "O-10",
    "R-23"
   ],
   "goal": "The queue is empty in the time she has, and declined contributors know what to do.",
   "status": "done"
  },
  {
   "id": "F21",
   "name": "Relay an official alert, and activate the teams who cover it",
   "audience": "partner",
   "personas": "Priya; Daniel's staff; Amina",
   "stories": "3.6.4, 3.1.5",
   "entry": "Environment Canada issues a heat warning",
   "steps": [
    "O-01",
    "O-18",
    "R-04",
    "R-07",
    "P-06",
    "P-02"
   ],
   "goal": "Residents get the official warning with its source; designated teams hear directly.",
   "status": "done"
  },
  {
   "id": "F22",
   "name": "Open one shared space, already carrying what we agreed",
   "audience": "partner",
   "personas": "Priya; Daniel",
   "stories": "3.6.1, 3.6.8, 3.6.9",
   "entry": "A disruption that already exists",
   "steps": [
    "O-01",
    "P-01",
    "P-02",
    "P-04",
    "P-12"
   ],
   "goal": "One space, already populated, obviously partner-facing, clear about its purpose.",
   "status": "done"
  },
  {
   "id": "F23",
   "name": "Say what we are doing, whether our space is open, and what we hold",
   "audience": "partner",
   "personas": "Daniel, Priya",
   "stories": "3.6.2, 3.6.5, 3.6.6",
   "entry": "Inside the shared space",
   "steps": [
    "P-02",
    "P-03",
    "P-05",
    "P-07",
    "R-12",
    "R-07",
    "P-08",
    "P-04"
   ],
   "goal": "The coverage picture exists without anyone maintaining it.",
   "status": "done"
  },
  {
   "id": "F24",
   "name": "Join six hours in, and hand over when you leave",
   "audience": "partner",
   "personas": "A partner coordinator arriving cold",
   "stories": "3.6.3, 3.6.7",
   "entry": "The activation link, six hours in",
   "steps": [
    "P-06",
    "P-04",
    "P-09",
    "P-10",
    "P-04"
   ],
   "goal": "Say what is happening and what is missing without asking anyone.",
   "status": "done"
  },
  {
   "id": "F25",
   "name": "Be ready before anything happens",
   "audience": "partner",
   "personas": "Daniel, Priya",
   "stories": "3.6.8, 3.6.9, 3.6.4",
   "entry": "The readiness area on an ordinary Tuesday",
   "steps": [
    "P-11",
    "P-12",
    "P-13"
   ],
   "goal": "Commitments, playbooks and triggers exist and are current before they are needed.",
   "status": "done"
  },
  {
   "id": "F26",
   "name": "Run a drill without reaching residents",
   "audience": "partner",
   "personas": "Priya, with Daniel and Rashid enrolled",
   "stories": "3.6.10",
   "entry": "The readiness area",
   "steps": [
    "P-14",
    "O-11",
    "O-12",
    "O-05",
    "O-18",
    "P-06",
    "P-01",
    "P-02",
    "P-04",
    "A-04",
    "P-14",
    "P-16"
   ],
   "goal": "The whole flow is practised, residents are never reached, and it leaves a record.",
   "status": "done"
  },
  {
   "id": "F27",
   "name": "Know whether it is working, and change something because of it",
   "audience": "partner",
   "personas": "Priya, partner leads, the Community Experts Board",
   "stories": "3.6.11, 3.6.12",
   "entry": "The readiness area at the scheduled review",
   "steps": [
    "P-15",
    "P-16",
    "P-12"
   ],
   "goal": "Say honestly whether the CVH is working, and give every lesson an owner.",
   "status": "done"
  }
 ],
 "phases": [
  {
   "id": 1,
   "name": "Foundations",
   "items": "Done. Tokens, X-01 to X-14, both shells, sample data, English strings, index."
  },
  {
   "id": 2,
   "name": "Resident flows F1 to F13",
   "items": "Done in English. R-01 to R-35 in every Section 5 state, basic mode, the Section 6 entry points, scenarios A, B, C, E, F and G walked. Resident screens in Urdu, Greek and Dari not started."
  },
  {
   "id": 3,
   "name": "Ambassador and Hub flows F14 to F20",
   "items": "Done in English. O-01 to O-18 at 1280 and 390, A-01 to A-05 one-handed with a low-signal state, moderation loaded with the Scenario C week. Hub actions change resident screens within the session; Scenario A walked live. Bengali and Tagalog not started."
  },
  {
   "id": 4,
   "name": "Partner flows F21 to F27",
   "items": "Done in English. P-01 to P-10 at 1280 and 390, P-11 to P-16 at 1280 and checked at 390. Spaces open only from a disruption, coverage gaps can be claimed live, exercise marker everywhere. Scenarios D and G walked. Remaining languages not started."
  }
 ]
};
