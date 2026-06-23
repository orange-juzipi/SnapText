export const AUTO_SOURCE_LANG = "auto";
export const DEFAULT_TARGET_LANG = "en";

export type GoogleTranslateLanguage = {
  code: string;
  englishName: string;
  chineseName: string;
  nativeName: string;
};

export const GOOGLE_TRANSLATE_LANGUAGES: GoogleTranslateLanguage[] = [
  { code: "af", englishName: "Afrikaans", chineseName: "南非荷兰语", nativeName: "Afrikaans" },
  { code: "sq", englishName: "Albanian", chineseName: "阿尔巴尼亚语", nativeName: "Shqip" },
  { code: "am", englishName: "Amharic", chineseName: "阿姆哈拉语", nativeName: "አማርኛ" },
  { code: "ar", englishName: "Arabic", chineseName: "阿拉伯语", nativeName: "العربية" },
  { code: "hy", englishName: "Armenian", chineseName: "亚美尼亚语", nativeName: "Հայերեն" },
  { code: "as", englishName: "Assamese", chineseName: "阿萨姆语", nativeName: "অসমীয়া" },
  { code: "ay", englishName: "Aymara", chineseName: "艾马拉语", nativeName: "Aymar aru" },
  { code: "az", englishName: "Azerbaijani", chineseName: "阿塞拜疆语", nativeName: "Azərbaycanca" },
  { code: "bm", englishName: "Bambara", chineseName: "班巴拉语", nativeName: "Bamanankan" },
  { code: "eu", englishName: "Basque", chineseName: "巴斯克语", nativeName: "Euskara" },
  { code: "be", englishName: "Belarusian", chineseName: "白俄罗斯语", nativeName: "Беларуская" },
  { code: "bn", englishName: "Bengali", chineseName: "孟加拉语", nativeName: "বাংলা" },
  { code: "bho", englishName: "Bhojpuri", chineseName: "博杰普尔语", nativeName: "भोजपुरी" },
  { code: "bs", englishName: "Bosnian", chineseName: "波斯尼亚语", nativeName: "Bosanski" },
  { code: "bg", englishName: "Bulgarian", chineseName: "保加利亚语", nativeName: "Български" },
  { code: "ca", englishName: "Catalan", chineseName: "加泰罗尼亚语", nativeName: "Català" },
  { code: "ceb", englishName: "Cebuano", chineseName: "宿务语", nativeName: "Cebuano" },
  { code: "zh_cn", englishName: "Chinese (Simplified)", chineseName: "中文（简体）", nativeName: "简体中文" },
  { code: "zh_tw", englishName: "Chinese (Traditional)", chineseName: "中文（繁体）", nativeName: "繁體中文" },
  { code: "co", englishName: "Corsican", chineseName: "科西嘉语", nativeName: "Corsu" },
  { code: "hr", englishName: "Croatian", chineseName: "克罗地亚语", nativeName: "Hrvatski" },
  { code: "cs", englishName: "Czech", chineseName: "捷克语", nativeName: "Čeština" },
  { code: "da", englishName: "Danish", chineseName: "丹麦语", nativeName: "Dansk" },
  { code: "dv", englishName: "Dhivehi", chineseName: "迪维希语", nativeName: "ދިވެހި" },
  { code: "doi", englishName: "Dogri", chineseName: "多格拉语", nativeName: "डोगरी" },
  { code: "nl", englishName: "Dutch", chineseName: "荷兰语", nativeName: "Nederlands" },
  { code: "en", englishName: "English", chineseName: "英语", nativeName: "English" },
  { code: "eo", englishName: "Esperanto", chineseName: "世界语", nativeName: "Esperanto" },
  { code: "et", englishName: "Estonian", chineseName: "爱沙尼亚语", nativeName: "Eesti" },
  { code: "ee", englishName: "Ewe", chineseName: "埃维语", nativeName: "Eʋegbe" },
  { code: "fil", englishName: "Filipino", chineseName: "菲律宾语", nativeName: "Filipino" },
  { code: "fi", englishName: "Finnish", chineseName: "芬兰语", nativeName: "Suomi" },
  { code: "fr", englishName: "French", chineseName: "法语", nativeName: "Français" },
  { code: "fy", englishName: "Frisian", chineseName: "弗里西语", nativeName: "Frysk" },
  { code: "gl", englishName: "Galician", chineseName: "加利西亚语", nativeName: "Galego" },
  { code: "ka", englishName: "Georgian", chineseName: "格鲁吉亚语", nativeName: "ქართული" },
  { code: "de", englishName: "German", chineseName: "德语", nativeName: "Deutsch" },
  { code: "el", englishName: "Greek", chineseName: "希腊语", nativeName: "Ελληνικά" },
  { code: "gn", englishName: "Guarani", chineseName: "瓜拉尼语", nativeName: "Avañe'ẽ" },
  { code: "gu", englishName: "Gujarati", chineseName: "古吉拉特语", nativeName: "ગુજરાતી" },
  { code: "ht", englishName: "Haitian Creole", chineseName: "海地克里奥尔语", nativeName: "Kreyòl ayisyen" },
  { code: "ha", englishName: "Hausa", chineseName: "豪萨语", nativeName: "Hausa" },
  { code: "haw", englishName: "Hawaiian", chineseName: "夏威夷语", nativeName: "ʻŌlelo Hawaiʻi" },
  { code: "he", englishName: "Hebrew", chineseName: "希伯来语", nativeName: "עברית" },
  { code: "hi", englishName: "Hindi", chineseName: "印地语", nativeName: "हिन्दी" },
  { code: "hmn", englishName: "Hmong", chineseName: "苗语", nativeName: "Hmong" },
  { code: "hu", englishName: "Hungarian", chineseName: "匈牙利语", nativeName: "Magyar" },
  { code: "is", englishName: "Icelandic", chineseName: "冰岛语", nativeName: "Íslenska" },
  { code: "ig", englishName: "Igbo", chineseName: "伊博语", nativeName: "Igbo" },
  { code: "ilo", englishName: "Ilocano", chineseName: "伊洛卡诺语", nativeName: "Ilokano" },
  { code: "id", englishName: "Indonesian", chineseName: "印尼语", nativeName: "Indonesia" },
  { code: "ga", englishName: "Irish", chineseName: "爱尔兰语", nativeName: "Gaeilge" },
  { code: "it", englishName: "Italian", chineseName: "意大利语", nativeName: "Italiano" },
  { code: "ja", englishName: "Japanese", chineseName: "日语", nativeName: "日本語" },
  { code: "jv", englishName: "Javanese", chineseName: "爪哇语", nativeName: "Basa Jawa" },
  { code: "kn", englishName: "Kannada", chineseName: "卡纳达语", nativeName: "ಕನ್ನಡ" },
  { code: "kk", englishName: "Kazakh", chineseName: "哈萨克语", nativeName: "Қазақ тілі" },
  { code: "km", englishName: "Khmer", chineseName: "高棉语", nativeName: "ខ្មែរ" },
  { code: "rw", englishName: "Kinyarwanda", chineseName: "卢旺达语", nativeName: "Kinyarwanda" },
  { code: "gom", englishName: "Konkani", chineseName: "孔卡尼语", nativeName: "कोंकणी" },
  { code: "ko", englishName: "Korean", chineseName: "韩语", nativeName: "한국어" },
  { code: "kri", englishName: "Krio", chineseName: "克里奥语", nativeName: "Krio" },
  { code: "ku", englishName: "Kurdish (Kurmanji)", chineseName: "库尔德语（库尔曼吉）", nativeName: "Kurdî" },
  { code: "ckb", englishName: "Kurdish (Sorani)", chineseName: "库尔德语（索拉尼）", nativeName: "کوردی" },
  { code: "ky", englishName: "Kyrgyz", chineseName: "吉尔吉斯语", nativeName: "Кыргызча" },
  { code: "lo", englishName: "Lao", chineseName: "老挝语", nativeName: "ລາວ" },
  { code: "la", englishName: "Latin", chineseName: "拉丁语", nativeName: "Latina" },
  { code: "lv", englishName: "Latvian", chineseName: "拉脱维亚语", nativeName: "Latviešu" },
  { code: "ln", englishName: "Lingala", chineseName: "林加拉语", nativeName: "Lingála" },
  { code: "lt", englishName: "Lithuanian", chineseName: "立陶宛语", nativeName: "Lietuvių" },
  { code: "lg", englishName: "Luganda", chineseName: "卢干达语", nativeName: "Luganda" },
  { code: "lb", englishName: "Luxembourgish", chineseName: "卢森堡语", nativeName: "Lëtzebuergesch" },
  { code: "mk", englishName: "Macedonian", chineseName: "马其顿语", nativeName: "Македонски" },
  { code: "mai", englishName: "Maithili", chineseName: "迈蒂利语", nativeName: "मैथिली" },
  { code: "mg", englishName: "Malagasy", chineseName: "马尔加什语", nativeName: "Malagasy" },
  { code: "ms", englishName: "Malay", chineseName: "马来语", nativeName: "Melayu" },
  { code: "ml", englishName: "Malayalam", chineseName: "马拉雅拉姆语", nativeName: "മലയാളം" },
  { code: "mt", englishName: "Maltese", chineseName: "马耳他语", nativeName: "Malti" },
  { code: "mi", englishName: "Maori", chineseName: "毛利语", nativeName: "Māori" },
  { code: "mr", englishName: "Marathi", chineseName: "马拉地语", nativeName: "मराठी" },
  { code: "mni-Mtei", englishName: "Meiteilon (Manipuri)", chineseName: "梅泰语（曼尼普尔语）", nativeName: "ꯃꯤꯇꯩꯂꯣꯟ" },
  { code: "lus", englishName: "Mizo", chineseName: "米佐语", nativeName: "Mizo tawng" },
  { code: "mn", englishName: "Mongolian", chineseName: "蒙古语", nativeName: "Монгол" },
  { code: "my", englishName: "Myanmar (Burmese)", chineseName: "缅甸语", nativeName: "မြန်မာ" },
  { code: "ne", englishName: "Nepali", chineseName: "尼泊尔语", nativeName: "नेपाली" },
  { code: "no", englishName: "Norwegian", chineseName: "挪威语", nativeName: "Norsk" },
  { code: "ny", englishName: "Nyanja (Chichewa)", chineseName: "齐切瓦语", nativeName: "Chichewa" },
  { code: "or", englishName: "Odia (Oriya)", chineseName: "奥里亚语", nativeName: "ଓଡ଼ିଆ" },
  { code: "om", englishName: "Oromo", chineseName: "奥罗莫语", nativeName: "Afaan Oromoo" },
  { code: "ps", englishName: "Pashto", chineseName: "普什图语", nativeName: "پښتو" },
  { code: "fa", englishName: "Persian", chineseName: "波斯语", nativeName: "فارسی" },
  { code: "pl", englishName: "Polish", chineseName: "波兰语", nativeName: "Polski" },
  { code: "pt", englishName: "Portuguese", chineseName: "葡萄牙语", nativeName: "Português" },
  { code: "pa", englishName: "Punjabi", chineseName: "旁遮普语", nativeName: "ਪੰਜਾਬੀ" },
  { code: "qu", englishName: "Quechua", chineseName: "克丘亚语", nativeName: "Runasimi" },
  { code: "ro", englishName: "Romanian", chineseName: "罗马尼亚语", nativeName: "Română" },
  { code: "ru", englishName: "Russian", chineseName: "俄语", nativeName: "Русский" },
  { code: "sm", englishName: "Samoan", chineseName: "萨摩亚语", nativeName: "Gagana Samoa" },
  { code: "sa", englishName: "Sanskrit", chineseName: "梵语", nativeName: "संस्कृतम्" },
  { code: "gd", englishName: "Scots Gaelic", chineseName: "苏格兰盖尔语", nativeName: "Gàidhlig" },
  { code: "nso", englishName: "Sepedi", chineseName: "北索托语", nativeName: "Sepedi" },
  { code: "sr", englishName: "Serbian", chineseName: "塞尔维亚语", nativeName: "Српски" },
  { code: "st", englishName: "Sesotho", chineseName: "塞索托语", nativeName: "Sesotho" },
  { code: "sn", englishName: "Shona", chineseName: "修纳语", nativeName: "ChiShona" },
  { code: "sd", englishName: "Sindhi", chineseName: "信德语", nativeName: "سنڌي" },
  { code: "si", englishName: "Sinhala", chineseName: "僧伽罗语", nativeName: "සිංහල" },
  { code: "sk", englishName: "Slovak", chineseName: "斯洛伐克语", nativeName: "Slovenčina" },
  { code: "sl", englishName: "Slovenian", chineseName: "斯洛文尼亚语", nativeName: "Slovenščina" },
  { code: "so", englishName: "Somali", chineseName: "索马里语", nativeName: "Soomaali" },
  { code: "es", englishName: "Spanish", chineseName: "西班牙语", nativeName: "Español" },
  { code: "su", englishName: "Sundanese", chineseName: "巽他语", nativeName: "Basa Sunda" },
  { code: "sw", englishName: "Swahili", chineseName: "斯瓦希里语", nativeName: "Kiswahili" },
  { code: "sv", englishName: "Swedish", chineseName: "瑞典语", nativeName: "Svenska" },
  { code: "tl", englishName: "Tagalog", chineseName: "他加禄语", nativeName: "Tagalog" },
  { code: "tg", englishName: "Tajik", chineseName: "塔吉克语", nativeName: "Тоҷикӣ" },
  { code: "ta", englishName: "Tamil", chineseName: "泰米尔语", nativeName: "தமிழ்" },
  { code: "tt", englishName: "Tatar", chineseName: "鞑靼语", nativeName: "Татар" },
  { code: "te", englishName: "Telugu", chineseName: "泰卢固语", nativeName: "తెలుగు" },
  { code: "th", englishName: "Thai", chineseName: "泰语", nativeName: "ไทย" },
  { code: "ti", englishName: "Tigrinya", chineseName: "提格利尼亚语", nativeName: "ትግርኛ" },
  { code: "ts", englishName: "Tsonga", chineseName: "聪加语", nativeName: "Tsonga" },
  { code: "tr", englishName: "Turkish", chineseName: "土耳其语", nativeName: "Türkçe" },
  { code: "tk", englishName: "Turkmen", chineseName: "土库曼语", nativeName: "Türkmençe" },
  { code: "ak", englishName: "Twi (Akan)", chineseName: "契维语（阿坎语）", nativeName: "Twi" },
  { code: "uk", englishName: "Ukrainian", chineseName: "乌克兰语", nativeName: "Українська" },
  { code: "ur", englishName: "Urdu", chineseName: "乌尔都语", nativeName: "اردو" },
  { code: "ug", englishName: "Uyghur", chineseName: "维吾尔语", nativeName: "ئۇيغۇرچە" },
  { code: "uz", englishName: "Uzbek", chineseName: "乌兹别克语", nativeName: "Oʻzbekcha" },
  { code: "vi", englishName: "Vietnamese", chineseName: "越南语", nativeName: "Tiếng Việt" },
  { code: "cy", englishName: "Welsh", chineseName: "威尔士语", nativeName: "Cymraeg" },
  { code: "xh", englishName: "Xhosa", chineseName: "科萨语", nativeName: "IsiXhosa" },
  { code: "yi", englishName: "Yiddish", chineseName: "意第绪语", nativeName: "ייִדיש" },
  { code: "yo", englishName: "Yoruba", chineseName: "约鲁巴语", nativeName: "Yorùbá" },
  { code: "zu", englishName: "Zulu", chineseName: "祖鲁语", nativeName: "IsiZulu" },
];

