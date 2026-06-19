import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const rootDir = process.cwd();
const rawDir = path.join(rootDir, "data", "raw");
const outDir = path.join(rootDir, "public");
const outFile = path.join(outDir, "dictionary.generated.json");
const metaFile = path.join(outDir, "dictionary.meta.json");

const sources = [
  {
    file: "computing.jsonl",
    topic: "it",
    sourceTopic: "computing",
  },
  {
    file: "architecture.jsonl",
    topic: "it",
    sourceTopic: "architecture",
  },
  {
    file: "databases.jsonl",
    topic: "it",
    sourceTopic: "databases",
  },
  {
    file: "networking.jsonl",
    topic: "it",
    sourceTopic: "networking",
  },
  {
    file: "computer-hardware.jsonl",
    topic: "it",
    sourceTopic: "computer-hardware",
  },
  {
    file: "computing-theory.jsonl",
    topic: "it",
    sourceTopic: "computing-theory",
  },
  {
    file: "programming.jsonl",
    topic: "software",
    sourceTopic: "programming",
  },
  {
    file: "software.jsonl",
    topic: "software",
    sourceTopic: "software",
  },
  {
    file: "computer-languages.jsonl",
    topic: "software",
    sourceTopic: "computer-languages",
  },
  {
    file: "management.jsonl",
    topic: "management",
    sourceTopic: "management",
  },
  {
    file: "business.jsonl",
    topic: "management",
    sourceTopic: "business",
  },
  {
    file: "marketing.jsonl",
    topic: "management",
    sourceTopic: "marketing",
  },
  {
    file: "finance.jsonl",
    topic: "management",
    sourceTopic: "finance",
  },
  {
    file: "economics.jsonl",
    topic: "management",
    sourceTopic: "economics",
  },
];

const targetSizes = {
  it: 1200,
  software: 900,
  management: 1200,
};

const allowedPartsOfSpeech = new Set([
  "noun",
  "verb",
  "adj",
  "adv",
  "phrase",
  "name",
  "prep_phrase",
  "adv_phrase",
  "intj",
]);

const ignoredTerms = new Set([
  "free",
  "action",
]);

const softwareSignals = [
  "programming",
  "software",
  "software engineering",
  "computer-languages",
  "function",
  "variable",
  "api",
  "library",
  "framework",
  "compiler",
  "debug",
  "query language",
  "markup language",
  "database",
  "databases",
  "algorithm",
  "repository",
  "version control",
  "source code",
  "deployment",
  "object-oriented",
  "lisp",
];

const itSignals = [
  "networking",
  "computer-hardware",
  "cryptography",
  "linux",
  "protocol",
  "server",
  "client",
  "hardware",
  "memory",
  "internet",
  "security",
  "operating system",
];

const candidateMap = new Map();

const normalize = (value) => value.trim().toLowerCase().replace(/\s+/g, " ");

