// defaultKeywords.js
// Global high-risk keyword & pattern matching engine (~90%+ population coverage + PH Dialects)

// 1. Direct Explicit Terms, Platforms & Adult Domain Triggers
const CORE_EXPLICIT_TERMS = [
  // Major Adult Platforms & Tube Sites
  "pornhub", "xvideos", "xnxx", "xhamster", "redtube", "youporn", "brazzers",
  "chaturbate", "stripchat", "spankbang", "erome", "rule34", "coomer", "kemono",
  "onlyfans", "fansly", "patreon leak", "fapello", "eporner", "youjizz", "tube8",
  "beeg", "porn300", "heavy-r", "motherless", "xkeez", "tnaflix", "xgroovy",

  // Core Graphic Terms & Act Slang (English)
  "porn", "porno", "pornography", "xxx", "nsfw", "anal", "analsex", "blowjob", "handjob",
  "creampie", "squirt", "squirting", "gangbang", "bukkake", "deepthroat", "cum",
  "cumshot", "facial", "rimjob", "anilingus", "facesitting", "peg", "pegging",
  "orgasm", "ejaculation", "hardcore", "softcore", "erotic", "erotica", "hentai",
  "ahegao", "ecchi", "hentaihaven", "fap", "fapping", "goon", "gooning", "edge",
  "edging", "cuckold", "swinger", "swingers", "threesome", "orgy", "gloryhole",
  "bdsm", "bondage", "sadism", "masochism", "fetish", "voyeur", "exhibitionist",

  // --- PHILIPPINES: 8 MAJOR REGIONAL LANGUAGES & DIALECTS ---
  // Tagalog / Taglish & Ligatures
  "bastos", "jakol", "kantot", "kantutan", "puki", "pekpek", "suso", "hinaharap",
  "tamod", "bayag", "chupa", "chupain", "libog", "malibog", "iyot", "iyotero",
  "hubad", "hubo", "nakahubad", "kantyot", "boso", "bosero", "libre", "libreng", "bold",

  // Cebuano / Bisaya
  "luwa", "bilat", "otan", "iyot", "lason", "boto", "kayat", "hubo", "lahi",

  // Ilocano
  "ukis", "uki", "butong", "iyot", "kantot", "ubing", "aglabas", "lubas",

  // Hiligaynon / Ilonggo
  "poto", "bilat", "iyot", "lason", "boto", "kadyot",

  // Bicolano
  "buray", "lasog", "iyot", "huba",

  // Waray
  "bilat", "iyot", "huba", "hubo", "kayat",

  // Kapampangan
  "puking", "pota", "buldit", "kaboso",

  // Pangasinan
  "iyot", "laki", "hubo",

  // --- GLOBAL TOP LANGUAGES ---
  // Spanish & Portuguese
  "desnuda", "desnudo", "desnudas", "tetas", "panocha", "pinga", "follar", "cojer",
  "chupada", "pelada", "pelado", "gostosa", "safada", "buceta", "caralho", "putaria",

  // Hindi & Urdu (Hinglish)
  "nanga", "nangi", "chodna", "chudai", "gand", "gaand", "bhabhi", "muth", "muthal",
  "randi", "choot", "lund", "chudasi",

  // French
  "pornographie", "sexe", "nue", "nues", "nichons", "chatte", "baiser", "baise", "salope",

  // Indonesian / Malay
  "bokep", "mesum", "telanjang", "kontol", "memek", "ngewe", "sanguan",

  // Mandarin Chinese (Pinyin)
  "seqing", "huangse", "luoti", "mimi", "xiaojie", "yuse",

  // Arabic (Romanized)
  "jins", "jinsi", "siks", "fadiha", "muta", "sharmota", "nikah",

  // Russian / Slavic
  "seks", "golaya", "golyi", "siski", "pizda", "ebat", "poshloye",

  // Turkish
  "seks", "ciplak", "amcik", "yarrak", "sikis", "sikiş",

  // Vietnamese
  "phimsex", "dambao", "khongmacgi", "khoehang", "sexx",

  // Thai (Romanized)
  "pudso", "yadso", "nangx", "clipx",

  // Japanese (Romaji)
  "erodouga", "chikan", "avjoyu", "sukebe",

  // German & Italian
  "brüste", "ficken", "pornos", "scheide", "figa", "zoccola",

  // Explicit Descriptors & Slang
  "boobs", "tits", "titties", "pussy", "vagina", "clitoris", "penis", "dick",
  "cock", "dildo", "vibrator", "sybian", "shemale", "tranny", "femboy",
  "milf", "dilf", "gilf", "pinay", "latina", "ebony", "bbw", "tradwife"
];

