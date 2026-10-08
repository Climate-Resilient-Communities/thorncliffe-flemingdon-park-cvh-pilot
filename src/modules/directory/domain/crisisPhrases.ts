// The crisis-phrase check of search (S03.04's `emergency_first`, 2026-10-07, product owner's approval): a question that
// describes an emergency puts the 911 block first whatever the ranking found. The ranking can only flag an emergency the
// catalogue has a provider for (the emergency category: police, fire stations, crisis lines), so before this check a medical,
// gas-leak, flood or car-accident question got no 911 block (the interim tuning report, section 13). Pure and deterministic.
//
// What it is: curated phrases for clear emergencies (someone not breathing, unconscious or collapsed; a heart attack, a stroke,
// choking, drowning, severe bleeding, a stabbing or shooting, an overdose or poisoning; suicide or self-harm intent; fire or smoke in
// a home; a gas leak, carbon monoxide; a flood or water pouring in; a car accident, someone hit by a car; an assault, someone with a
// weapon or a threat, a break-in in progress; a missing child; asking for an ambulance, the police or 911 now), in English (applied
// to the question and to its English translation when the translated leg made one) and in every launch language as residents type
// it: es, fr, sk, gu, hi (Hinglish and romanized Urdu, Punjabi and Gujarati included), and the native scripts of the languages that
// are translated to English first (ur, prs, ps, ta, pa, bn, el, zh, tl), which are the backstop when a translation fails, is
// rejected, or is past its monthly limit. Every list applies to every question whatever language was detected (detection can be
// wrong, and a question mixes languages); the lists are written so that a word of one language is not an ordinary word of another.
//
// What it is not: an ordinary question. "gas station", "fire station hours", "police clearance", "first aid course", "CPR class",
// "flood insurance", "smoke detector", "accident insurance" are masked before the phrases are looked for, and "where is the
// hospital" alone is not an emergency (a question about where a hospital is, or about a clinic, is answered by the ranking; only a
// described emergency is one). A phrase only ever turns `emergency_first` on; it never turns the ranking's flag off.
//
// How it matches: the text is normalised (Unicode NFKC, lower case, any script's digits as ASCII, accents and Arabic-script vowel
// marks dropped, Arabic-script letter variants unified, joiners removed, punctuation as space). A phrase is written in a small
// notation: a space is one or more spaces (" ?" none or more), `~` up to three words in between, `*` the rest of a word, `( | )`
// alternatives, `?` an optional letter or group, `(! )` "not followed by". Phrases are folded like the text, and match whole words
// (a letter, mark or digit on either side stops them), except phrases in Chinese characters (no spaces between words: they match
// anywhere) and phrases of digits alone (911: no digit on either side).
//
// SAFETY REVIEW: these lists are safety-relevant. The English lists were written and checked against the test set by Claude; every
// other list is MACHINE-ASSISTED, TO BE CHECKED BY NATIVE READERS before launch (docs/procedures/launch-checklist.md). A reader adds
// what residents would type and removes what an ordinary question would say; the unit tests (crisisPhrases.test.ts) hold examples of
// both for each language group.
import { toAsciiDigits } from "@/contracts/digits";

/** A list of one language group: the phrases that describe an emergency, and the ordinary phrases masked before they are looked for. */
export interface CrisisPhraseList {
  /** Which language group (launch language codes, or `en`). */
  group: string;
  /** `checked`: written and checked in that language (English); `machine_assisted`: to be checked by native readers. */
  review: "checked" | "machine_assisted";
  phrases: readonly string[];
  masks: readonly string[];
}

