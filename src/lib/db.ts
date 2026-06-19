import { openDB, type DBSchema } from "idb";
import { loadDictionaryEntries } from "./dictionary-store";
import { type DictionaryEntry, type Entry, type Topic } from "../types";

type MetaRecord = {
  key: string;
  value: string;
};

interface EnglishLearnDb extends DBSchema {
  entries: {
    key: string;
    value: Entry;
    indexes: {
      "by-updatedAt": string;
      "by-status": Entry["status"];
      "by-topic": Entry["topic"];
    };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

const DB_NAME = "english-learn-db";
const DB_VERSION = 1;
const SEED_VERSION = "2026-06-19-seed-v2";

const dbPromise = openDB<EnglishLearnDb>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("entries")) {
      const entryStore = db.createObjectStore("entries", { keyPath: "id" });
      entryStore.createIndex("by-updatedAt", "updatedAt");
      entryStore.createIndex("by-status", "status");
      entryStore.createIndex("by-topic", "topic");
    }

    if (!db.objectStoreNames.contains("meta")) {
      db.createObjectStore("meta", { keyPath: "key" });
    }
  },
});

export const ensureSeedEntries = async () => {
  const db = await dbPromise;
  const appliedSeed = await db.get("meta", "seed-version");

  if (appliedSeed?.value === SEED_VERSION) {
    return;
  }

  const tx = db.transaction(["entries", "meta"], "readwrite");
  const starterEntries = await getStarterEntries();

  for (const entry of starterEntries) {
    await tx.objectStore("entries").put(entry);
  }

  await tx.objectStore("meta").put({
    key: "seed-version",
    value: SEED_VERSION,
  });

  await tx.done;
};

export const getAllEntries = async () => {
  const db = await dbPromise;
  const items = await db.getAll("entries");
  return items.sort((left, right) => (left.frequencyRank ?? 9999) - (right.frequencyRank ?? 9999));
};

const timestamp = () => new Date().toISOString();

export const createEntryFromDictionary = (item: DictionaryEntry): Entry => ({
  id: `entry-${item.id}`,
  term: item.term,
  normalizedTerm: item.normalizedTerm,
  translations: item.translations,
  acceptedAnswers: item.acceptedAnswers,
  type: item.type,
  topic: item.topic,
  level: item.level,
  context: item.context,
  note: item.note,
  tags: item.tags,
  frequencyRank: item.frequencyRank,
  source: "seed",
  status: "new",
  createdAt: timestamp(),
  updatedAt: timestamp(),
  reviewCount: 0,
  successCount: 0,
  failCount: 0,
});

export const createManualEntry = (
  draft: Pick<Entry, "term" | "translations" | "type" | "topic" | "level" | "context" | "note"> & {
    acceptedAnswers?: string[];
    tags?: string[];
  },
): Entry => {
  const normalizedTerm = normalizeTerm(draft.term);

  return {
    id: `manual-${normalizedTerm}-${Date.now()}`,
    term: draft.term.trim(),
    normalizedTerm,
    translations: draft.translations.map((item) => item.trim()).filter(Boolean),
    acceptedAnswers:
      draft.acceptedAnswers?.map((item) => normalizeTerm(item)).filter(Boolean) ?? [normalizedTerm],
    type: draft.type,
    topic: draft.topic,
    level: draft.level,
    context: draft.context?.trim(),
    note: draft.note?.trim(),
    tags: draft.tags ?? [],
    frequencyRank: 99999,
    source: "manual",
    status: "new",
    createdAt: timestamp(),
    updatedAt: timestamp(),
    reviewCount: 0,
    successCount: 0,
    failCount: 0,
  };
};

export const saveEntry = async (entry: Entry) => {
  const db = await dbPromise;
  await db.put("entries", entry);
};

export const hasEntryWithNormalizedTerm = async (normalizedTerm: string) => {
  const db = await dbPromise;
  const all = await db.getAll("entries");
  return all.some((entry) => entry.normalizedTerm === normalizedTerm);
};

export const importStarterPack = async (topic: Topic, limit = 48) => {
  const db = await dbPromise;
  const all = await db.getAll("entries");
  const existingTerms = new Set(all.map((entry) => entry.normalizedTerm));
  const tx = db.transaction("entries", "readwrite");
  const dictionaryEntries = await loadDictionaryEntries();

  const candidates = dictionaryEntries
    .filter((item) => item.topic === topic)
    .filter((item) => !existingTerms.has(item.normalizedTerm))
    .slice(0, limit);

  for (const item of candidates) {
    await tx.store.put(createEntryFromDictionary(item));
  }

  await tx.done;
  return candidates.length;
};

const normalizeTerm = (term: string) =>
  term
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getStarterEntries = async () => {
  const dictionaryEntries = await loadDictionaryEntries();
  const perTopic: Record<Topic, number> = {
    it: 40,
    software: 40,
    management: 40,
  };

  const selected: Entry[] = [];

  (Object.keys(perTopic) as Topic[]).forEach((topic) => {
    dictionaryEntries
      .filter((entry) => entry.topic === topic)
      .slice(0, perTopic[topic])
      .forEach((entry) => {
        selected.push(createEntryFromDictionary(entry));
      });
  });

  return selected;
};
