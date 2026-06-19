import { type DictionaryEntry } from "../types";

type DictionaryMeta = {
  generatedAt: string;
  count: number;
  byTopic: Record<"it" | "software" | "management", number>;
  byType: Record<"word" | "phrase" | "sentence", number>;
  byLevel: Record<"A2" | "B1" | "B2", number>;
};

let dictionaryEntriesPromise: Promise<DictionaryEntry[]> | null = null;
let dictionaryMetaPromise: Promise<DictionaryMeta> | null = null;

export const normalizeTerm = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

export const loadDictionaryEntries = () => {
  if (!dictionaryEntriesPromise) {
    dictionaryEntriesPromise = fetch("/dictionary.generated.json").then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load dictionary entries: ${response.status}`);
      }

      return (await response.json()) as DictionaryEntry[];
    });
  }

  return dictionaryEntriesPromise;
};

export const loadDictionaryMeta = () => {
  if (!dictionaryMetaPromise) {
    dictionaryMetaPromise = fetch("/dictionary.meta.json").then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load dictionary meta: ${response.status}`);
      }

      return (await response.json()) as DictionaryMeta;
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

      if (entry.normalizedTerm === normalizedQuery) {
        score += 500;
        matched = true;
      }
      if (entry.normalizedTerm.startsWith(normalizedQuery)) {
        score += 250;
        matched = true;
      }
      if (entry.term.toLowerCase().startsWith(normalizedQuery)) {
        score += 180;
        matched = true;
      }
      if (entry.normalizedTerm.includes(normalizedQuery)) {
        score += 120;
        matched = true;
      }
      if (entry.translations.some((item) => item.toLowerCase().includes(normalizedQuery))) {
        score += 90;
        matched = true;
      }
      if (entry.tags.some((item) => item.toLowerCase().includes(normalizedQuery))) {
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