export function normalizeLangCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase().replace(/_/g, "-");
  if (lowered === "zh" || lowered === "zh-cn" || lowered === "zh-hans") return "zh_cn";
  if (lowered === "zh-tw" || lowered === "zh-hant") return "zh_tw";
  if (lowered === "iw") return "he";
  if (lowered === "jw") return "jv";
  return trimmed.replace(/_/g, "-");
}

export function normalizeTargetLang(value?: string | null) {
  const normalized = normalizeLangCode(value ?? "");
  return !normalized || normalized === AUTO_SOURCE_LANG ? DEFAULT_TARGET_LANG : normalized;
}

export function languageByCode(code?: string | null) {
  const normalized = normalizeLangCode(code ?? "");
  return GOOGLE_TRANSLATE_LANGUAGES.find((language) => normalizeLangCode(language.code) === normalized);
}

export function languageDisplayName(code: string, uiLanguage?: string) {
  const language = languageByCode(code);
  if (!language) return code.trim();
  return uiLanguage === "en" ? language.englishName : language.chineseName;
}

export function languageOptionSearchText(language: GoogleTranslateLanguage) {
  return [
    language.code,
    normalizeLangCode(language.code),
    language.englishName,
    language.chineseName,
    language.nativeName,
  ]
    .join(" ")
    .toLowerCase();
}

