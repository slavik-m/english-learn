export type EntryType = "word" | "phrase" | "sentence";
export type Topic = "general" | "it" | "software" | "management";
export type Level = "A2" | "B1" | "B2";
export type LearningStatus = "new" | "learning" | "known" | "difficult";

export type Entry = {
  id: string;
  term: string;
  normalizedTerm: string;
  translations: string[];
  acceptedAnswers: string[];
  type: EntryType;
  topic: Topic;
  level: Level;
  context?: string;
  note?: string;
  tags: string[];
  frequencyRank?: number;
  source: "seed" | "manual";
  status: LearningStatus;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt?: string;
  reviewCount: number;
  successCount: number;
  failCount: number;
};

export type DictionaryEntry = {
  id: string;
  term: string;
  normalizedTerm: string;
  translations: string[];
  acceptedAnswers: string[];
  type: EntryType;
  topic: Topic;
  level: Level;
  context?: string;
  note?: string;
  tags: string[];
  frequencyRank: number;
  source: "kaikki" | "curated";
  sourceTopics: string[];
  sourceLanguages: Array<"uk" | "ru">;
};