const ENGLISH: CrisisPhraseList = {
  group: "en",
  review: "checked",
  phrases: [
    // Breathing, consciousness, the heart, a stroke, choking, drowning, a seizure, an allergic reaction.
    "(not|isn'?t|wasn'?t|aren'?t|can'?t|cannot|couldn'?t|stopped|unable to|trouble|difficulty|struggling to|hard to|barely|no longer) ~ breath(e|ing)",
    "no pulse",
    "turning blue",
    "unconscious",
    "unresponsive",
    "passed out",
    "(fainted|fainting)",
    "collapsed",
    "lost consciousness",
    "(won'?t|will not|isn'?t|not) (wake|waking) up",
    "heart attack",
    "cardiac arrest",
    "chest pain*",
    "(having|had|has had|is having|suffering) a stroke",
    "(face|mouth) (is )?drooping",
    "slurred speech",
    "(is |he'?s |she'?s )?choking",
    "drowning",
    "(having|had|is having) a seizure",
    "(having|is having|had|severe) (an )?allergic reaction",
    "anaphyla*",
    "throat (is )?(closing|swelling)",
    // Bleeding and injuries.
    "bleeding (heavily|badly|a lot|profusely|so much|everywhere|out|non stop|nonstop|to death)",
    "(won'?t|will not|doesn'?t|does not|can'?t|cannot) stop bleeding",
    "(lots|a lot|so much) of blood",
    "blood everywhere",
    "severe(ly)? bleeding",
    "(badly|severely|seriously) (hurt|injured|burned|burnt)",
    "stabbed",
    "(got|been|was|were|is|are|just|has been|have been) shot",
    "shooting",
    "shots fired",
    "gunshot*",
    // Overdose, poisoning.
    "overdos*",
    "od'?d",
    "too many (pills|tablets|sleeping pills)",
    "swallowed (a |some |the |his |her |my )?(pills|tablets|medication|medicine|medicines|bleach|poison|detergent|battery|batteries|button battery|magnet|magnets|chemicals|cleaning products)",
    "(drank|drinking|ate) (some )?(bleach|poison|detergent|antifreeze)",
    "took (too many|a lot of|all (the|his|her|my)) (pills|tablets|medication|medicine)",
    "poisoned",
    "poisoning",
    // Suicide, self-harm.
    "suicid*",
    "kill (myself|himself|herself|themselves|themself)",
    "(end|take) (my|his|her|their) (own )?life",
    "wants? to die",
    "(don'?t|do not|doesn'?t|does not) want to (live|be alive)",
    "(hurt|hurting|harm|harming|cut|cutting) (myself|himself|herself|themselves)",
    "self harm*",
    // Fire, smoke.
    "(on|catch|catching|caught) fire",
    "(there'?s|there is|we have|i see) (a )?fire",
    "(house|home|apartment|building|kitchen|stove|oven|car|room|unit|flat|bedroom|basement|garage|balcony) fire",
    "fire (in|inside|at) (my|our|the|his|her) (house|home|apartment|building|kitchen|unit|flat|room|hallway|basement|garage|balcony)",
    "flames",
    "(full of|a lot of|lots of|thick|black) smoke",
    "smoke (is )?(coming|pouring|filling|everywhere|in (my|our|the) (house|home|apartment|unit|flat|room|hallway))",
    "smell* (of |like )?(smoke|burning)",
    "something('?s| is) burning",
    "(house|home|apartment|building|kitchen|stove|car|unit|room) (is )?burning",
    "(smoke|fire|carbon monoxide|co|gas) (alarm|detector)s? (is |are )?(going off|went off|beeping|sounding|ringing)",
    // Gas, carbon monoxide.
    "gas leak*",
    "leak* gas",
    "(smell|smells|smelling|smelled|smelt) (of |like )?gas",
    "gas smell*",
    "carbon monoxide",
    // Flood, water.
    "(flooded|flooding)",
    "flood in (my|our|the) (apartment|house|home|basement|unit|building|flat)",
    "water (is )?(pouring|gushing|rushing|everywhere|rising|coming in|pouring in)",
    "water ~ (electric|electrical|electrics|electricity|outlet|outlets|wires|wiring|socket|sockets)",
    "(burst|broken) (water )?pipe",
    "pipe (burst|broke)",
    "(sewage|sewer) back*",
    // Accidents.
    "(car|traffic|road|bike|bicycle|motorcycle|truck|bus|serious|bad|terrible) (accident|crash|collision)",
    "(had|been in|was in|were in|got in|got into|in) (a |an )?(car |bad |serious |traffic )?(accident|crash|collision)",
    "(hit|struck|run over|knocked down|knocked over) by (a|the|an) (car|truck|bus|vehicle|van|driver|motorcycle|bike)",
    "hit and run",
    "crashed (my|his|her|our|the|a|into)",
    "accident (just )?happened",
    // Violence, weapons, break-ins.
    "(being|been|was|were|got|is|are|just) (attacked|assaulted|beaten|stabbed|mugged|robbed|raped|threatened)",
    "attack(ed|ing) (me|us|him|her|my|our|them)",
    "assault(ed|ing) (me|us|him|her|my|our)",
    "(he|she|husband|wife|partner|boyfriend|girlfriend|father|dad|mother|mom|son|neighbour|neighbor|someone|somebody|a man|a woman|a guy|they) (is |are |keeps )?(hitting|beating|attacking|choking|strangling|threatening|hurting|kicking|punching) (me|us|my|her|him|them)",
    "(has|have|had|with|holding|pulled|pulling|pointing|carrying|waving|got) (a |his |her |their )?(gun|knife|weapon|machete|firearm|pistol|rifle)",
    "threaten(s|ing|ed)? to (kill|hurt|stab|shoot)",
    "(break|breaking|breaks|broke) (in|into)",
    "broken into",
    "intruder*",
    "burglar*",
    "robbery",
    "(someone|somebody|a man|a stranger|a person|people|they) (is |are )?(in|inside|trying to get in|trying to break in) (my|our|the) (house|home|apartment|unit|flat|room)",
    "tried to (get|break) in*",
    // A missing child.
    "(child|kid|son|daughter|baby|toddler|boy|girl|grandson|granddaughter|grandchild) (is |has |has gone |went )?(missing|disappeared|kidnapped|abducted)",
    "(child|kid|son|daughter|baby|toddler) is lost",
    "missing (child|kid|son|daughter|person|baby|toddler)",
    "can'?t find my (child|kid|son|daughter|baby|toddler|boy|girl)",
    "kidnap*",
    "abduct*",
    // Asking for help now.
    "911",
    "ambulance",
    "paramedic*",
    "call (the |an )?(police|cops|ambulance|fire department|firefighters)",
    "(need|send|get|want) (the |an )?(police|cops|ambulance|paramedics|firefighters|fire department) (now|here|immediately|asap|quick|quickly|right now|urgently|fast)",
    "(this is|it'?s|its|it is|we have|i have|there'?s|there is) an emergency",
    "medical emergency",
  ],
  masks: [
    "gas (station|stations|bar|bill|bills|price|prices|stove|stoves|company|card|cards|money|mileage)",
    "fire (station|stations|hall|halls|department hours|safety|extinguisher|extinguishers|drill|drills|inspection|code|exit|exits|route|pit|pits|insurance|prevention|fighter jobs|works|wood|place|places|ban)",
    "fireworks",
    "(smoke|fire|carbon monoxide|co) (alarm|detector)s?(! (is |are )?(going off|went off|beeping|sounding|ringing))",
    "(smoke|carbon monoxide) free",
    "(quit|quitting|stop) smoking",
    "police (clearance|check|checks|record|records|report|background|station|stations|department|headquarters|jobs|non emergency)",
    "background check*",
    "non emergency",
    "first aid (course|courses|class|classes|training|kit|kits|certificate|certification)",
    "cpr (course|courses|class|classes|training|certificate|certification)",
    "flood (insurance|zone|zones|map|maps|risk|plain|plains|preparedness|prevention|kit|warning|warnings|alert|alerts|watch|season|information|info|relief|program|programs)",
    "flooding (insurance|risk|map|information|info|preparedness|prevention)",
    "accident (insurance|report|reports|benefits|claim|claims|lawyer|lawyers|attorney|compensation|history)",
    "(car|auto) insurance",
    "suicide (prevention|awareness) (training|course|courses|workshop|workshops|walk|month|day)",
    "(flu|covid|vaccine|booster|allergy|b12) shots?",
    "shooting (range|star|stars|photos|video|videos|guard)",
    "(food|lead) poisoning",
    "breathing (exercise|exercises|class|classes|technique|techniques|program|programs)",
    "choking hazard*",
    "drowning prevention",
    "overdose prevention (site|sites|program|programs|training)",
    "ambulance (bill|bills|fee|fees|cost|costs|charge|charges|invoice|jobs|job)",
    "paramedic (job|jobs|training|course|courses|program|programs|school|career)",
    "(rape|sexual assault) (crisis )?(centre|center|support|line|services|counselling|counseling)",
    "report (a |the )?(past |previous )?(burglary|robbery|theft|break in)",
    "breakfast",
  ],
};

