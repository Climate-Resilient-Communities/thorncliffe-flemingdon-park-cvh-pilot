// Test fixtures for alert translation (S04.02): one English alert, a passing translation of it in each language, and the
// routes as the migration seeds them (test/db/translationRoute.db.test.ts keeps SEEDED_ROUTE_ROWS equal to the table). Used
// by tests only.
import { buildRoutes, type RouteRow } from "./alertRoutes";

export const NORTH = "north-small-translate-09-2026";
export const COMMAND_A = "command-a-translate-08-2025";
export const AYA_FIRE = "tiny-aya-fire";
export const AYA_WATER = "tiny-aya-water";

export const ENGLISH_ALERT = "The elevator at 85 Thorncliffe Park Dr is out of service. Please use the stairs and call the Hub if you need help.";

/** A translation of ENGLISH_ALERT that passes its language's checks, for each language a model translates into. */
export const GOOD: Record<string, string> = {
  ur: "85 تھورنکلف پارک ڈرائیو کی لفٹ بند ہے۔ براہ کرم سیڑھیاں استعمال کریں اور مدد کی ضرورت ہو تو ہب کو کال کریں۔",
  ps: "د 85 تهورنکلف پارک ډرایو لفټ بند دی. مهرباني وکړئ زینې وکاروئ او که مرستې ته اړتیا لرئ هب ته زنګ ووهئ.",
  prs: "آسانسور ساختمان 85 تورنکلیف پارک درایو از کار افتاده است. لطفاً از پله ها استفاده کنید و در صورت نیاز به کمک با مرکز تماس بگیرید.",
  hi: "85 थॉर्नक्लिफ पार्क ड्राइव की लिफ्ट बंद है। कृपया सीढ़ियों का उपयोग करें और मदद चाहिए तो हब को कॉल करें।",
  bn: "85 থর্নক্লিফ পার্ক ড্রাইভের লিফট বন্ধ আছে। অনুগ্রহ করে সিঁড়ি ব্যবহার করুন এবং সাহায্যের প্রয়োজন হলে হাবকে ফোন করুন।",
  ta: "85 தோர்ன்கிளிஃப் பார்க் டிரைவில் உள்ள மின்தூக்கி இயங்கவில்லை. தயவுசெய்து படிக்கட்டுகளைப் பயன்படுத்தவும், உதவி தேவைப்பட்டால் ஹப்பை அழைக்கவும்.",
  pa: "85 ਥੋਰਨਕਲਿਫ ਪਾਰਕ ਡਰਾਈਵ ਦੀ ਲਿਫਟ ਬੰਦ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਪੌੜੀਆਂ ਦੀ ਵਰਤੋਂ ਕਰੋ ਅਤੇ ਮਦਦ ਚਾਹੀਦੀ ਹੋਵੇ ਤਾਂ ਹੱਬ ਨੂੰ ਫ਼ੋਨ ਕਰੋ।",
  gu: "85 થોર્નક્લિફ પાર્ક ડ્રાઇવની લિફ્ટ બંધ છે. કૃપા કરીને સીડીનો ઉપયોગ કરો અને મદદની જરૂર હોય તો હબને ફોન કરો.",
  el: "Το ασανσέρ στο 85 Thorncliffe Park Dr είναι εκτός λειτουργίας. Παρακαλούμε χρησιμοποιήστε τις σκάλες και καλέστε το Hub αν χρειάζεστε βοήθεια.",
  zh: "85 Thorncliffe Park Dr 的电梯停止运行。请使用楼梯，如需帮助请致电 Hub。",
  tl: "Sira ang elevator sa 85 Thorncliffe Park Dr. Mangyaring gamitin ang hagdan at tawagan ang Hub kung kailangan ninyo ng tulong.",
  sk: "Výťah na 85 Thorncliffe Park Dr nefunguje. Použite prosím schody a zavolajte Hub, ak potrebujete pomoc.",
  es: "El ascensor en 85 Thorncliffe Park Dr está fuera de servicio. Por favor use las escaleras y llame al Hub si necesita ayuda.",
  fr: "L'ascenseur au 85 Thorncliffe Park Dr est hors service. Veuillez utiliser les escaliers et appeler le Hub si vous avez besoin d'aide.",
};

const URDU_ONLY = "ٹڈڑںےھہ";
const PASHTO_MARKERS = "ټډړږښګڼېۍ";

type Check = Pick<RouteRow, "eldCode" | "script" | "markerLetters" | "excludedLetters">;
const check = (eldCode: string | null, script: string, markerLetters = "", excludedLetters = ""): Check => ({ eldCode, script, markerLetters, excludedLetters });

const CHECKS: Record<string, Check> = {
  ps: check(null, "arabic", PASHTO_MARKERS, URDU_ONLY),
  prs: check("fa", "arabic", "", URDU_ONLY + PASHTO_MARKERS),
  ur: check("ur", "arabic"),
  hi: check("hi", "devanagari"),
  bn: check("bn", "bengali"),
  ta: check("ta", "tamil"),
  pa: check("pa", "gurmukhi"),
  gu: check("gu", "gujarati"),
  el: check("el", "greek"),
  zh: check("zh", "han"),
  tl: check("tl", "latin"),
  sk: check("sk", "latin"),
  es: check("es", "latin"),
  fr: check("fr", "latin"),
};

/** [language, models in order, attempt timeout of each in seconds]: the migration's seed. */
const SEEDED: [string, string[], number][] = [
  ["ps", [NORTH], 20],
  ["prs", [NORTH, COMMAND_A], 10],
  ["fr", [COMMAND_A, NORTH], 10],
  ["es", [COMMAND_A, NORTH], 10],
  ["zh", [COMMAND_A, NORTH], 10],
  ["el", [COMMAND_A, NORTH], 10],
  ["hi", [COMMAND_A, NORTH], 10],
  ["ur", [NORTH, AYA_FIRE], 10],
  ["bn", [NORTH, AYA_FIRE], 10],
  ["ta", [NORTH, AYA_FIRE], 10],
  ["pa", [NORTH, AYA_FIRE], 10],
  ["tl", [NORTH, AYA_WATER], 10],
  ["sk", [NORTH, AYA_WATER], 10],
  ["gu", [AYA_FIRE, NORTH], 10],
];

/** The rows of `translation_route` as the migration seeds them, provisional timeouts and all. */
export const SEEDED_ROUTE_ROWS: RouteRow[] = SEEDED.flatMap(([lang, models, seconds]) =>
  models.map((model, index) => ({ lang, position: index + 1, model, attemptTimeoutMs: seconds * 1000, ...CHECKS[lang]!, source: "provisional" })),
);

export const SEEDED_ROUTES = buildRoutes(SEEDED_ROUTE_ROWS);
