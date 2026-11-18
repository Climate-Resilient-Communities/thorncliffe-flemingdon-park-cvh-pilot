# Be Ready guides: draft additions (session 2, #15, #16 and #19)

> **DRAFT. Not reviewed. Not in the app.**
> Claude (AI) drafted this on 2026-11-18 from the public sources listed at the end. It has health and safety wording, so it must not reach residents until the guide owner (Luis Ticas) or a reviewer they name has checked the English.
> The seed (`data/catalogue/guides.json`) needs a named reviewer, a date and a source hash for each guide (`englishReview`). Claude cannot supply these.
> No "when to call 911" line is changed here. Those stay as reviewed.

## What residents asked for (Resident App Feedback tab)

| # | Feedback | Where this draft answers it |
|---|---|---|
| 15 | A short paragraph for each situation: what needs to be done, and what to prepare beforehand (have 3 days of supplies) | "In short" for each guide |
| 16 | Be Ready is missing what to have in the emergency kit | "Emergency kit" (shared by all six guides) |
| 19 | "During" should list the hazards and health signs to watch for | "Watch for" for each guide |

## How it would fit the app (once reviewed)

- **In short:** a new optional `summary` field on each guide. It shows above the Before, During and After tabs. It is 2 or 3 sentences at a grade 6 to 8 reading level, like the guides' existing steps.
- **Emergency kit:** one shared list, shown as its own section in Be Ready (`/[lang]/ready/kit`). Each guide's "Before" tab links to it. A checklist is easier to use than a paragraph, and residents could tick items off in their browser (stored only on their phone, nothing sent).
- **Watch for:** a new optional `watchFor` list on each guide, shown at the top of the During tab, above the steps. It covers hazards and body signs only. The 911 line stays where it is, as the last word on when to call.
- **Translations:** the same as the other guide text. Drafts go through the machine translation path and are marked as not checked by native readers.
- **Rule for adding it:** the seed check rejects a guide whose English hash does not match its review. So adding these fields means a new review of each guide that gains them.

---

## Emergency kit (#16, shared)

**In short:** In an emergency it can take help up to 3 days to reach everyone. Keep enough supplies for everyone in your home for at least 3 days (72 hours). Keep them together in a bag or bin that is easy to carry, near your door.

**Water and food**
- Water: at least 2 litres per person per day for drinking, and more for cooking and washing. The City of Toronto suggests 4 litres per person per day in total. For 3 days, that is 12 litres per person.
- Food that does not go bad and needs no cooking, such as canned food, energy bars and dried food. Choose food your family eats, and replace it once a year.
- A manual can opener.

**Light, power and news**
- A flashlight and extra batteries. Do not use candles.
- A wind-up or battery radio.
- A charged power bank for your phone, and a charging cable.

**Health**
- A first aid kit.
- At least a week of your medicines, and a list of them with the doses.
- Glasses, hearing aid batteries, and any equipment you use every day (for example a cane, or batteries for a power wheelchair).
- Masks (N95 or KN95) for smoke.
- Hand sanitizer, wipes, and toilet paper.

**Papers and money**
- Copies of important papers in a waterproof bag: ID, health card, insurance and prescriptions.
- Some cash in small bills, because cards and bank machines may not work when the power is out.
- A list of phone numbers on paper: family, your doctor, your building's superintendent, and someone outside the city.

**For your family**
- Things for babies (formula, diapers), and for pets (food, water, a leash or carrier).
- Extra keys for your home and car.
- Warm clothes and a blanket.

**Ask for help:** if you cannot get these things, community food banks and agencies in Thorncliffe Park and Flemingdon Park can help. Link: "Help with this" to the directory.

---

## Extreme heat