// es, fr, sk: typed directly (no translation), in their own words.
const SPANISH: CrisisPhraseList = {
  group: "es",
  review: "machine_assisted",
  phrases: [
    "incendio*",
    "fuego",
    "se (esta )?quema*",
    "en llamas",
    "(mucho|sale) humo",
    "huele a (quemado|humo|gas)",
    "no ~ respira*",
    "(dejo de|no puede|le cuesta) respirar",
    "dificultad para respirar",
    "se desmay*",
    "desmayad*",
    "inconsciente",
    "perdio el conocimiento",
    "se desplomo",
    "ataque (al|de) corazon",
    "infarto",
    "paro cardiaco",
    "derrame cerebral",
    "ictus",
    "se (esta )?ahog*",
    "atragant*",
    "sangr* mucho",
    "hemorragia",
    "mucha sangre",
    "no (para|deja) de sangrar",
    "apunal*",
    "acuchill*",
    "le dispararon",
    "disparos",
    "balacera",
    "tiroteo",
    "sobredosis",
    "(tomo|trago|se tomo|se trago|bebio) ~ (pastillas|medicamentos|medicinas|veneno|cloro|lejia)",
    "envenen*",
    "suicid*",
    "quitarme la vida",
    "matarme",
    "(me )?quiero morir",
    "hacerme dano",
    "me (esta )?(pega*|golpea*)",
    "(me|nos) (ataca*|ataco|amenaza*)",
    "agresion",
    "asalt*",
    "(con|tiene|trae|saco) (un |una )?(cuchillo|pistola|arma)",
    "(intento|intentaron|trata|tratan|quiere|quieren) ~ entrar",
    "(entro|entraron|se metio|se metieron) ~ (casa|apartamento|departamento|piso)",
    "ladron*",
    "llam* (a )?(la policia|una ambulancia|al 911|a los bomberos)",
    "necesito (a )?(la policia|una ambulancia)",
    "policia (ya|ahora|rapido|urgente)",
    // Not "ambulancia" alone: in Slovak it is a clinic.
    "(una|la) ambulancia",
    "fuga de gas",
    "olor a gas",
    "monoxido de carbono",
    "inundad*",
    "se (esta )?inund*",
    "entra (mucha )?agua",
    "agua por todas partes",
    "se rompio (una|la) (tuberia|caneria)",
    "accidente (de|en) (coche|carro|auto|trafico|transito|moto)",
    "tuve un accidente",
    "choque",
    "chocamos",
    "atropell*",
    "(hijo|hija|nino|nina|bebe|nieto|nieta) ~ (desaparecid*|perdid*|no aparece)",
    "no encuentro a mi (hijo|hija|nino|nina|bebe)",
    "secuestr*",
  ],
  masks: [
    "fuegos artificiales",
    "(detector|detectores|alarma|alarmas) de (humo|monoxido)",
    "extintor*",
    "estacion de bomberos",
    "seguro (contra|de) (incendio*|inundacion*|accidentes)",
    "prevencion (de incendios|del suicidio)",
    "(contra|extincion de|proteccion contra) incendios?",
    "(zona|riesgo|alerta|alertas|mapa) de inundacion*",
    "intoxicacion alimentaria",
  ],
};

const FRENCH: CrisisPhraseList = {
  group: "fr",
  review: "machine_assisted",
  phrases: [
    "incendie",
    "au feu",
    "en feu",
    "(le|un) feu (dans|chez|a la|au)",
    "il y a (le|du|un) feu",
    "ca brule",
    "flammes",
    "fumee (partout|dans|epaisse|noire|sort)",
    "beaucoup de fumee",
    "sent le brule",
    "ne ~ respire",
    "respire mal",
    "du mal a respirer",
    "n'arrive (pas|plus) a respirer",
    "ne peut (pas|plus) respirer",
    "inconscient*",
    "evanoui*",
    "perdu connaissance",
    "s'est effondre*",
    "crise cardiaque",
    "infarctus",
    "arret cardiaque",
    "avc",
    "accident vasculaire",
    "s'etouffe",
    "se noie",
    "noyade",
    "saigne* (beaucoup|abondamment)",
    "hemorragie",
    "beaucoup de sang",
    "poignard*",
    "coups? de feu",
    "tire dessus",
    "blesse par balle",
    "overdose",
    "surdose",
    "avale ~ (medicaments|cachets|pilules|comprimes|produit*|javel|poison)",
    "empoisonn*",
    "suicid*",
    "me tuer",
    "en finir",
    "veux mourir",
    "me faire du mal",
    "(me|nous|la|le|les) frappe*",
    "m'attaque*",
    "agresse*",
    "agression",
    "(une|avec|des|son|un) (arme|armes|couteau|pistolet)",
    "arme a feu",
    "(me|nous) menace*",
    "cambriol*",
    "(quelqu'un|un homme|des gens) (est )?(entre|rentre) chez (moi|nous)",
    "voleur*",
    "appel* (la police|les pompiers|une ambulance|le 911|le 15|les secours)",
    "besoin de la police",
    "(police|pompiers|secours) vite",
    "fuite de gaz",
    "odeur de gaz",
    "sent le gaz",
    "monoxyde de carbone",
    "inond*",
    "degat des eaux",
    "l'eau (rentre|entre|coule) ~",
    "accident de (voiture|la route|velo|moto)",
    "j'ai eu un accident",
    "percute*",
    "renverse* par",
    "collision",
    "carambolage",
    "(fils|fille|enfant|bebe|petit) ~ (a disparu|disparu*|est perdu*)",
    "enlevement",
    "kidnapp*",
    "je ne trouve (pas|plus) (mon|ma) (fils|fille|enfant|bebe)",
  ],
  masks: [
    "(detecteur|detecteurs) de (fumee|monoxyde)",
    "feux? d'artifice",
    "feu rouge",
    "caserne* de pompiers",
    "extincteur*",
    "assurance (incendie|inondation|accident*)",
    "(service|services|extinction|caserne|casernes|protection|prevention) (d'|des |contre les |contre l')incendie*",
    "contre les incendies",
    "zone inondable",
    "prevention du suicide",
  ],
};

