import { type DictionaryEntry } from "../types";

type DictionaryMeta = {
  generatedAt: string;
  count: number;
  byTopic: Record<"general" | "it" | "software" | "management", number>;
  byType: Record<"word" | "phrase" | "sentence", number>;
  byLevel: Record<"A2" | "B1" | "B2", number>;
};

let dictionaryEntriesPromise: Promise<DictionaryEntry[]> | null = null;
let dictionaryMetaPromise: Promise<DictionaryMeta> | null = null;
const assetUrl = (path: string) => new URL(path, import.meta.env.BASE_URL).toString();

const mergeMeta = (left: DictionaryMeta, right: DictionaryMeta): DictionaryMeta => ({
  generatedAt: right.generatedAt > left.generatedAt ? right.generatedAt : left.generatedAt,
  count: left.count + right.count,
  byTopic: {
    general: (left.byTopic.general ?? 0) + (right.byTopic.general ?? 0),
    it: (left.byTopic.it ?? 0) + (right.byTopic.it ?? 0),
    software: (left.byTopic.software ?? 0) + (right.byTopic.software ?? 0),
    management: (left.byTopic.management ?? 0) + (right.byTopic.management ?? 0),
  },
  byType: {
    word: left.byType.word + right.byType.word,
    phrase: left.byType.phrase + right.byType.phrase,
    sentence: left.byType.sentence + right.byType.sentence,
  },
  byLevel: {
    A2: left.byLevel.A2 + right.byLevel.A2,
    B1: left.byLevel.B1 + right.byLevel.B1,
    B2: left.byLevel.B2 + right.byLevel.B2,
  },
});

export const normalizeTerm = (value: string) =>
  value
    .replace(/[’‘`]/g, "'")
    .replace(/…/g, "...")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'([{]+|[.!?…,"')\]}]+$/g, "");

export const loadDictionaryEntries = () => {
  if (!dictionaryEntriesPromise) {
    dictionaryEntriesPromise = Promise.all([
      fetch(assetUrl("dictionary.generated.json")),
      fetch(assetUrl("common-english.generated.json")),
      fetch(assetUrl("business-conversation.generated.json")),
    ]).then(async ([mainResponse, commonResponse, businessResponse]) => {
      if (!mainResponse.ok) {
        throw new Error(`Failed to load dictionary entries: ${mainResponse.status}`);
      }
      if (!commonResponse.ok) {
        throw new Error(`Failed to load common English entries: ${commonResponse.status}`);
      }
      if (!businessResponse.ok) {
        throw new Error(`Failed to load business conversation entries: ${businessResponse.status}`);
      }

      const [mainEntries, commonEntries, businessEntries] = await Promise.all([
        mainResponse.json() as Promise<DictionaryEntry[]>,
        commonResponse.json() as Promise<DictionaryEntry[]>,
        businessResponse.json() as Promise<DictionaryEntry[]>,
      ]);

      return [...commonEntries, ...businessEntries, ...mainEntries];
    });
  }

  return dictionaryEntriesPromise;
};

export const loadDictionaryMeta = () => {
  if (!dictionaryMetaPromise) {
    dictionaryMetaPromise = Promise.all([
      fetch(assetUrl("dictionary.meta.json")),
      fetch(assetUrl("common-english.meta.json")),
      fetch(assetUrl("business-conversation.meta.json")),
    ]).then(async ([mainResponse, commonResponse, businessResponse]) => {
      if (!mainResponse.ok) {
        throw new Error(`Failed to load dictionary meta: ${mainResponse.status}`);
      }
      if (!commonResponse.ok) {
        throw new Error(`Failed to load common English meta: ${commonResponse.status}`);
      }
      if (!businessResponse.ok) {
        throw new Error(`Failed to load business conversation meta: ${businessResponse.status}`);
      }

      const [mainMeta, commonMeta, businessMeta] = await Promise.all([
        mainResponse.json() as Promise<DictionaryMeta>,
        commonResponse.json() as Promise<DictionaryMeta>,
        businessResponse.json() as Promise<DictionaryMeta>,
      ]);

      return mergeMeta(mergeMeta(mainMeta, commonMeta), businessMeta);
    });
  }

  return dictionaryMetaPromise;
};

export const searchDictionaryEntries = (dictionaryEntries: DictionaryEntry[], query: string, limit = 12) => {
  const normalizedQuery = normalizeTerm(query);

  if (!normalizedQuery) {
    return dictionaryEntries.slice(0, limit);
  }

  return dictionaryEntries
    .map((entry) => {
      let score = 0;
      let matched = false;
      const normalizedEntryTerm = normalizeTerm(entry.term);
      const normalizedTranslations = entry.translations.map(normalizeTerm);
      const normalizedTags = entry.tags.map(normalizeTerm);

      if (normalizedEntryTerm === normalizedQuery) {
        score += 500;
        matched = true;
      }
      if (normalizedEntryTerm.startsWith(normalizedQuery)) {
        score += 250;
        matched = true;
      }
      if (normalizedEntryTerm.startsWith(normalizedQuery)) {
        score += 180;
        matched = true;
      }
      if (normalizedEntryTerm.includes(normalizedQuery)) {
        score += 120;
        matched = true;
      }
      if (normalizedTranslations.some((item) => item.includes(normalizedQuery))) {
        score += 90;
        matched = true;
      }
      if (normalizedTags.some((item) => item.includes(normalizedQuery))) {
        score += 50;
        matched = true;
      }

      if (matched) {
        score += Math.max(0, 4000 - entry.frequencyRank);
      }

      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.entry);
};

export const searchDictionary = async (query: string, limit = 12) => {
  const dictionaryEntries = await loadDictionaryEntries();
  return searchDictionaryEntries(dictionaryEntries, query, limit);
};
