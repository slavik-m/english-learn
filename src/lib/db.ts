import { openDB, type DBSchema } from "idb";
import { loadDictionaryEntries, normalizeTerm } from "./dictionary-store";
import { type DictionaryEntry, type Entry, type EntryType, type Topic } from "../types";

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
const SEED_VERSION = "2026-06-19-seed-v6";

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

  const starterEntries = await getStarterEntries();
  const tx = db.transaction(["entries", "meta"], "readwrite");

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
  normalizedTerm: normalizeTerm(item.term),
  translations: item.translations,
  acceptedAnswers: item.acceptedAnswers.map(normalizeTerm),
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
  const normalizedEntryTerm = normalizeTerm(draft.term);

  return {
    id: `manual-${normalizedEntryTerm}-${Date.now()}`,
    term: draft.term.trim(),
    normalizedTerm: normalizedEntryTerm,
    translations: draft.translations.map((item) => item.trim()).filter(Boolean),
    acceptedAnswers:
      draft.acceptedAnswers?.map((item) => normalizeTerm(item)).filter(Boolean) ?? [normalizedEntryTerm],
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
  const dictionaryEntries = await loadDictionaryEntries();
  const tx = db.transaction("entries", "readwrite");

  const candidates = selectEntriesForImport(
    dictionaryEntries
      .filter((item) => item.topic === topic)
      .filter((item) => !existingTerms.has(item.normalizedTerm)),
    limit,
  );

  for (const item of candidates) {
    await tx.store.put(createEntryFromDictionary(item));
  }

  await tx.done;
  return candidates.length;
};

export const importSourceTopicPack = async (sourceTopic: string, limit = 48) => {
  const db = await dbPromise;
  const all = await db.getAll("entries");
  const existingTerms = new Set(all.map((entry) => entry.normalizedTerm));
  const dictionaryEntries = await loadDictionaryEntries();
  const tx = db.transaction("entries", "readwrite");

  const candidates = selectEntriesForImport(
    dictionaryEntries
      .filter((item) => item.sourceTopics.includes(sourceTopic))
      .filter((item) => !existingTerms.has(item.normalizedTerm)),
    limit,
  );

  for (const item of candidates) {
    await tx.store.put(createEntryFromDictionary(item));
  }

  await tx.done;
  return candidates.length;
};

const getStarterEntries = async () => {
  const dictionaryEntries = await loadDictionaryEntries();
  const perTopic: Record<Topic, number> = {
    general: 24,
    it: 40,
    software: 40,
    management: 40,
  };

  const selected: Entry[] = [];

  (Object.keys(perTopic) as Topic[]).forEach((topic) => {
    selectEntriesForImport(
      dictionaryEntries.filter((entry) => entry.topic === topic),
      perTopic[topic],
    ).forEach((entry) => {
        selected.push(createEntryFromDictionary(entry));
      });
  });

  selectEntriesForImport(
    dictionaryEntries.filter((entry) => entry.sourceTopics.includes("business-conversation")),
    20,
  ).forEach((entry) => {
    selected.push(createEntryFromDictionary(entry));
  });

  return selected;
};

const selectEntriesForImport = (entries: DictionaryEntry[], limit: number) => {
  const typeTargets: Record<EntryType, number> = {
    word: Math.max(1, Math.round(limit * 0.55)),
    phrase: Math.max(1, Math.round(limit * 0.1)),
    sentence: Math.max(1, Math.round(limit * 0.35)),
  };

  const selected: DictionaryEntry[] = [];
  const selectedIds = new Set<string>();

  const pushUnique = (entry: DictionaryEntry) => {
    if (selected.length >= limit || selectedIds.has(entry.id)) return;
    selected.push(entry);
    selectedIds.add(entry.id);
  };

  (Object.keys(typeTargets) as EntryType[]).forEach((type) => {
    entries
      .filter((entry) => entry.type === type)
      .slice(0, typeTargets[type])
      .forEach(pushUnique);
  });

  entries.forEach(pushUnique);

  return selected.slice(0, limit);
};