export function detectSourceLang(text: string) {
  const sample = text.trim();
  if (!sample) return AUTO_SOURCE_LANG;

  // Script detection is deterministic and fast enough to run on every input change.
  const scriptChecks: Array<[string, RegExp]> = [
    ["zh_cn", /[\u3400-\u9fff]/u],
    ["ja", /[\u3040-\u30ff]/u],
    ["ko", /[\uac00-\ud7af]/u],
    ["ru", /[\u0400-\u04ff]/u],
    ["el", /[\u0370-\u03ff]/u],
    ["ar", /[\u0600-\u06ff]/u],
    ["he", /[\u0590-\u05ff]/u],
    ["hi", /[\u0900-\u097f]/u],
    ["bn", /[\u0980-\u09ff]/u],
    ["pa", /[\u0a00-\u0a7f]/u],
    ["gu", /[\u0a80-\u0aff]/u],
    ["ta", /[\u0b80-\u0bff]/u],
    ["te", /[\u0c00-\u0c7f]/u],
    ["kn", /[\u0c80-\u0cff]/u],
    ["ml", /[\u0d00-\u0d7f]/u],
    ["th", /[\u0e00-\u0e7f]/u],
    ["lo", /[\u0e80-\u0eff]/u],
    ["my", /[\u1000-\u109f]/u],
    ["ka", /[\u10a0-\u10ff]/u],
    ["am", /[\u1200-\u137f]/u],
    ["km", /[\u1780-\u17ff]/u],
  ];
  for (const [code, pattern] of scriptChecks) {
    if (pattern.test(sample)) return code;
  }

  if (!/[A-Za-z]/u.test(sample)) return AUTO_SOURCE_LANG;
  const lowered = ` ${sample.toLowerCase().replace(/\s+/g, " ")} `;
  const matches = (words: string[]) => words.reduce((count, word) => count + (lowered.includes(` ${word} `) ? 1 : 0), 0);
  const scores = [
    ["en", matches(["the", "and", "is", "are", "to", "of", "for", "with", "this", "that"])],
    ["fr", matches(["le", "la", "les", "des", "est", "avec", "pour", "une", "dans", "que"])],
    ["de", matches(["der", "die", "das", "und", "ist", "mit", "für", "nicht", "ein", "eine"])],
    ["es", matches(["el", "la", "los", "las", "que", "para", "con", "una", "por", "está"])],
    ["it", matches(["il", "lo", "la", "gli", "che", "per", "con", "una", "sono", "non"])],
    ["pt", matches(["o", "a", "os", "as", "que", "para", "com", "uma", "não", "por"])],
    ["nl", matches(["de", "het", "een", "en", "voor", "met", "niet", "dat", "van", "is"])],
  ] as const;
  const [bestCode, bestScore] = scores.reduce((best, current) => (current[1] > best[1] ? current : best), scores[0]);
  return bestScore > 0 ? bestCode : "en";
}

export function resolveSourceLang(sourceText: string, sourceLang: string) {
  const normalized = normalizeLangCode(sourceLang);
  if (normalized && normalized !== AUTO_SOURCE_LANG) return normalized;
  const detected = detectSourceLang(sourceText);
  return detected === AUTO_SOURCE_LANG ? undefined : detected;
}

export function resolveSourceSpeechLang(sourceText: string, sourceLang = AUTO_SOURCE_LANG) {
  return resolveSourceLang(sourceText, sourceLang) ?? DEFAULT_TARGET_LANG;
}

export function looksLikeChinese(text: string) {
  return detectSourceLang(text) === "zh_cn";
}
