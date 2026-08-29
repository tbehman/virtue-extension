// defaultKeywords.js
// Comprehensive high-risk keyword & pattern matching engine

// 1. Direct Explicit Terms, Platforms & Adult Domain Triggers
const CORE_EXPLICIT_TERMS = [
  // Major Adult Platforms & Tube Sites
  "pornhub", "xvideos", "xnxx", "xhamster", "redtube", "youporn", "brazzers",
  "chaturbate", "stripchat", "spankbang", "erome", "rule34", "coomer", "kemono",
  "onlyfans", "fansly", "patreon leak", "fapello", "eporner", "youjizz", "tube8",
  "beeg", "porn300", "heavy-r", "motherless", "xkeez", "tnaflix", "xgroovy",

  // Core Graphic Terms & Act Slang
  "porn", "porno", "pornography", "xxx", "nsfw", "anal", "blowjob", "handjob",
  "creampie", "squirt", "squirting", "gangbang", "bukkake", "deepthroat", "cum",
  "cumshot", "facial", "rimjob", "anilingus", "facesitting", "peg", "pegging",
  "orgasm", "ejaculation", "hardcore", "softcore", "erotic", "erotica", "hentai",
  "ahegao", "ecchi", "hentaihaven", "fap", "fapping", "goon", "gooning", "edge",
  "edging", "cuckold", "swinger", "swingers", "threesome", "orgy", "gloryhole",
  "bdsm", "bondage", "sadism", "masochism", "fetish", "voyeur", "exhibitionist",

  // Explicit Descriptors & Slang
  "boobs", "tits", "titties", "pussy", "vagina", "clitoris", "penis", "dick",
  "cock", "dildo", "vibrator", "sybian", "hentai", "shemale", "tranny", "femboy",
  "milf", "dilf", "gilf", "pinay", "latina", "ebony", "bbw", "milf", "tradwife"
];

// 2. Compound Word Generators (e.g., sexvideo, adultcams, nakedpics, xvideo)
const COMPOUND_PATTERN = 
  "\\b(sex|adult|erotic|nsfw|xxx|cam|nude|naked|porn|x)(vid|vids|video|videos|tube|cams|cam|site|sites|pic|pics|club|hub|star|stars|movie|movies)\\b";

// 3. High-Risk Intent Phrases & Search Contexts
const PHRASE_PATTERNS = [
  "\\b(watch|free|hd|full|online)\\s+(sex|porn|nudes|hentai|blowjob|anal)\\b",
  "\\b(naked|nude|topless|uncensored|leaked)\\s+(pics|photos|video|videos|cam|women|girls|celebrity|model|streamer)\\b",
  "\\b(sex|porn)\\s+(tape|video|pics|scene|site|hub|tube|leak|leaks|game|games)\\b",
  "\\b(stepmom|stepsister|stepdaughter|stepmother|milf|teacher|student|roommate|coworker)\\s+(sex|porn|nude|naked|creampie|threesome)\\b",
  "\\b(how\\s+to)\\s+(squirt|eat\\s+pussy|suck\\s+dick|finger|jerk\\s+off)\\b",
  "\\b(jerk\\s+off|try\\s+not\\s+to\\s+cum|no\\s+nut)\\s+(challenge|instructions|joi)\\b"
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