const isUsefulTerm = (term) => {
  const normalized = normalize(term);

  if (!normalized || normalized.length < 2 || normalized.length > 90) return false;
  if (ignoredTerms.has(normalized)) return false;
  if (/[^a-z0-9 '.\-()/,+]/i.test(term)) return false;
  if ((term.match(/[0-9]/g) ?? []).length > 5) return false;
  if (normalized.split(" ").length > 10) return false;
  if (/^[^a-z]+$/i.test(term.replace(/[0-9 '.\-()/,+]/g, ""))) return false;
  if (/^(en-|ll-|q\d|x\d|[0-9]{2,})/i.test(normalized)) return false;

  return true;
};

const dedupe = (items) => [...new Set(items.map((item) => item.trim()).filter(Boolean))];

const pickTranslations = (record) => {
  const translations = Array.isArray(record.translations) ? record.translations : [];
  const uk = [];
  const ru = [];

  for (const item of translations) {
    if (!item?.word || !item?.lang_code) continue;
    if (!["uk", "ru"].includes(item.lang_code)) continue;

    if (item.lang_code === "uk") uk.push(item.word);
    if (item.lang_code === "ru") ru.push(item.word);
  }

  return {
    translations: dedupe([...uk, ...ru]).slice(0, 4),
    sourceLanguages: [
      ...(uk.length > 0 ? ["uk"] : []),
      ...(ru.length > 0 ? ["ru"] : []),
    ],
  };
};

const collectTags = (record, senses) => {
  const tags = new Set();

  for (const sense of senses) {
    for (const topic of sense.topics ?? []) tags.add(topic);
    for (const tag of sense.tags ?? []) tags.add(tag);
    for (const link of sense.links ?? []) tags.add(link[0]);
    for (const category of sense.categories ?? []) {
      if (category?.name) tags.add(String(category.name).toLowerCase());
    }
  }

  for (const category of record.categories ?? []) {
    if (category?.name) tags.add(String(category.name).toLowerCase());
  }

  return [...tags]
    .map((tag) => String(tag).toLowerCase().replace(/^en:/, ""))
    .filter((tag) => /^[a-z0-9 -]+$/.test(tag))
    .slice(0, 12);
};

const pickContext = (senses) => {
  for (const sense of senses) {
    const example = (sense.examples ?? []).find((item) => item?.text && item.text.length <= 180);
    if (example?.text) return example.text.trim();
  }

  for (const sense of senses) {
    const gloss = (sense.glosses ?? [])[0];
    if (gloss) return gloss.trim();
  }

  return undefined;
};

const classifyType = (term, pos) => {
  if (/[.?!]$/.test(term) || normalize(term).split(" ").length >= 5) return "sentence";
  if (normalize(term).includes(" ")) return "phrase";
  if (pos === "phrase" || pos === "prep_phrase" || pos === "adv_phrase") return "phrase";
  return "word";
};

const classifyLevel = (term, type, tags, context) => {
  const tokenCount = normalize(term).split(" ").length;
  const complexityScore =
    term.length +
    tokenCount * 8 +
    (context ? Math.min(context.length / 8, 16) : 0) +
    (tags.some((tag) => tag.includes("programming") || tag.includes("business")) ? 8 : 0);

  if (type === "sentence") return complexityScore > 55 ? "B2" : "B1";
  if (type === "phrase") return complexityScore > 36 ? "B2" : "B1";
  if (complexityScore <= 18) return "A2";
  if (complexityScore <= 30) return "B1";
  return "B2";
};

const scoreEntry = (entry, sourceTopic) => {
  let score = 0;

  if (entry.sourceLanguages.includes("uk")) score += 45;
  if (entry.sourceLanguages.includes("ru")) score += 20;
  if (entry.context) score += 16;
  if (entry.type === "word") score += 22;
  if (entry.type === "phrase") score += 18;
  if (entry.type === "sentence") score += 12;
  if (entry.level === "A2") score += 28;
  if (entry.level === "B1") score += 20;
  if (entry.level === "B2") score += 10;
  if (entry.tags.includes(sourceTopic)) score += 14;
  if (entry.term.length <= 12) score += 10;
  if (entry.term.length >= 28) score -= 8;
  if (/^[A-Z0-9]{2,8}$/.test(entry.term)) score -= 14;
  if (entry.normalizedTerm.includes("obsolete") || entry.normalizedTerm.includes("deprecated")) score -= 20;

  return score;
};

const inferTopic = (candidate, config) => {
  if (config.topic !== "it") {
    return config.topic;
  }

  const text = [
    candidate.term,
    candidate.context ?? "",
    candidate.note ?? "",
    ...candidate.tags,
    ...candidate.sourceTopics,
  ]
    .join(" ")
    .toLowerCase();

  let softwareScore = 0;
  let itScore = 1;

  for (const signal of softwareSignals) {
    if (text.includes(signal)) {
      softwareScore +=
        signal === "programming" || signal === "software" || signal === "software engineering" ? 3 : 2;
    }
  }

  for (const signal of itSignals) {
    if (text.includes(signal)) {
      itScore += 2;
    }
  }

  if (softwareScore >= 3 && softwareScore >= itScore) {
    return "software";
  }

  return "it";
};

const buildCandidate = (record, config) => {
  if (record.lang_code !== "en") return null;
  if (!allowedPartsOfSpeech.has(record.pos)) return null;
  if (!isUsefulTerm(record.word)) return null;

  const usableSenses = record.senses ?? [];
  if (usableSenses.length === 0) return null;

  const { translations, sourceLanguages } = pickTranslations(record);
  if (translations.length === 0) return null;

  const term = String(record.word).trim();
  const normalizedTerm = normalize(term);
  const type = classifyType(term, record.pos);
  const tags = collectTags(record, usableSenses);
  const context = pickContext(usableSenses);
  const level = classifyLevel(term, type, tags, context);

  const candidate = {
    id: `${config.topic}-${normalizedTerm.replace(/[^a-z0-9]+/g, "-")}`,
    term,
    normalizedTerm,
    translations,
    acceptedAnswers: dedupe([term, ...(record.forms ?? []).map((item) => item.form ?? "")]).map(normalize).slice(0, 4),
    type,
    topic: config.topic,
    level,
    context,
    note: (usableSenses[0]?.glosses ?? [])[0],
    tags,
    source: "kaikki",
    sourceTopics: dedupe([config.sourceTopic, ...tags.filter((tag) => tag.includes(config.sourceTopic))]).slice(0, 6),
    sourceLanguages,
  };

  candidate.topic = inferTopic(candidate, config);

  return candidate;
};

for (const config of sources) {
  const filePath = path.join(rawDir, config.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing raw source file: ${filePath}`);
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const candidate = buildCandidate(record, config);
    if (!candidate) continue;

    const mapKey = `${candidate.topic}::${candidate.normalizedTerm}`;
    const current = candidateMap.get(mapKey);
    const scored = { ...candidate, _score: scoreEntry(candidate, config.sourceTopic) };

    if (!current || scored._score > current._score) {
      candidateMap.set(mapKey, scored);
    }
  }
}

const grouped = {
  it: [],
  software: [],
  management: [],
};

for (const candidate of candidateMap.values()) {
  grouped[candidate.topic].push(candidate);
}

const selected = Object.entries(grouped).flatMap(([topic, entries]) =>
  entries
    .sort((left, right) => {
      if (right._score !== left._score) return right._score - left._score;
      return left.term.localeCompare(right.term);
    })
    .slice(0, targetSizes[topic])
    .map((entry, index) => ({
      ...entry,
      frequencyRank:
        {
          it: 0,
          software: targetSizes.it,
          management: targetSizes.it + targetSizes.software,
        }[topic] + index + 1,
    })),
);

const finalEntries = selected.map(({ _score, ...entry }) => entry);
const meta = {
  generatedAt: new Date().toISOString(),
  count: finalEntries.length,
  byTopic: finalEntries.reduce(
    (acc, entry) => {
      acc[entry.topic] += 1;
      return acc;
    },
    { it: 0, software: 0, management: 0 },
  ),
  byType: finalEntries.reduce(
    (acc, entry) => {
      acc[entry.type] += 1;
      return acc;
    },
    { word: 0, phrase: 0, sentence: 0 },
  ),
  byLevel: finalEntries.reduce(
    (acc, entry) => {
      acc[entry.level] += 1;
      return acc;
    },
    { A2: 0, B1: 0, B2: 0 },
  ),
};

fs.writeFileSync(outFile, `${JSON.stringify(finalEntries, null, 2)}\n`);
fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);

console.log(`Generated dictionary with ${finalEntries.length} entries.`);
console.log(JSON.stringify(meta, null, 2));