// 2. Compound Word Generators (Cross-Language Compatible)
const COMPOUND_PATTERN = 
  "\\b(anal|sex|adult|erotic|nsfw|xxx|cam|nude|naked|porn|x|bold|pinay|bastos|jakol|bhabhi|nangi|bokep|phim|bisaya|ilonggo|cebuana|libre|libreng)(sex|vid|vids|video|videos|tube|cams|cam|site|sites|pic|pics|club|hub|star|stars|movie|movies|scandal|leaks)\\b";

// 3. High-Risk Intent Phrases & Search Contexts
const PHRASE_PATTERNS = [
  // English & Taglish Intent Defaults (Updated for "libreng bold video online")
  "\\b(watch|free|hd|full|online|libre|libreng)\\s+.*(sex|porn|nudes|hentai|blowjob|anal|bold|bastos|kantutan|porno)\\b",
  "\\b(bold|bastos|porno)\\s+.*(video|videos|vid|vids|movie|movies|pic|pics|site|online)\\b",
  "\\b(naked|nude|topless|uncensored|leaked)\\s+(pics|photos|video|videos|cam|women|girls|celebrity|model|streamer)\\b",
  "\\b(sex|porn)\\s+(tape|video|pics|scene|site|hub|tube|leak|leaks|game|games)\\b",
  "\\b(stepmom|stepsister|stepdaughter|stepmother|milf|teacher|student|roommate|coworker)\\s+(sex|porn|nude|naked|creampie|threesome)\\b",
  "\\b(how\\s+to|paano|paano\\s+mag)\\s+(squirt|eat\\s+pussy|suck\\s+dick|finger|jerk\\s+off|jakol|kantot|chupa|tamod)\\b",
  "\\b(jerk\\s+off|try\\s+not\\s+to\\s+cum|no\\s+nut)\\s+(challenge|instructions|joi)\\b",

  // PH Regional Intent Patterns
  "\\b(pinay|pinoy|local|asian|cebuana|ilongga|ilocana|dabawenya|bicolana|waray)\\s+(scandal|leaks|leak|bold|kantutan|jakol|bastos|iyot)\\b",
  "\\b(mga|larawan|litrato|video|vid)\\s+(ng\\s+nakahubad|bastos|malibog|palabas|hubo)\\b",

  // South Asian Intent
  "\\b(deshi|dehati|indian|pakistani|bhabhi)\\s+(scandal|mms|nude|sex|video|viral|chudai)\\b",
  "\\b(nangi|nanga|hot)\\s+(bhabhi|ladki|aunty|girl|photo|video)\\b",

  // Spanish, Portuguese & French Intent
  "\\b(ver|watch|fotos|videos|regarder)\\s+(porno|desnudas|sexo|gratis|pelada|nue)\\b",

  // Vietnamese Intent
  "\\b(xem|tai|phim)\\s+(sex|dam|khong\\s+mac\\s+gi|clip\\s+nong)\\b"
];

// Compile into an Array of executable RegExp Objects at Service Worker startup
export const COMPILED_KEYWORD_REGEXES = [
  // Group 1: Single explicit word matching with strict word boundaries
  new RegExp(`\\b(${CORE_EXPLICIT_TERMS.join('|')})\\b`, 'i'),

  // Group 2: Compound merged words
  new RegExp(COMPOUND_PATTERN, 'i'),

  // Group 3: Intent-paired phrase patterns
  ...PHRASE_PATTERNS.map(pattern => new RegExp(pattern, 'i'))
];