const SLOVAK: CrisisPhraseList = {
  group: "sk",
  review: "machine_assisted",
  phrases: [
    "(hori|horia|horelo)",
    "poziar(u|i|om)?",
    "ohen",
    "dym (v|z|vsade)",
    "vela dymu",
    "nedycha*",
    "(nemoze|nevie|tazko) dycha*",
    "neda sa (mu|jej) dychat",
    "v bezvedomi",
    "odpadol",
    "odpadla",
    "stratil* vedomie",
    "skolaboval*",
    "infarkt",
    "zastava srdca",
    "mozgova prihoda",
    "mrtvica",
    "(dusi sa|sa dusi)",
    "zadusil*",
    "topi sa",
    "krvaca*",
    "vela krvi",
    "bodol*",
    "bodli",
    "pobodal*",
    "strelba",
    "strielal*",
    "postrelil*",
    "predavkova*",
    "(zjedol|zjedla|prehltol|prehltla|vypil|vypila) ~ (lieky|tabletky|jed|savo)",
    "otravil*",
    "samovrazd*",
    "zabit sa",
    "zabijem sa",
    "chcem zomriet",
    "ublizit si",
    "bije (ma|nas|ju|ho)",
    "(ma|nas|ju|ho) bije",
    "napadol (ma|nas|ju|ho)",
    "napadli (ma|nas|ju|ho)",
    "utoci",
    "(s|ma|mal) (nozom|noz|zbran|zbranou|pistol|pistolou)",
    "vyhraza*",
    "vlamal* sa",
    "sa vlamal*",
    "vlamanie",
    "zlodej",
    "zavolaj* (policiu|zachranku|sanitku|hasicov|112|155|158|911)",
    "potrebujem (policiu|zachranku|sanitku)",
    "zachranku",
    "sanitku",
    "unik plynu",
    "unika plyn",
    "(citit|smrdi|cit) plyn*",
    "zapach plynu",
    "oxid uholnaty",
    "zaplav*",
    "povoden",
    "tecie voda",
    "voda vsade",
    "autonehod*",
    "nehod(a|u|y|e)",
    "havaria",
    "zrazil*",
    "nabural*",
    "(dieta|syn|dcera|dcerka|synak|dietatko) ~ (sa )?(stratil*|nezvestn*)",
    "nezvestn*",
    "unesen*",
  ],
  masks: ["hasenie poziar*", "(detektor|hlasic|hlasice) (dymu|poziaru|plynu)", "poistenie (proti )?(poziaru|povodni|nehode|nehodam)", "otrava jedlom", "prevencia samovrazd"],
};

// Hindi and the romanized (Hinglish) spellings residents type for Hindi, Urdu, Punjabi and Gujarati: one list, applied to all.
const HINDI_ROMANIZED: CrisisPhraseList = {
  group: "hi, ur, pa, gu (romanized)",
  review: "machine_assisted",
  phrases: [
    "aag",
    "agg",
    "(saans|saas|saah|shwas|swas|shvas) ~ (nahi|nahin|nai|ni|nathi|band|ruk*)",
    "behosh*",
    "bebhan",
    "dil ka daura",
    "(khoon|khun|lohi) ~ (beh|bah|nikal|vag|vahe|vahi) ~ (raha|rahi|rahe|reha|riha|chhe)",
    "bahut (khoon|khun)",
    "(zeher|zehar|zahar|zer) ~ (kha|khaa|khaya|khaliya|pi|pee|piya|khadhu|pi liya)",
    "khudkushi",
    "aatmahatya",
    "atmahatya",
    "aapghat",
    "(marna|mar jana|marvu) (chahta|chahti|chahte|chahu|chhe)",
    "khud ko (maar|nuksan|khatam)",
    "(chaku|chaaku|chakku|chhuri|bandook|banduk|bandooq|tamancha|chappu)",
    "dhamki",
    "dhamka (raha|rahi|rahe)",
    "(maar|peet|kutt|maari) (raha|rahi|rahe|reha|riha|rahyo|rahya)",
    "(ghus|ghuss|ghusi) (gaya|gayi|gaye|gya|aaya|aya|aye|raha|gayo|aavyo)",
    "chor (ghus|aaya|aya|andar)",
    "police (bulao|bulaao|bulaiye|bulayein|bulaein|ko bulao|ko bulaao|ko call karo|ko phone karo|chahiye|nu bulao|bolavo|ne bolavo|ne bulavo)",
    "ambulance (bulao|bulaao|bhejo|bolavo|chahiye)",
    "gas ~ (leak|badbu|boo|bu|gandh|smell)",
    "paani (bhar|bhari) (gaya|gayi|raha|rahi|gyo)",
    "baadh",
    "accident (ho gaya|ho gayi|hua|hogaya|ho gya|thayo|thai gayo|ho gea)",
    "takkar (ho gayi|lagi|maar di|maari)",
    "(bacha|baccha|bachcha|bachha|beta|beti|munda|kudi|dikro|dikri) ~ (kho gaya|kho gayi|gum|lapata|nahi mil raha|nahi mil rahi|nai mil reha|khovai)",
    "lapata",
    "apharan",
    "(agwa|aghwa)",
    "doob (raha|rahi|gaya|gayi)",
    "dam ghut",
  ],
  masks: [],
};

// Native scripts. Hindi (Devanagari).
const HINDI: CrisisPhraseList = {
  group: "hi",
  review: "machine_assisted",
  phrases: [
    "आग",
    "(सांस|श्वास) ~ (नहीं|नही|बंद|रुक*)",
    "बेहोश*",
    "दिल का दौरा",
    "(खून|रक्त) ~ (बह|निकल) (रहा|रही|रहे)",
    "बहुत खून",
    "(जहर|विष) ~ (खा*|पी*)",
    "आत्महत्या",
    "खुदकुशी",
    "मरना (चाहता|चाहती|चाहते)",
    "चाकू",
    "बंदूक",
    "धमकी",
    "(मार|पीट) (रहा|रही|रहे)",
    "घुस (गया|गई|गए|आया|आए|आई)",
    "चोर",
    "पुलिस (बुलाओ|बुलाइए|बुलाएं|को बुलाओ|को बुलाइए|चाहिए)",
    "(एम्बुलेंस|एंबुलेंस|ऐंबुलेंस|एम्बुलैंस)",
    "गैस ~ (लीक|बदबू|गंध)",
    "बाढ",
    "पानी भर (गया|गई|रहा)",
    "(दुर्घटना|एक्सीडेंट|हादसा)",
    "(बच्चा|बच्ची|बेटा|बेटी) ~ (खो|गुम|लापता)",
    "लापता",
    "अपहरण",
    "दम घुट*",
    "डूब (रहा|रही|गया|गई)",
  ],
  masks: ["आग (बुझा*|से (सुरक्षा|बचाव))"],
};

