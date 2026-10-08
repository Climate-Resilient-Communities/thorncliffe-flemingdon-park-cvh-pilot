// The crisis-phrase check (crisisPhrases.ts): hand-written questions per language group, emergencies that must turn the 911 block on
// and ordinary questions (many of them close to an emergency word) that must not. The non-English examples are machine-assisted,
// like the lists, and are to be checked by native readers with them (docs/procedures/launch-checklist.md).
import { describe, expect, it } from "vitest";
import { CRISIS_PHRASE_LISTS, checkCrisisPhrases, describesEmergency, foldLetters, normaliseCrisisText, phraseSource } from "./crisisPhrases";

interface Group {
  name: string;
  emergency: string[];
  ordinary: string[];
}

const GROUPS: Group[] = [
  {
    name: "English",
    emergency: [
      "my dad collapsed and is not breathing",
      "My mother isn't breathing!!",
      "my baby can't breathe",
      "he stopped breathing",
      "she is having trouble breathing",
      "my husband is unconscious",
      "my grandma passed out and won't wake up",
      "I think my neighbour is having a heart attack",
      "my dad is having a stroke, his face is drooping",
      "my son is choking",
      "a child is drowning in the pool",
      "he is bleeding heavily from his arm",
      "there's blood everywhere",
      "my brother was stabbed",
      "someone got shot outside the building",
      "my friend overdosed",
      "my daughter swallowed pills",
      "I want to kill myself",
      "I don't want to live anymore",
      "my son is talking about suicide",
      "There is a fire in my apartment building and I need help right now",
      "the kitchen is on fire",
      "smoke is coming from under the door",
      "it smells like smoke in the hallway",
      "I smell gas in my apartment",
      "gas leak on the 5th floor",
      "the carbon monoxide alarm is going off",
      "our basement is flooded",
      "water is pouring through the ceiling onto the electrical outlets",
      "I was in a car accident on Overlea",
      "my kid was hit by a car",
      "someone is breaking into my house",
      "a man with a knife is outside my door",
      "my husband is hitting me",
      "my 5 year old daughter is missing",
      "I can't find my son anywhere",
      "please call an ambulance",
      "call 911",
      "call the police someone broke into my car",
      "this is an emergency",
      "My dad’s chest pain won’t stop",
    ],
    ordinary: [
      "where is the nearest gas station",
      "gas station open late",
      "fire station hours",
      "where is the fire station on Thorncliffe Park Drive",
      "how do I get a police clearance for a job",
      "police background check",
      "police record check for volunteering",
      "first aid course near me",
      "CPR class for parents",
      "do I need flood insurance",
      "where is the hospital",
      "Michael Garron hospital address",
      "free smoke detector",
      "where can I get a carbon monoxide detector",
      "accident insurance for my car",
      "car insurance help",
      "flu shot clinic",
      "where can I get a covid shot",
      "food bank near me",
      "emergency shelter for tonight",
      "emergency food",
      "I lost my job, where can I get help",
      "I got fired, what are my rights",
      "the heat in my apartment is not working",
      "my landlord is not responding",
      "free breakfast program",
      "mental health counselling for teens",
      "suicide prevention training for volunteers",
      "breathing exercises class",
      "shooting range",
      "library hours",
      "where can I cool down when it is hot",
      "air conditioning help for seniors",
      "lead poisoning testing for water",
      "how to report a break in from last week",
      "flood warning for Don Valley",
      "fireworks on Canada Day",
      "where to dispose of old batteries",
      "lost and found",
      "where can I find a lawyer for a car accident claim",
      "police station address",
      "send me directions to the police department",
    ],
  },
  {
    name: "Spanish",
    emergency: [
      "mi esposo se desmayó y no respira",
      "mi hijo no puede respirar",
      "mi abuela está inconsciente",
      "creo que mi papá tiene un ataque al corazón",
      "mi madre tuvo un derrame cerebral",
      "el bebé se está ahogando",
      "está sangrando mucho",
      "apuñalaron a mi vecino",
      "mi hija tomó muchas pastillas",
      "sobredosis",
      "quiero quitarme la vida",
      "me quiero morir",
      "hay un incendio en mi edificio",
      "la cocina está en llamas",
      "sale humo del apartamento",
      "huele a gas en la casa",
      "hay una fuga de gas",
      "el sótano está inundado",
      "entra mucha agua por el techo",
      "tuve un accidente de coche",
      "atropellaron a mi hijo",
      "Alguien intentó entrar a mi casa y necesito a la policía ahora",
      "mi esposo me está pegando",
      "un hombre con un cuchillo en la puerta",
      "mi hija está desaparecida",
      "no encuentro a mi niño",
      "llamen a una ambulancia",
      "llama a la policía",
    ],
    ordinary: [
      "¿dónde está la gasolinera más cercana?",
      "estación de bomberos horario",
      "curso de primeros auxilios",
      "seguro contra inundaciones",
      "¿dónde está el hospital?",
      "detector de humo gratis",
      "seguro de accidentes",
      "banco de comida cerca",
      "clases de inglés gratis",
      "ayuda con el alquiler",
      "mi casero no responde",
      "dónde comprar unos muebles baratos",
      "fuegos artificiales en julio",
      "certificado de antecedentes penales de la policía",
    ],
  },
  {
    name: "French",
    emergency: [
      "mon fils a avalé des médicaments il respire mal",
      "mon père ne respire plus",
      "ma mère est inconsciente",
      "il s'est évanoui",
      "je pense que c'est une crise cardiaque",
      "elle fait un AVC",
      "mon bébé s'étouffe",
      "il saigne beaucoup",
      "mon voisin a été poignardé",
      "je veux mourir",
      "il y a un incendie dans l'immeuble",
      "la cuisine est en feu",
      "ça sent le gaz chez moi",
      "fuite de gaz au 3e étage",
      "l'appartement est inondé",
      "j'ai eu un accident de voiture",
      "mon fils a été renversé par une voiture",
      "mon mari me frappe",
      "un homme avec un couteau",
      "quelqu'un est entré chez moi",
      "ma fille a disparu",
      "appelez une ambulance",
      "appelez la police",
    ],
    ordinary: [
      "où est la station-service la plus proche",
      "caserne de pompiers heures",
      "cours de premiers secours",
      "assurance inondation",
      "où est l'hôpital",
      "détecteur de fumée gratuit",
      "assurance accident",
      "banque alimentaire",
      "il fait trop chaud on étouffe dans l'appartement",
      "mon propriétaire ne répond plus",
      "feu d'artifice",
      "certificat de police pour un emploi",
    ],
  },
  {
    name: "Slovak",
    emergency: [
      "Horí v našom byte, pomoc!",
      "môj otec nedýcha",
      "mama je v bezvedomí",
      "odpadol a nereaguje",
      "myslím, že má infarkt",
      "dieťa sa dusí",
      "silno krváca",
      "cítiť plyn v byte",
      "únik plynu",
      "byt je zaplavený",
      "mal som autonehodu",
      "niekto sa vlámal do bytu",
      "muž s nožom pred dverami",
      "manžel ma bije",
      "syn sa stratil",
      "zavolajte záchranku",
      "zavolajte políciu",
      "chcem zomrieť",
    ],
    ordinary: [
      "kde je najbližšia čerpacia stanica",
      "hasičská stanica otváracie hodiny",
      "kurz prvej pomoci",
      "poistenie proti povodni",
      "kde je nemocnica",
      "detektor dymu zadarmo",
      "potravinová banka",
      "hory v okolí Toronta",
      "napadlo ma, či je tu knižnica",
      "výpis z registra trestov",
      "ambulancia praktického lekára",
      "ambulancia pôrodných asistentiek",
    ],
  },
  {
    name: "Hindi, Urdu, Punjabi, Gujarati (romanized)",
    emergency: [
      "koi ghar me ghus gaya hai police bulao abhi",
      "ghar mein aag lag gayi hai jaldi madad karo",
      "ghar ch agg lag gayi jaldi aao",
      "aag lagi chhe building ma jaldi madad",
      "papa saans nahi le rahe",
      "dadi behosh ho gayi",
      "mere pati ko dil ka daura pada",
      "bahut khoon nikal raha hai",
      "usne zeher kha liya",
      "main khudkushi karna chahta hoon",
      "mera bhai marna chahta hai",
      "ek aadmi chaku leke khada hai",
      "pati mujhe maar raha hai",
      "chor ghus gaya",
      "police ko bulao jaldi",
      "ambulance bulao",
      "gas leak ho rahi hai",
      "gas ki badbu aa rahi hai",
      "ghar mein paani bhar gaya",
      "accident ho gaya hai",
      "mera baccha kho gaya",
      "beti lapata hai",
    ],
    ordinary: [
      "mujhe khana kahan milega",
      "free English class kahan hai",
      "fire station kahan hai",
      "police clearance kaise milega",
      "hospital kahan hai",
      "ghar ka kiraya bahut zyada hai",
      "naukri chahiye",
      "doctor se milna hai",
      "bachon ke liye school",
      "gas station kidhar hai",
      "kal baad mein milte hain",
      "aagey kya karna hai",
    ],
  },
  {
    name: "Hindi, Punjabi, Gujarati, Bengali, Tamil (native scripts)",
    emergency: [
      "घर में आग लग गई है",
      "पापा सांस नहीं ले रहे",
      "मां बेहोश हो गई",
      "कोई घर में घुस गया है पुलिस बुलाओ",
      "एम्बुलेंस भेजो",
      "गैस लीक हो रही है",
      "ਘਰ ਵਿੱਚ ਅੱਗ ਲੱਗ ਗਈ",
      "ਪਿਤਾ ਜੀ ਸਾਹ ਨਹੀਂ ਲੈ ਰਹੇ",
      "ਪੁਲਿਸ ਨੂੰ ਬੁਲਾਓ",
      "ઘરમાં આગ લાગી છે",
      "દાદી બેભાન થઈ ગયા",
      "એમ્બ્યુલન્સ બોલાવો",
      "একজন লোক ছুরি নিয়ে হুমকি দিচ্ছে পুলিশ দরকার",
      "বাড়িতে আগুন লেগেছে",
      "বাবা অজ্ঞান হয়ে গেছে",
      "গ্যাসের গন্ধ পাচ্ছি",
      "வீட்டில் தீ பிடிச்சிருக்கு உடனே உதவி",
      "அப்பா மூச்சு விடவில்லை",
      "ஆம்புலன்ஸ் அழையுங்கள்",
      "கார் விபத்து நடந்தது",
    ],
    ordinary: [
      "मुझे मुफ्त खाना कहाँ मिलेगा",
      "अस्पताल कहाँ है",
      "ਮੁਫ਼ਤ ਭੋਜਨ ਕਿੱਥੇ ਮਿਲੇਗਾ",
      "ਹਸਪਤਾਲ ਕਿੱਥੇ ਹੈ",
      "મફત ખોરાક ક્યાં મળે",
      "પૂરતું ખાવાનું નથી",
      "বিনামূল্যে খাবার কোথায় পাব",
      "হাসপাতাল কোথায়",
      "எனக்கு உணவு எங்கே கிடைக்கும்?",
      "இந்த பிரச்சனைக்கு தீர்வு என்ன",
      "தீயணைப்பு நிலையம் எங்கே",
      "आग बुझाने वाला स्टेशन कहाँ है",
      "ਅੱਗ ਬੁਝਾਊ ਸਟੇਸ਼ਨ ਕਿੱਥੇ ਹੈ",
    ],
  },
  {
    name: "Urdu, Dari, Pashto (Arabic script)",
    emergency: [
      "گھر میں آگ لگ گئی ہے",
      "ابو سانس نہیں لے رہے",
      "امی بے ہوش ہو گئیں",
      "کوئی گھر میں گھس گیا ہے پولیس کو بلاؤ",
      "ایمبولینس بلائیں",
      "پدرم نفس کشیده نمیتانه زود آمبولانس",
      "خانه آتش گرفته",
      "مادرم بیهوش شده",
      "بوی گاز میاید",
      "خانه را آب گرفته",
      "تصادف کردم",
      "می‌خواهم بمیرم",
      "یو سړی مې ګواښي او زما د دروازې مخې ته ولاړ دی ژر پولیس",
      "کور کې اور لګېدلی",
      "پلار مې بې هوښه دی",
      "امبولانس ته اړتیا لرو",
      "ماشوم مې ورک دی",
    ],
    ordinary: [
      "مجھے مفت کھانا کہاں ملے گا",
      "ہسپتال کہاں ہے",
      "میں اور میرا بیٹا انگریزی کلاس چاہتے ہیں",
      "اگر کرایہ نہ دے سکوں تو کیا کروں",
      "غذای رایگان کجا پیدا میشه",
      "شفاخانه کجاست",
      "اعتماد به نفس ندارم مشاوره میخواهم",
      "آتش نشانی کجاست",
      "وړیا خواړه چیرته ترلاسه کولی شم",
      "روغتون چیرته دی",
      "د کور خاوند مې له کوره باسي حقوقي مرسته غواړم",
      "آگ بجھانے والا اسٹیشن کہاں ہے",
      "ایستگاه آتش‌نشانی کجاست",
    ],
  },
  {
    name: "Greek",
    emergency: [
      "Πλημμύρισε το διαμέρισμα, τρέχει νερό από το ταβάνι πάνω στα ηλεκτρικά",
      "ο πατέρας μου δεν αναπνέει",
      "η μητέρα μου λιποθύμησε",
      "νομίζω ότι παθαίνει έμφραγμα",
      "υπάρχει φωτιά στην κουζίνα",
      "μυρίζει γκάζι στο σπίτι",
      "είχα τροχαίο",
      "κάποιος μπήκε στο σπίτι",
      "ένας άντρας με μαχαίρι",
      "καλέστε ασθενοφόρο",
      "το παιδί μου εξαφανίστηκε",
      "θέλω να πεθάνω",
    ],
    ordinary: [
      "πού μπορώ να βρω δωρεάν φαγητό",
      "πού είναι το νοσοκομείο",
      "ασφάλιση πλημμύρας",
      "ανιχνευτής καπνού δωρεάν",
      "μαθήματα αγγλικών",
      "πού είναι η πυροσβεστική",
    ],
  },
  {
    name: "Chinese",
    emergency: [
      "有人在楼下打我 快报警",
      "我爸爸没有呼吸了",
      "我妈妈晕倒了",
      "我觉得他心脏病发作",
      "家里着火了",
      "厨房冒烟了",
      "家里有煤气味",
      "地下室淹水了",
      "我出车祸了",
      "我的孩子不见了",
      "快叫救护车",
      "他拿刀威胁我",
      "我不想活了",
      "我女兒呼吸困難",
      "家裡著火了",
    ],
    ordinary: [
      "哪里有免费食物",
      "医院在哪里",
      "最近的加油站在哪里",
      "消防局的开放时间",
      "请打我电话",
      "怎么申请无犯罪记录证明",
      "急救课程",
      "免费的烟雾报警器",
      "火车站怎么走",
      "洪水保险",
    ],
  },
  {
    name: "Tagalog",
    emergency: [
      "amoy na amoy gas sa bahay namin tulong po",
      "naaksidente ako sa sasakyan ngayon",
      "may sunog sa building namin",
      "hindi humihinga ang tatay ko",
      "hinimatay ang nanay ko",
      "inatake sa puso si lolo",
      "dumudugo nang husto ang anak ko",
      "may lalaking may kutsilyo sa labas",
      "binubugbog ako ng asawa ko",
      "may pumasok sa bahay namin",
      "nawawala ang anak ko",
      "tumawag ng ambulansya",
      "tawagan ang pulis",
      "binabaha ang bahay namin",
      "gusto ko nang mamatay",
    ],
    ordinary: [
      "saan ang pinakamalapit na gasolinahan",
      "padalhan ako ng mga direksyon sa departamento ng pulisya",
      "Saan ako makakakuha ng pagkain?",
      "nasaan ang ospital",
      "libreng klase sa Ingles",
      "kailan ang susunod na bus",
      "trabaho para sa mga estudyante",
    ],
  },
];