**In short (#15):** Extreme heat can make anyone sick, and it is most dangerous for older adults, babies and people with health conditions. Before summer, find the cool places near you and check your medicines with a pharmacist. Keep water and 3 days of supplies at home in case you cannot go out.

**Watch for (#19):** signs of heat exhaustion. Move to a cool place, drink water, and rest if you notice:
- Heavy sweating, or skin that is cold and clammy.
- Dizziness or fainting feeling, headache.
- Feeling sick to your stomach (nausea) or throwing up.
- Fast breathing or a fast heartbeat.
- Very thirsty, and peeing less, with dark yellow pee.
- Muscle cramps.

If someone gets worse or stops sweating, see "When to call 911" (already reviewed: confusion, no sweating, very high temperature, fainting).

## Wildfire smoke

**In short (#15):** Smoke from far-away wildfires can make the air unhealthy for days. Before the season, buy masks (N95 or KN95) and make a "clean air room" plan with a fan filter or air purifier. Keep 3 days of food and medicine so you do not have to go outside.

**Watch for (#19):**
- Mild signs, which go away when the air is cleaner: sore eyes, a sore throat, a runny nose, a mild cough, a headache.
- Serious signs. Get medical help if you have: trouble breathing, a bad cough, dizziness, or a racing heart.
- People with asthma, heart or lung disease, pregnant people, older adults and children feel smoke sooner. Keep rescue inhalers close.
- The air quality reading (AQHI) in the weather app. 7 or more is high risk.

## Power outage

**In short (#15):** A power outage can stop elevators, lights, fridges and medical equipment. Before one happens, keep a flashlight, a radio and a charged power bank, and plan for any medical equipment that needs power. Keep 3 days of water and food that needs no cooking.

**Watch for (#19):**
- Carbon monoxide. Never use a barbecue, camp stove or generator indoors or on a balcony. A headache, dizziness, feeling sick or confused can mean carbon monoxide. Get to fresh air at once.
- Food that has gone warm. If food in the fridge has been warm for over 4 hours, throw out meat, fish, milk and leftovers. "When in doubt, throw it out."
- Getting cold in winter, or too hot in summer, when heating or air conditioning is off.
- Falls in dark hallways and stairs.

*Reviewer note:* the existing reviewed "During" step says food stays cold for "24 hours in a full freezer". Health Canada and food safety guidance usually say about 48 hours for a full freezer and 24 hours for a half-full one. Please check this line.

## Flood or plumbing failure

**In short (#15):** In a high-rise, a burst pipe or heavy rain can flood parking levels and basements, and can turn off water or power. Before it happens, keep important papers in a waterproof bag up high, and keep 3 days of bottled water. Know how to reach your superintendent.

**Watch for (#19):**
- Water near electric outlets, panels or cords. Stay away.
- Moving water. Do not walk or drive through it. 15 cm (6 inches) of moving water can knock a person over.
- Dirty water. Flood water can carry sewage. Wash your hands, and do not let children play in it.
- Mould after the water is gone: a musty smell, spots on walls, coughing or wheezing.

## Elevator failure

**In short (#15):** When elevators stop, people on high floors can be stuck at home for days. Before it happens, keep 3 days of food, water and medicine at home, and tell your floor ambassador or a neighbour if you cannot use the stairs.

**Watch for (#19):**
- Chest pain, a racing heart, or bad shortness of breath on the stairs. Stop and rest. See "When to call 911".
- Falls on stairs: go slowly, hold the rail, and do not carry heavy loads.
- Neighbours who cannot leave home and may run out of food or medicine.

## Fire and evacuation

**In short (#15):** In a high-rise fire, the safest choice can be to leave, or to stay in your unit. It depends on where the fire is. Before a fire, learn your building's fire safety plan and both exit stairs, and keep a "go bag" near the door.

**Watch for (#19):**
- Smoke in a hallway or stairwell. Do not go through smoke. Go back, close the door, and use the other stairs, or stay in your unit.
- A hot door or door handle. Do not open it.
- After smoke: coughing, trouble breathing or a headache. Get checked, even if you feel fine at first.

---

## Sources

- Government of Canada, Get Prepared: "be self-sufficient for at least 72 hours"; basic emergency kit contents. https://www.getprepared.gc.ca/cnt/kts/index-en.aspx and https://www.canada.ca/en/services/policing/emergencies/preparedness/get-prepared/emergency-kits.html
- City of Toronto, Get Emergency Ready guide: 4 litres of water per person per day; the Go Bag. https://www.toronto.ca/community-people/public-safety-alerts/emergency-preparedness/ and https://www.toronto.ca/wp-content/uploads/2018/01/94e3-GetEmergencyReadyGuideAccessible.pdf
- Health Canada heat illness signs, as republished by provinces and health authorities: https://gov.mb.ca/health/publichealth/environmentalhealth/heat.html and https://fraserhealth.ca/health-topics-a-to-z/sun-safety/heat-exhaustion-and-heat-stroke
- Wildfire smoke symptoms and AQHI: Health Canada, "Wildfire smoke and your health" (canada.ca). The reviewer should check the exact list there.
- Carbon monoxide and power outage food safety: Health Canada and Government of Canada Get Prepared, power outages.

The reviewer should check each list against the current page of its source before approving. Pages change, and Claude did not open every page in full.