// Urdu (also read for romanized Urdu above).
const URDU: CrisisPhraseList = {
  group: "ur",
  review: "machine_assisted",
  phrases: [
    "آگ",
    "سانس ~ (نہیں|بند|رک*)",
    "بے ?ہوش*",
    "دل کا دورہ",
    "خون ~ (بہ|نکل) (رہا|رہی|رہے)",
    "بہت خون",
    "زہر ~ (کھا*|پی*)",
    "خودکشی",
    "مرنا چاہت*",
    "(چاقو|چھری|بندوق|پستول)",
    "دھمکی*",
    "مار (رہا|رہی|رہے)",
    "گھس (گیا|گئی|گئے|آیا|آئے)",
    "پولیس ~ (بلاؤ|بلائیں|بلاو|چاہیے)",
    "(ایمبولینس|ایمبولنس)",
    "گیس ~ (لیک|بو)",
    "سیلاب",
    "پانی بھر (گیا|گئی)",
    "(حادثہ|ایکسیڈنٹ)",
    "(بچہ|بچی|بیٹا|بیٹی) ~ (گم|لاپتہ)",
    "لاپتہ",
    "اغوا",
    "ڈوب (رہا|رہی|گیا|گئی)",
  ],
  masks: ["آگ ?بجھا*", "آگ سے (بچاؤ|حفاظت)", "آگ جلانے"],
};

// Dari (and Farsi spellings).
const DARI: CrisisPhraseList = {
  group: "prs",
  review: "machine_assisted",
  phrases: [
    "آتش",
    "آتش ?سوزی",
    "آتش (گرفته|گرفت)",
    "حریق",
    "نفس ~ (نمی*|ندار*|بند|نمیک*|نمیت*)",
    "بی ?هوش*",
    "سکته*",
    "خونریزی",
    "خون ~ (میره|می ?رود|بند نمی*)",
    "زهر ~ خورد*",
    "دوا ~ زیاد ~ خورد*",
    "خودکشی",
    "(میخواهم|می ?خواهم|میخوام|می ?خوام) بمیرم",
    "(چاقو|تفنگ|تفنگچه)",
    "تهدید (می ?کند|کرد|میکنه|کرده)",
    "تهدیدم*",
    "دزد ~ (داخل|خانه|آمده|امده)",
    "(پولیس|پلیس) ~ (خبر|بخواه*|زود|زنگ)",
    "زود (پولیس|پلیس|آمبولانس)",
    "(به|برای) (پولیس|پلیس) زنگ",
    "آمبولانس",
    "بوی گاز",
    "(نشت|نشتی) گاز",
    "گاز نشت*",
    "سیلاب",
    "آب گرفته",
    "تصادف",
    "(بچه*|طفل*|کودک*|پسرم|دخترم) ~ گم",
    "آدم ?ربایی",
    "ربوده",
    "لت و کوب",
    "غرق (شد*|میشه|می ?شود)",
  ],
  masks: ["آتش ?نشانی", "(مهار|اطفای|جای) آتش", "اطفای حریق", "(اعتماد|عزت) به نفس"],
};

// Pashto.
const PASHTO: CrisisPhraseList = {
  group: "ps",
  review: "machine_assisted",
  phrases: [
    "اور (لګ*|لگ*|اخیست*|بل)",
    "ساه ~ (نه|نشی|بند)",
    "(بې|بی) ?هوښ*",
    "سکته*",
    "(وینه|وینې) ~ (بهیږ*|بهیږی|ځی|روانه)",
    "زهر ~ خوړ*",
    "ځان ?وژن*",
    "(چاړه|چاقو|ټوپک|تومانچه)",
    "(ګواښ*|گواښ*)",
    "(ژر|زر) (پولیس|امبولانس|آمبولانس)",
    "پولیس ~ (راوغواړ*|راوبلئ|زنګ|زنگ)",
    "(امبولانس|آمبولانس)",
    "د (ګاز|گاز) بوی",
    "(ګاز|گاز) لیک",
    "سیلاب",
    "حادثه",
    "ماشوم ~ (ورک|تښتول*)",
    "تښتول*",
    "ډوب*",
  ],
  masks: ["اور ?وژن*"],
};

// Bengali.
const BENGALI: CrisisPhraseList = {
  group: "bn",
  review: "machine_assisted",
  phrases: [
    "আগুন",
    "(শ্বাস|নিঃশ্বাস) ~ (নিচ্ছে না|নিতে পারছে না|নিতে পারছি না|বন্ধ|নিতে পারছেন না)",
    "অজ্ঞান",
    "জ্ঞান হারি*",
    "হার্ট অ্যাটাক",
    "(হৃদরোগে|হার্ট অ্যাটাকে) আক্রান্ত",
    "স্ট্রোক",
    "রক্ত (পড়ছে|পড়*|ঝরছে)",
    "রক্তক্ষরণ",
    "বিষ খে*",
    "আত্মহত্যা",
    "মরে যেতে চাই",
    "ছুরি",
    "বন্দুক",
    "হুমকি",
    "মারছে",
    "মারধর",
    "ঢুকে (পড়েছে|পড়*)",
    "চোর",
    "পুলিশ (ডাকুন|ডাকো|দরকার|লাগবে)",
    "(অ্যাম্বুলেন্স|এম্বুলেন্স|অ্যাম্বুল্যান্স)",
    "গ্যাস ~ (লিক|গন্ধ)",
    "গ্যাসের গন্ধ",
    "বন্যা",
    "(পানি|জল) ঢুক*",
    "(দুর্ঘটনা|অ্যাক্সিডেন্ট|এক্সিডেন্ট)",
    "(বাচ্চা|শিশু|ছেলে|মেয়ে) ~ (হারিয়ে|নিখোঁজ)",
    "নিখোঁজ",
    "অপহরণ",
    "ডুবে (যাচ্ছে|গেছে)",
  ],
  masks: [],
};