describe("the crisis-phrase check", () => {
  for (const group of GROUPS) {
    describe(group.name, () => {
      it.each(group.emergency)("an emergency: %s", (text) => {
        expect(checkCrisisPhrases(text).crisis).toBe(true);
      });
      it.each(group.ordinary)("not an emergency: %s", (text) => {
        expect(checkCrisisPhrases(text).crisis).toBe(false);
      });
    });
  }

  it("has about forty examples for each major language group", () => {
    const sizes = Object.fromEntries(GROUPS.map((g) => [g.name, g.emergency.length + g.ordinary.length]));
    for (const name of ["English", "Spanish", "French", "Hindi, Urdu, Punjabi, Gujarati (romanized)", "Hindi, Punjabi, Gujarati, Bengali, Tamil (native scripts)", "Urdu, Dari, Pashto (Arabic script)"]) {
      expect(sizes[name], name).toBeGreaterThanOrEqual(25);
    }
    expect(sizes.English).toBeGreaterThanOrEqual(80);
  });

  it("says when an ordinary phrase was masked, and a masked phrase never hides an emergency described beside it", () => {
    expect(checkCrisisPhrases("where is the nearest gas station")).toEqual({ crisis: false, masked: true });
    expect(checkCrisisPhrases("I smell gas near the gas station")).toEqual({ crisis: true, masked: true });
    expect(checkCrisisPhrases("the smoke detector is beeping and there is smoke everywhere").crisis).toBe(true);
    expect(checkCrisisPhrases("the smoke alarm is going off")).toEqual({ crisis: true, masked: false });
    expect(checkCrisisPhrases("food bank")).toEqual({ crisis: false, masked: false });
  });

  it("reads the question and its English translation, either one", () => {
    expect(describesEmergency(["naaksidente ako", null])).toBe(true);
    expect(describesEmergency(["xyz", "I had a car accident today."])).toBe(true);
    expect(describesEmergency(["where can I get food?", undefined])).toBe(false);
    expect(describesEmergency([])).toBe(false);
  });

  it("normalises case, accents, digits of any script, joiners, curly apostrophes and punctuation", () => {
    expect(normaliseCrisisText("¡Llamen al ۹۱۱!")).toBe("llamen al 911");
    expect(normaliseCrisisText("Mon père s’est ÉVANOUI.")).toBe("mon pere s'est evanoui");
    expect(foldLetters("می‌خواهم")).toBe(foldLetters("میخواهم"));
    expect(foldLetters("ΠΛΗΜΜΎΡΑΣ")).toBe("πλημμυρασ");
    expect(checkCrisisPhrases("call ९११").crisis).toBe(true);
    expect(checkCrisisPhrases("my phone is 416-911-0000 for the food bank").crisis).toBe(false);
    expect(checkCrisisPhrases("SOMEONE IS BREAKING IN").crisis).toBe(true);
  });

  it("matches whole words, but Chinese anywhere in the text", () => {
    expect(checkCrisisPhrases("aagey").crisis).toBe(false);
    expect(checkCrisisPhrases("aag").crisis).toBe(true);
    expect(checkCrisisPhrases("请帮忙我家着火了").crisis).toBe(true);
    expect(phraseSource("911")).toBe("(?<![0-9]\\s?)(?:911)(?!\\s?[0-9])");
  });

  it("marks every list but English as machine-assisted, to be checked by native readers", () => {
    for (const list of CRISIS_PHRASE_LISTS) expect(list.review, list.group).toBe(list.group === "en" ? "checked" : "machine_assisted");
  });

  it("compiles every phrase and mask of every list, and each list has phrases", () => {
    for (const list of CRISIS_PHRASE_LISTS) {
      expect(list.phrases.length, list.group).toBeGreaterThan(0);
      for (const phrase of [...list.phrases, ...list.masks]) expect(() => new RegExp(phraseSource(phrase), "u"), phrase).not.toThrow();
    }
  });

  it("is quick on the longest question", () => {
    const long = "where can I find help for my family ".repeat(6).slice(0, 200);
    checkCrisisPhrases(long);
    const started = performance.now();
    for (let i = 0; i < 20; i++) checkCrisisPhrases(long);
    expect((performance.now() - started) / 20).toBeLessThan(25);
  });
});