// Tamil (agglutinative: a stem and `*` where a suffix follows).
const TAMIL: CrisisPhraseList = {
  group: "ta",
  review: "machine_assisted",
  phrases: [
    "தீ",
    "தீ ?(ப்)?பிடி*",
    "தீ விபத்து*",
    "நெருப்பு",
    "மூச்சு ~ (விடவில்லை|விட முடியவில்லை|இல்லை|வரவில்லை|நின்று*)",
    "மூச்சுத் ?திணற*",
    "மயங்கி*",
    "மயக்கம்",
    "சுயநினைவு இல்லை",
    "நினைவு இழந்*",
    "மாரடைப்பு",
    "பக்கவாதம்",
    "(இரத்தம்|ரத்தம்) ~ (கொட்டு*|வடி*|போகு*|நிற்கவில்லை)",
    "விஷம் ~ (குடித்*|சாப்பிட்*|குடிச்*)",
    "தற்கொலை*",
    "(கத்தியால்|கத்தியுடன்|துப்பாக்கி*)",
    "மிரட்டு*",
    "அடிக்கிறா*",
    "தாக்கு*",
    "(வீட்டுக்குள்|வீட்டிற்குள்) ~ புகுந்*",
    "திருடன்",
    "(போலீஸ்|போலீசை|காவல்துறை*) ~ (கூப்பிடு*|அழை*|வேண்டும்|வரவழை*)",
    "ஆம்புலன்ஸ்",
    "(கேஸ்|எரிவாயு|கியாஸ்) ~ (லீக்|கசிவு|வாசனை|வாடை)",
    "வெள்ளம்",
    "தண்ணீர் ~ (புகுந்*|வருகிறது|நிரம்பி*)",
    "விபத்து*",
    "குழந்தை* ~ (காணவில்லை|காணாமல்)",
    "கடத்த*",
  ],
  masks: ["நெருப்பு மூட்டு*", "தீயணைப்பு*"],
};

// Punjabi (Gurmukhi).
const PUNJABI: CrisisPhraseList = {
  group: "pa",
  review: "machine_assisted",
  phrases: [
    "ਅੱਗ",
    "ਸਾਹ ~ (ਨਹੀਂ|ਨਹੀ|ਬੰਦ)",
    "ਬੇਹੋਸ਼*",
    "ਦਿਲ ਦਾ ਦੌਰਾ",
    "ਖੂਨ ~ (ਵਗ*|ਨਿਕਲ*)",
    "ਜ਼ਹਿਰ",
    "(ਖੁਦਕੁਸ਼ੀ|ਆਤਮਹੱਤਿਆ)",
    "(ਚਾਕੂ|ਬੰਦੂਕ|ਧਮਕੀ)",
    "ਘੁਸ (ਗਿਆ|ਆਇਆ|ਗਏ|ਗਈ)",
    "(ਪੁਲਿਸ|ਪੁਲੀਸ) ~ (ਬੁਲਾਓ|ਬੁਲਾਉ|ਚਾਹੀਦੀ|ਸੱਦੋ)",
    "(ਐਂਬੂਲੈਂਸ|ਐਮਬੂਲੈਂਸ|ਐਂਬੂਲੈਸ)",
    "ਗੈਸ ~ (ਲੀਕ|ਬਦਬੂ)",
    "ਹੜ੍ਹ",
    "ਪਾਣੀ ਭਰ*",
    "(ਹਾਦਸਾ|ਐਕਸੀਡੈਂਟ)",
    "ਲਾਪਤਾ",
    "ਗੁਆਚ*",
    "ਅਗਵਾ",
  ],
  masks: ["ਅੱਗ (ਬੁਝਾ*|ਨੂੰ (ਰੋਕ*|ਬੁਝਾ*)|ਬਾਲਣ|ਸੁਰੱਖਿਆ)"],
};

// Gujarati.
const GUJARATI: CrisisPhraseList = {
  group: "gu",
  review: "machine_assisted",
  phrases: [
    "આગ",
    "શ્વાસ ~ (નથી|બંધ)",
    "બેભાન",
    "હાર્ટ ?એટેક",
    "હૃદયરોગનો હુમલો",
    "લોહી ~ (વહી*|નીકળ*)",
    "ઝેર",
    "(આપઘાત|આત્મહત્યા)",
    "(ચપ્પુ|છરી|બંદૂક|ધમકી)",
    "ઘૂસી (ગયો|ગયા|ગઈ|આવ્યો)",
    "પોલીસ ~ (બોલાવો|જોઈએ)",
    "(એમ્બ્યુલન્સ|એમ્બ્યુલેન્સ)",
    "ગેસ ~ (લીક|ગંધ)",
    "પૂર",
    "પાણી ભરા*",
    "અકસ્માત",
    "(બાળક*|દીકરો|દીકરી) ~ (ખોવાઈ*|ગુમ)",
    "અપહરણ",
  ],
  masks: ["આગ (સુરક્ષા|બાળવા*|બુઝા*|ઓલવ*)"],
};

// Greek (accents dropped by the normalisation, final sigma as sigma).
const GREEK: CrisisPhraseList = {
  group: "el",
  review: "machine_assisted",
  phrases: [
    "φωτια",
    "πυρκαγια*",
    "καιγεται",
    "καιγομαστε",
    "πηρε φωτια",
    "(πολυς|πυκνος|μαυρος) καπνος",
    "καπνος ~ (σπιτι|διαμερισμα|κουζινα|βγαινει)",
    "δεν ~ αναπνε*",
    "λιποθυμ*",
    "αναισθητ*",
    "κατερρευσε",
    "εμφραγμα",
    "καρδιακη προσβολη",
    "εγκεφαλικο",
    "(πνιγεται|πνιγηκε|πνιγομαι)",
    "αιμορραγ*",
    "πολυ αιμα",
    "(ηπιε|πηρε|καταπιε) ~ (χαπια|φαρμακα|δηλητηριο|χλωρινη)",
    "υπερβολικη δοση",
    "δηλητηριασ*",
    "αυτοκτον*",
    "θελω να πεθανω",
    "(μαχαιρι|μαχαιρια|μαχαιρωσ*|μαχαιρωθ*)",
    "(οπλο|οπλα|πιστολι)",
    "πυροβολ*",
    "απειλει*",
    "(με|μας) (χτυπαει|δερνει)",
    "επιτεθηκε",
    "επιθεση",
    "διαρρηξη",
    "διαρρηκτ*",
    "μπηκ* ~ σπιτι",
    "(καλεστε|καλεσε|φωναξτε|φωναξε) ~ (αστυνομια|ασθενοφορο|πυροσβεστικη)",
    "ασθενοφορο",
    "διαρροη (αεριου|γκαζιου)",
    "μυριζει γκαζι",
    "μυρωδια γκαζιου",
    "μονοξειδιο του ανθρακα",
    "πλημμυρ*",
    "(τρεχει|μπαινει) νερο",
    "τροχαιο",
    "τρακαρ*",
    "με χτυπησε (ενα )?αυτοκινητο",
    "παρασυρθηκε",
    "ατυχημα",
    "εξαφανιστηκε",
    "αγνοειται",
    "χαθηκε (το παιδι|ο γιος|η κορη)",
    "απαγωγη",
    "δεν βρισκω το παιδι",
  ],
  masks: ["(ασφαλιση|ασφαλεια) (πλημμυρ*|πυρκαγια*|ατυχηματ*)", "ανιχνευτ* καπνου", "(προστασια απο|κατασβεση) πυρκαγι*"],
};

// Chinese (Simplified and Traditional; no spaces between words, so these match anywhere in the text).
const CHINESE: CrisisPhraseList = {
  group: "zh",
  review: "machine_assisted",
  phrases: [
    "着火",
    "著火",
    "失火",
    "火灾",
    "火災",
    "起火",
    "冒烟",
    "冒煙",
    "烧起来",
    "燒起來",
    "不能呼吸",
    "无法呼吸",
    "無法呼吸",
    "没有呼吸",
    "沒有呼吸",
    "没呼吸",
    "沒呼吸",
    "呼吸困难",
    "呼吸困難",
    "喘不过气",
    "喘不過氣",
    "停止呼吸",
    "昏迷",
    "晕倒",
    "暈倒",
    "昏倒",
    "晕过去",
    "暈過去",
    "不省人事",
    "失去知觉",
    "失去知覺",
    "叫不醒",
    "心脏病发",
    "心臟病發",
    "心梗",
    "心肌梗塞",
    "心脏骤停",
    "心臟驟停",
    "中风",
    "中風",
    "噎住",
    "窒息",
    "溺水",
    "大出血",
    "流血不止",
    "血流不止",
    "一直流血",
    "很多血",
    "被捅",
    "被刺伤",
    "被刺傷",
    "开枪",
    "開槍",
    "枪击",
    "槍擊",
    "中枪",
    "中槍",
    "吃了很多药",
    "吃了很多藥",
    "服药过量",
    "服藥過量",
    "药物过量",
    "藥物過量",
    "吞了药",
    "吞了藥",
    "吃了安眠药",
    "吃了安眠藥",
    "喝了农药",
    "喝了農藥",
    "中毒",
    "自杀",
    "自殺",
    "想死",
    "不想活",
    "轻生",
    "輕生",
    "自残",
    "自殘",
    "割腕",
    "跳楼",
    "跳樓",
    "打我",
    "被打",
    "殴打",
    "毆打",
    "家暴",
    "持刀",
    "拿刀",
    "有刀",
    "拿枪",
    "拿槍",
    "有枪",
    "有槍",
    "威胁我",
    "威脅我",
    "抢劫",
    "搶劫",
    "闯入",
    "闖入",
    "闯进",
    "闖進",
    "入室",
    "报警",
    "報警",
    "叫警察",
    "快叫警察",
    "叫救护车",
    "叫救護車",
    "救护车",
    "救護車",
    "煤气泄漏",
    "煤氣洩漏",
    "煤气泄露",
    "燃气泄漏",
    "燃氣洩漏",
    "天然气泄漏",
    "天然氣洩漏",
    "漏气",
    "漏氣",
    "煤气味",
    "煤氣味",
    "燃气味",
    "燃氣味",
    "瓦斯味",
    "一氧化碳",
    "淹水",
    "水淹",
    "进水了",
    "進水了",
    "水管爆",
    "爆管",
    "洪水",
    "车祸",
    "車禍",
    "撞车",
    "撞車",
    "被车撞",
    "被車撞",
    "交通事故",
    "孩子不见了",
    "孩子不見了",
    "孩子丢了",
    "孩子丟了",
    "找不到孩子",
    "找不到我的孩子",
    "小孩不见",
    "小孩不見",
    "走失",
    "失踪",
    "失蹤",
    "被绑架",
    "被綁架",
    "拐走",
  ],
  masks: ["打我(的)?(电话|電話|手机|手機)", "报警器", "報警器", "食物中毒", "洪水保险", "洪水保險", "一氧化碳(探测器|探測器|报警器|報警器)"],
};

// Tagalog.
const TAGALOG: CrisisPhraseList = {
  group: "tl",
  review: "machine_assisted",
  phrases: [
    "sunog",
    "nasusunog",
    "nasunog",
    "may apoy",
    "umaapoy",
    "(maraming|makapal na) usok",
    "hindi (na )?(makahinga|humihinga)",
    "di (na )?makahinga",
    "hirap (na )?huminga",
    "nawalan ng malay",
    "walang malay",
    "(hinimatay|nahimatay)",
    "atake sa puso",
    "inatake",
    "na ?stroke",
    "(nabulunan|nabilaukan)",
    "(nalulunod|nalunod)",
    "(dumudugo|duguan)",
    "maraming dugo",
    "nalason",
    "(uminom|nakainom) ng (lason|maraming gamot)",
    "(magpakamatay|magpapakamatay|nagpakamatay)",
    "gusto ko (na )?(nang )?mamatay",
    "ayoko (na )?(nang )?mabuhay",
    "saktan ang sarili",
    "(sinaksak|nasaksak|binaril|nabaril|pamamaril)",
    "may (baril|kutsilyo|patalim)",
    "(nanunutok|binubugbog|sinasaktan|nagbabanta)",
    "(holdap|hinoldap|nanloob|ninakawan)",
    "(pinasok|pumasok) ~ bahay",
    "akyat ?bahay",
    "may magnanakaw",
    "(tumawag|tawagan|tawagin|tawag) (ng|sa|ang) (pulis|911|ambulansya)",
    "kailangan (ko )?(ng )?(pulis|ambulansya)",
    "ambulansya",
    "amoy ~ gas",
    "(tagas|tumatagas|singaw) (ng |na )?gas",
    "baha (sa|na)",
    "(binaha|binabaha|bumabaha)",
    "pumapasok ang tubig",
    "(naaksidente|aksidente)",
    "(nabangga|nasagasaan|bumangga|banggaan)",
    "nawawala ang (anak|bata)",
    "nawawalang (bata|anak)",
    "hindi ko (mahanap|makita) ang (anak|bata)",
    "(kinidnap|dinukot)",
  ],
  masks: ["insurance sa aksidente", "(laban sa|pagpuksa ng|pag ?iwas sa) sunog"],
};

/** Every list, English first. */
export const CRISIS_PHRASE_LISTS: readonly CrisisPhraseList[] = [ENGLISH, SPANISH, FRENCH, SLOVAK, HINDI_ROMANIZED, HINDI, URDU, DARI, PASHTO, BENGALI, TAMIL, PUNJABI, GUJARATI, GREEK, CHINESE, TAGALOG];

// ------------------------------------------------------------------------------------------------ normalisation

/** Scripts whose combining marks are accents or vowel signs a resident may or may not type: dropped. (Not the Indic scripts, whose vowel signs are letters.) */
const ACCENTED = /([\p{Script=Latin}\p{Script=Greek}\p{Script=Arabic}\p{Script=Cyrillic}])\p{M}+/gu;

/**
 * The letters of a text as the phrases are compared with them: NFKC; lower case; any script's digits as ASCII; accents and
 * Arabic-script vowel marks dropped; the Indic nuktas dropped and candrabindu read as anusvara; Arabic-script letter variants
 * unified (Arabic yeh and kaf as the Persian ones, the Urdu heh forms as heh); joiners removed; curly apostrophes straight; final
 * sigma as sigma. Applied to the phrases too, so a phrase may be written as residents write it.
 */
export function foldLetters(text: string): string {
  return toAsciiDigits(text.normalize("NFKC"))
    .toLowerCase()
    .normalize("NFD")
    .replace(ACCENTED, "$1")
    .replace(/[़়਼઼]/g, "")
    .replace(/ँ/g, "ं")
    .normalize("NFC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ہھۀە]/g, "ه")
    .replace(/ـ/g, "")
    .replace(/[​‌‍⁠﻿­]/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/ς/g, "σ");
}

/** The text as the phrases are looked for in it: folded, punctuation (but the apostrophe) and hyphens as space, one space between words. */
export function normaliseCrisisText(text: string): string {
  return foldLetters(text)
    .replace(/[^\p{L}\p{M}\p{N}']+/gu, " ")
    .trim();
}

// ------------------------------------------------------------------------------------------------ the phrase notation

// The normalised text holds letters, marks and digits, the apostrophe, spaces and a masked phrase's "|": a word is a run of
// anything but the last three. (Not \p{L}: Unicode property classes make each of the many expressions slow to compile.)
const WORD_CHAR = "[^\\s|']";
const LEFT = `(?<!${WORD_CHAR})`;
const RIGHT = `(?!${WORD_CHAR})`;
/** `~`: up to three words in between. */
const GAP = "(?:\\S+\\s+){0,3}";
const HAN = /\p{Script=Han}/u;

/** A phrase of the notation as a regular expression source (see the header). Throws on a phrase that is not valid. */
export function phraseSource(phrase: string): string {
  const folded = foldLetters(phrase);
  let out = "";
  for (let i = 0; i < folded.length; i++) {
    const c = folded[i]!;
    const next = folded[i + 1];
    if (c === " ") {
      if (next === "?") {
        out += "\\s*";
        i++;
      } else if (next === "~") {
        // " ~ ": the gap takes the spaces around it.
        out += `\\s+${GAP}`;
        i += folded[i + 2] === " " ? 2 : 1;
      } else out += "\\s+";
    } else if (c === "~") out += GAP;
    else if (c === "*") out += `${WORD_CHAR}*`;
    else if (c === "(" && next === "!") {
      out += "(?!";
      i++;
    } else if (c === "(") out += "(?:";
    else if (c === ")" || c === "|" || c === "?") out += c;
    else out += c.replace(/[.+^${}[\]\\/-]/g, "\\$&");
  }
  // A number on its own: not a part of a longer number, nor of a phone number written with spaces or hyphens (416 911 0000).
  if (/^[0-9]+$/.test(folded)) return `(?<![0-9]\\s?)(?:${out})(?!\\s?[0-9])`;
  if (HAN.test(folded)) return `(?:${out})`;
  return `${LEFT}(?:${out})${RIGHT}`;
}

/**
 * Every list's phrases and masks, each its own expression (compiled once, on first use). One expression of all of them would take
 * seconds to compile; these take milliseconds, and a question of 200 characters is checked against all of them in about a millisecond.
 */
let compiled: { phrases: RegExp[]; masks: RegExp[] } | undefined;
function patterns() {
  compiled ??= {
    phrases: CRISIS_PHRASE_LISTS.flatMap((list) => list.phrases.map((phrase) => new RegExp(phraseSource(phrase), "u"))),
    masks: CRISIS_PHRASE_LISTS.flatMap((list) => list.masks.map((mask) => new RegExp(phraseSource(mask), "gu"))),
  };
  return compiled;
}

/** What the check found in one text: whether it describes an emergency, and whether an ordinary phrase was masked in it. */
export interface CrisisCheck {
  crisis: boolean;
  /** An ordinary phrase ("gas station", "fire station", "police check") was in the text (masked before the phrases were looked for). */
  masked: boolean;
}

/** Whether a text describes an emergency (see the header). Holds nothing: the text is not kept or written anywhere. */
export function checkCrisisPhrases(text: string): CrisisCheck {
  const { phrases, masks } = patterns();
  let normal = normaliseCrisisText(text);
  let masked = false;
  for (const mask of masks) {
    normal = normal.replace(mask, () => {
      masked = true;
      return " | ";
    });
  }
  return { crisis: phrases.some((phrase) => phrase.test(normal)), masked };
}

/** Whether any of the texts (the question, and its English translation when there is one) describes an emergency. */
export function describesEmergency(texts: readonly (string | null | undefined)[]): boolean {
  return texts.some((text) => typeof text === "string" && text !== "" && checkCrisisPhrases(text).crisis);
}
