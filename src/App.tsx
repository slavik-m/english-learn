import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  createEntryFromDictionary,
  createManualEntry,
  ensureSeedEntries,
  getAllEntries,
  importSourceTopicPack,
  importStarterPack,
  saveEntry,
} from "./lib/db";
import {
  loadDictionaryEntries,
  loadDictionaryMeta,
  normalizeTerm,
  searchDictionaryEntries,
} from "./lib/dictionary-store";
import { type DictionaryEntry, type Entry, type EntryType, type LearningStatus, type Level, type Topic } from "./types";

type MainScreen = "learn" | "practice";
type PracticeMode = "manual" | "choice";
type PracticeVerdict = "correct" | "almost" | "wrong";
type Overlay = null | "menu" | "stats" | "filters" | "search" | "add";
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type FilterState = {
  topic: Topic | "all";
  level: Level | "all";
  type: EntryType | "all";
  status: LearningStatus | "all";
  search: string;
};

type DraftState = {
  term: string;
  translation: string;
  type: EntryType;
  topic: Topic;
  level: Level;
  context: string;
};

type PracticeFeedback = {
  verdict: PracticeVerdict;
  expected: string;
  message: string;
  selectedChoice?: string;
};

const defaultFilters: FilterState = {
  topic: "all",
  level: "all",
  type: "all",
  status: "all",
  search: "",
};

const emptyDraft: DraftState = {
  term: "",
  translation: "",
  type: "word",
  topic: "software",
  level: "B1",
  context: "",
};

const matchesFilter = (entry: Entry, filters: FilterState) => {
  const normalizedQuery = filters.search.trim().toLowerCase();

  if (filters.topic !== "all" && entry.topic !== filters.topic) return false;
  if (filters.level !== "all" && entry.level !== filters.level) return false;
  if (filters.type !== "all" && entry.type !== filters.type) return false;
  if (filters.status !== "all" && entry.status !== filters.status) return false;

  if (!normalizedQuery) return true;

  return [
    entry.term,
    entry.context ?? "",
    entry.topic,
    entry.level,
    ...entry.translations,
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
};

const buildPracticeOrder = (items: Entry[]) =>
  [...items].sort((left, right) => {
    const score = (entry: Entry) => {
      let total = 0;
      if (entry.status === "difficult") total += 40;
      if (entry.status === "learning") total += 24;
      if (entry.status === "new") total += 16;
      total += entry.failCount * 6;
      total -= entry.successCount * 2;
      total -= (entry.frequencyRank ?? 9999) / 1000;
      return total;
    };

    return score(right) - score(left);
  });

const buildLearnOrder = (items: Entry[]) =>
  [...items].sort((left, right) => {
    const priority = (entry: Entry) => {
      if (entry.status === "difficult") return 0;
      if (entry.status === "learning") return 1;
      if (entry.status === "new") return 2;
      return 3;
    };

    const byPriority = priority(left) - priority(right);
    if (byPriority !== 0) return byPriority;
    return (left.frequencyRank ?? 99999) - (right.frequencyRank ?? 99999);
  });

const levenshteinDistance = (left: string, right: string) => {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row;
  for (let col = 0; col < cols; col += 1) matrix[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
};

const evaluateManualAnswer = (entry: Entry, rawAnswer: string): PracticeFeedback => {
  const answer = normalizeTerm(rawAnswer);
  const acceptedAnswers = [...new Set(entry.acceptedAnswers.map(normalizeTerm))];
  const expected = acceptedAnswers[0] ?? entry.normalizedTerm;

  if (!answer) {
    return { verdict: "wrong", expected, message: "Type the English answer first." };
  }

  if (acceptedAnswers.includes(answer)) {
    return { verdict: "correct", expected, message: "Exact match." };
  }

  const distances = acceptedAnswers
    .map((candidate) => ({ candidate, distance: levenshteinDistance(answer, candidate) }))
    .sort((left, right) => left.distance - right.distance);

  const best = distances[0];
  const threshold = best.candidate.length <= 5 ? 1 : 2;

  if (best.distance <= threshold) {
    return {
      verdict: "almost",
      expected,
      message: `Almost correct. Expected: ${best.candidate}.`,
    };
  }

  return { verdict: "wrong", expected, message: `Incorrect. Expected: ${expected}.` };
};

const updateEntryAfterPractice = (entry: Entry, verdict: PracticeVerdict): Entry => {
  const reviewCount = entry.reviewCount + 1;
  const successCount = verdict === "correct" ? entry.successCount + 1 : entry.successCount;
  const failCount = verdict === "wrong" ? entry.failCount + 1 : entry.failCount;

  let status: LearningStatus = entry.status;
  if (verdict === "wrong") status = "difficult";
  else if (verdict === "almost") status = "learning";
  else if (successCount >= 3) status = "known";
  else status = "learning";

  return {
    ...entry,
    status,
    reviewCount,
    successCount,
    failCount,
    lastReviewedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

const buildChoiceOptions = (entry: Entry, pool: Entry[]) => {
  const distractors = pool
    .filter((candidate) => candidate.id !== entry.id)
    .filter((candidate) => candidate.type === entry.type || candidate.topic === entry.topic)
    .map((candidate) => candidate.term)
    .filter((term) => normalizeTerm(term) !== entry.normalizedTerm);

  return [...new Set([...distractors.slice(0, 3), entry.term])].sort((left, right) => left.localeCompare(right));
};

const applyDictionaryItem = (item: DictionaryEntry): DraftState => ({
  term: item.term,
  translation: item.translations.join(", "),
  type: item.type,
  topic: item.topic,
  level: item.level,
  context: item.context ?? "",
});

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const FilterIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M7 12h10M10 17h4" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14ZM20 20l-3.5-3.5" />
  </svg>
);

const StatsCard = (props: { label: string; value: string | number; helper: string }) => (
  <article class="stats-card">
    <span>{props.label}</span>
    <strong>{props.value}</strong>
    <small>{props.helper}</small>
  </article>
);

export const App = () => {
  const [screen, setScreen] = createSignal<MainScreen>("learn");
  const [overlay, setOverlay] = createSignal<Overlay>(null);
  const [filters, setFilters] = createSignal<FilterState>(defaultFilters);
  const [draft, setDraft] = createSignal<DraftState>(emptyDraft);
  const [selectedDictionaryItem, setSelectedDictionaryItem] = createSignal<DictionaryEntry | null>(null);
  const [quickAddMessage, setQuickAddMessage] = createSignal("");
  const [packMessage, setPackMessage] = createSignal("");
  const [practiceMode, setPracticeMode] = createSignal<PracticeMode>("manual");
  const [practiceAnswer, setPracticeAnswer] = createSignal("");
  const [practiceFeedback, setPracticeFeedback] = createSignal<PracticeFeedback | null>(null);
  const [learnIndex, setLearnIndex] = createSignal(0);
  const [practiceIndex, setPracticeIndex] = createSignal(0);
  const [isOnline, setIsOnline] = createSignal(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = createSignal<InstallPromptEvent | null>(null);
  const [speakingId, setSpeakingId] = createSignal<string | null>(null);
  const [installMessage, setInstallMessage] = createSignal("");

  const [entries, { refetch }] = createResource(async () => {
    await ensureSeedEntries();
    return getAllEntries();
  });
  const [dictionaryEntries] = createResource(loadDictionaryEntries);
  const [dictionaryMeta] = createResource(loadDictionaryMeta);

  onMount(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as InstallPromptEvent);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    onCleanup(() => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    });
  });

  const suggestions = createMemo(() => {
    const source = dictionaryEntries();
    if (!source) return [];
    return searchDictionaryEntries(source, draft().term, 8);
  });

  const exactMatch = createMemo(() => {
    const normalized = normalizeTerm(draft().term);
    return suggestions().find((item) => item.normalizedTerm === normalized) ?? null;
  });

  const duplicateExists = createMemo(() => {
    const normalized = normalizeTerm(draft().term);
    return (entries() ?? []).some((entry) => entry.normalizedTerm === normalized);
  });

  createEffect(() => {
    const match = exactMatch();
    if (match && normalizeTerm(draft().term) === match.normalizedTerm) {
      setSelectedDictionaryItem(match);
      setDraft(applyDictionaryItem(match));
    }
  });

  const topicStats = createMemo(() => {
    const items = entries() ?? [];
    const reviewed = items.filter((entry) => entry.reviewCount > 0);
    const totalSuccess = items.reduce((sum, entry) => sum + entry.successCount, 0);
    const totalAttempts = items.reduce((sum, entry) => sum + entry.reviewCount, 0);

    return {
      total: items.length,
      learning: items.filter((entry) => entry.status === "learning").length,
      difficult: items.filter((entry) => entry.status === "difficult").length,
      known: items.filter((entry) => entry.status === "known").length,
      reviewed: reviewed.length,
      accuracy: totalAttempts > 0 ? Math.round((totalSuccess / totalAttempts) * 100) : 0,
    };
  });

  const learnPool = createMemo(() => buildLearnOrder((entries() ?? []).filter((entry) => matchesFilter(entry, filters()))));
  const practicePool = createMemo(() =>
    buildPracticeOrder((entries() ?? []).filter((entry) => matchesFilter(entry, filters()))),
  );

  const currentLearnEntry = createMemo(() => {
    const pool = learnPool();
    if (pool.length === 0) return null;
    return pool[((learnIndex() % pool.length) + pool.length) % pool.length] ?? null;
  });

  const currentPracticeEntry = createMemo(() => {
    const pool = practicePool();
    if (pool.length === 0) return null;
    return pool[((practiceIndex() % pool.length) + pool.length) % pool.length] ?? null;
  });

  const currentChoiceOptions = createMemo(() => {
    const current = currentPracticeEntry();
    if (!current) return [];
    return buildChoiceOptions(current, practicePool());
  });

  const learnPositionLabel = createMemo(() => {
    const pool = learnPool();
    if (pool.length === 0) return "0 / 0";
    const current = ((learnIndex() % pool.length) + pool.length) % pool.length;
    return `${current + 1} / ${pool.length}`;
  });

  const practicePositionLabel = createMemo(() => {
    const pool = practicePool();
    if (pool.length === 0) return "0 / 0";
    const current = ((practiceIndex() % pool.length) + pool.length) % pool.length;
    return `${current + 1} / ${pool.length}`;
  });

  const resetDraft = () => {
    setDraft(emptyDraft);
    setSelectedDictionaryItem(null);
    setQuickAddMessage("");
  };

  const resetPracticeRound = () => {
    setPracticeAnswer("");
    setPracticeFeedback(null);
  };

  const moveLearn = (direction: 1 | -1) => {
    if (learnPool().length <= 1) return;
    setLearnIndex((current) => current + direction);
  };

  const movePractice = (direction: 1 | -1) => {
    if (practicePool().length <= 1) return;
    setPracticeIndex((current) => current + direction);
    resetPracticeRound();
  };

  const handleSwipe = (event: TouchEvent, onLeft: () => void, onRight: () => void) => {
    const element = event.currentTarget as HTMLElement;
    const startX = Number(element.dataset.touchStartX ?? "0");
    const deltaX = event.changedTouches[0].clientX - startX;
    if (Math.abs(deltaX) < 48) return;
    if (deltaX < 0) onLeft();
    else onRight();
  };

  const handleInstall = async () => {
    const prompt = deferredInstallPrompt();
    if (!prompt) {
      setInstallMessage("Installation is available from the browser menu on this device.");
      return;
    }

    await prompt.prompt();
    const choice = await prompt.userChoice;
    setInstallMessage(choice.outcome === "accepted" ? "Install prompt accepted." : "Install prompt dismissed.");
    setDeferredInstallPrompt(null);
  };

  const speakEntry = (entry: Entry) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(entry.term);
    utterance.lang = "en-US";
    utterance.rate = entry.type === "sentence" ? 0.95 : 0.9;
    utterance.onstart = () => setSpeakingId(entry.id);
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(utterance);
  };

  const updateEntryStatus = async (entry: Entry, status: LearningStatus) => {
    const currentFilters = filters();
    const currentEntries = entries() ?? [];
    const nextActiveCount =
      currentFilters.topic !== "all"
        ? currentEntries.filter((candidate) => {
            if (candidate.topic !== currentFilters.topic) return false;
            if (candidate.id === entry.id) return status !== "known";
            return candidate.status !== "known";
          }).length
        : 0;

    const shouldTopUpTopicPack =
      currentFilters.topic !== "all" &&
      !currentFilters.search &&
      currentFilters.status !== "known" &&
      nextActiveCount <= 8;

    const updated: Entry = {
      ...entry,
      status,
      updatedAt: new Date().toISOString(),
      lastReviewedAt: new Date().toISOString(),
      reviewCount: entry.reviewCount + 1,
      successCount: status === "known" ? entry.successCount + 1 : entry.successCount,
      failCount: status === "difficult" ? entry.failCount + 1 : entry.failCount,
    };
    await saveEntry(updated);
    await refetch();
    if (shouldTopUpTopicPack) {
      const imported = await importStarterPack(currentFilters.topic as Topic, 24);
      if (imported > 0) {
        await refetch();
      }
    }
    if (learnPool().length > 1) {
      setLearnIndex((current) => current + 1);
    }
  };

  const handleSuggestionPick = (item: DictionaryEntry) => {
    setSelectedDictionaryItem(item);
    setDraft(applyDictionaryItem(item));
    setQuickAddMessage("Auto-filled from the local dictionary.");
  };

  const handleSave = async () => {
    const currentDraft = draft();
    const normalized = normalizeTerm(currentDraft.term);

    if (!normalized || !currentDraft.translation.trim()) {
      setQuickAddMessage("Term and translation are required.");
      return;
    }
    if (duplicateExists()) {
      setQuickAddMessage("This term is already in your deck.");
      return;
    }

    const entry = selectedDictionaryItem()
      ? createEntryFromDictionary(selectedDictionaryItem()!)
      : createManualEntry({
          term: currentDraft.term,
          translations: currentDraft.translation.split(",").map((item) => item.trim()).filter(Boolean),
          type: currentDraft.type,
          topic: currentDraft.topic,
          level: currentDraft.level,
          context: currentDraft.context,
        });

    await saveEntry(entry);
    await refetch();
    resetDraft();
    setOverlay(null);
  };

  const handleStarterImport = async (topic: Topic) => {
    const imported = await importStarterPack(topic, 48);
    await refetch();
    setPackMessage(imported > 0 ? `Imported ${imported} more ${topic} entries.` : `No new ${topic} entries left to import.`);
  };

  const handleBusinessConversationImport = async () => {
    const imported = await importSourceTopicPack("business-conversation", 72);
    await refetch();
    setPackMessage(
      imported > 0
        ? `Imported ${imported} business conversation phrases.`
        : "No new business conversation phrases left to import.",
    );
  };

  const handlePracticeVerdict = async (verdict: PracticeVerdict, selectedChoice?: string) => {
    const current = currentPracticeEntry();
    if (!current) return;
    const updated = updateEntryAfterPractice(current, verdict);
    await saveEntry(updated);
    await refetch();
    const expected = current.acceptedAnswers[0] ?? current.normalizedTerm;
    setPracticeFeedback({
      verdict,
      expected,
      selectedChoice,
      message:
        verdict === "correct"
          ? "Correct."
          : verdict === "almost"
            ? `Almost correct. Expected: ${expected}.`
            : `Incorrect. Expected: ${expected}.`,
    });
  };

  const submitManualAnswer = async () => {
    const current = currentPracticeEntry();
    if (!current) return;
    const feedback = evaluateManualAnswer(current, practiceAnswer());
    await handlePracticeVerdict(feedback.verdict);
    setPracticeFeedback(feedback);
  };

  const chooseOption = async (choice: string) => {
    const current = currentPracticeEntry();
    if (!current) return;
    const verdict: PracticeVerdict = normalizeTerm(choice) === current.normalizedTerm ? "correct" : "wrong";
    await handlePracticeVerdict(verdict, choice);
  };

  return (
    <div class="mobile-shell">
      <header class="mobile-topbar">
        <button class="nav-icon-button" type="button" onClick={() => setOverlay("menu")} aria-label="Open menu">
          <MenuIcon />
        </button>
        <button
          classList={{ "nav-label-button": true, active: screen() === "learn" }}
          type="button"
          onClick={() => setScreen("learn")}
        >
          Learn
        </button>
        <button
          classList={{ "nav-label-button": true, active: screen() === "practice" }}
          type="button"
          onClick={() => setScreen("practice")}
        >
          Practice
        </button>
        <button class="nav-icon-button" type="button" onClick={() => setOverlay("add")} aria-label="Add entry">
          <PlusIcon />
        </button>
      </header>

      <main class="screen-frame">
        <Show when={screen() === "learn"}>
          <section class="primary-screen">
            <div class="screen-tools">
              <button class="tool-button" type="button" onClick={() => setOverlay("filters")} aria-label="Filters">
                <FilterIcon />
              </button>
              <div class="screen-title-block">
                <span class="screen-title">Learn</span>
                <small>{learnPositionLabel()}</small>
              </div>
              <button class="tool-button" type="button" onClick={() => setOverlay("search")} aria-label="Search">
                <SearchIcon />
              </button>
            </div>

            <Show when={currentLearnEntry()} fallback={<div class="empty-screen-card">No cards match current filters.</div>}>
              {(entry) => (
                <article
                  class="main-card"
                  onTouchStart={(event) => {
                    (event.currentTarget as HTMLElement).dataset.touchStartX = String(event.touches[0].clientX);
                  }}
                  onTouchEnd={(event) => handleSwipe(event, () => moveLearn(1), () => moveLearn(-1))}
                >
                  <div class="card-topline">
                    <span class="chip">{entry().topic}</span>
                    <span class="chip">{entry().level}</span>
                    <span class="chip">{entry().type}</span>
                  </div>

                  <div class="card-main">
                    <h2>{entry().term}</h2>
                    <p class="card-translation">{entry().translations.join(", ")}</p>
                    <Show when={entry().context}>
                      <p class="card-context">{entry().context}</p>
                    </Show>
                  </div>

                  <div class="card-footer">
                    <button class="ghost-action" type="button" onClick={() => void updateEntryStatus(entry(), "difficult")}>
                      Review
                    </button>
                    <button class="ghost-action" type="button" onClick={() => speakEntry(entry())}>
                      {speakingId() === entry().id ? "Speaking..." : "Speak"}
                    </button>
                    <button class="primary-action" type="button" onClick={() => void updateEntryStatus(entry(), "known")}>
                      Know
                    </button>
                  </div>
                  <small class="swipe-hint">Swipe left or right to change card</small>
                </article>
              )}
            </Show>
          </section>
        </Show>

        <Show when={screen() === "practice"}>
          <section class="primary-screen">
            <div class="screen-tools">
              <button class="tool-button" type="button" onClick={() => setOverlay("filters")} aria-label="Practice filters">
                <FilterIcon />
              </button>
              <div class="screen-title-block">
                <span class="screen-title">Practice</span>
                <small>{practicePositionLabel()}</small>
              </div>
              <div class="mode-toggle">
                <button
                  classList={{ "tiny-mode": true, active: practiceMode() === "manual" }}
                  type="button"
                  onClick={() => {
                    setPracticeMode("manual");
                    resetPracticeRound();
                  }}
                >
                  Type
                </button>
                <button
                  classList={{ "tiny-mode": true, active: practiceMode() === "choice" }}
                  type="button"
                  onClick={() => {
                    setPracticeMode("choice");
                    resetPracticeRound();
                  }}
                >
                  Pick
                </button>
              </div>
            </div>

            <Show when={currentPracticeEntry()} fallback={<div class="empty-screen-card">No practice cards match current filters.</div>}>
              {(entry) => (
                <article
                  class="main-card practice-card-main"
                  onTouchStart={(event) => {
                    (event.currentTarget as HTMLElement).dataset.touchStartX = String(event.touches[0].clientX);
                  }}
                  onTouchEnd={(event) => handleSwipe(event, () => movePractice(1), () => movePractice(-1))}
                >
                  <div class="card-topline">
                    <span class="chip">{entry().topic}</span>
                    <span class="chip">{entry().level}</span>
                    <span class="chip">{entry().type}</span>
                  </div>

                  <div class="card-main">
                    <h2>{entry().translations[0]}</h2>
                    <Show when={entry().context}>
                      <p class="card-context">{entry().context}</p>
                    </Show>
                  </div>

                  <Show when={practiceMode() === "manual"}>
                    <form
                      class="practice-stack"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!practiceFeedback()) void submitManualAnswer();
                        else movePractice(1);
                      }}
                    >
                      <input
                        class="practice-input"
                        value={practiceAnswer()}
                        disabled={Boolean(practiceFeedback())}
                        onInput={(event) => setPracticeAnswer(event.currentTarget.value)}
                        placeholder="Type English answer"
                      />
                      <button class="primary-action full-width" type="submit">
                        {practiceFeedback() ? "Next" : "Check"}
                      </button>
                    </form>
                  </Show>

                  <Show when={practiceMode() === "choice"}>
                    <div class="choice-stack">
                      <For each={currentChoiceOptions()}>
                        {(option) => (
                          <button
                            type="button"
                            disabled={Boolean(practiceFeedback())}
                            classList={{
                              "choice-action": true,
                              correct: Boolean(practiceFeedback()) && normalizeTerm(option) === entry().normalizedTerm,
                              wrong:
                                Boolean(practiceFeedback()) &&
                                practiceFeedback()?.selectedChoice === option &&
                                normalizeTerm(option) !== entry().normalizedTerm,
                            }}
                            onClick={() => void chooseOption(option)}
                          >
                            {option}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={practiceFeedback()}>
                    {(feedback) => (
                      <div class={`feedback-strip ${feedback().verdict}`}>
                        <strong>
                          {feedback().verdict === "correct"
                            ? "Correct"
                            : feedback().verdict === "almost"
                              ? "Almost Correct"
                              : "Wrong"}
                        </strong>
                        <span>{feedback().message}</span>
                      </div>
                    )}
                  </Show>
                  <small class="swipe-hint">Swipe left or right to change card</small>
                </article>
              )}
            </Show>
          </section>
        </Show>
      </main>

      <Show when={overlay()}>
        <div class="overlay-backdrop" onClick={() => setOverlay(null)}>
          <section class="overlay-panel" onClick={(event) => event.stopPropagation()}>
            <Show when={overlay() === "menu"}>
              <div class="overlay-content">
                <div class="overlay-head">
                  <h3>Menu</h3>
                  <button class="close-button" type="button" onClick={() => setOverlay(null)}>
                    Close
                  </button>
                </div>
                <button class="menu-row" type="button" onClick={() => setOverlay("stats")}>
                  Statistics
                </button>
                <button class="menu-row" type="button" onClick={() => void handleInstall()}>
                  Install App
                </button>
                <span class={`connectivity-pill ${isOnline() ? "online" : "offline"}`}>
                  {isOnline() ? "Online" : "Offline"}
                </span>
                <Show when={installMessage()}>
                  <p class="helper-copy">{installMessage()}</p>
                </Show>
              </div>
            </Show>

            <Show when={overlay() === "stats"}>
              <div class="overlay-content">
                <div class="overlay-head">
                  <h3>Statistics</h3>
                  <button class="close-button" type="button" onClick={() => setOverlay(null)}>
                    Close
                  </button>
                </div>
                <div class="stats-grid">
                  <StatsCard label="My Entries" value={topicStats().total} helper="Imported to this device" />
                  <StatsCard label="Dictionary" value={dictionaryMeta()?.count ?? "…"} helper="Offline search pool" />
                  <StatsCard label="Known" value={topicStats().known} helper="Stable answers" />
                  <StatsCard label="Learning" value={topicStats().learning} helper="In active repetition" />
                  <StatsCard label="Difficult" value={topicStats().difficult} helper="Needs more work" />
                  <StatsCard label="Reviewed" value={topicStats().reviewed} helper="Cards seen in practice" />
                  <StatsCard label="Accuracy" value={`${topicStats().accuracy}%`} helper="All attempts" />
                  <StatsCard
                    label="Dataset"
                    value={`${dictionaryMeta()?.byType.word ?? "…"} / ${dictionaryMeta()?.byType.phrase ?? "…"} / ${dictionaryMeta()?.byType.sentence ?? "…"}`}
                    helper="Words / phrases / sentences"
                  />
                </div>
              </div>
            </Show>

            <Show when={overlay() === "filters"}>
              <div class="overlay-content">
                <div class="overlay-head">
                  <h3>Filters</h3>
                  <button class="close-button" type="button" onClick={() => setOverlay(null)}>
                    Close
                  </button>
                </div>
                <div class="overlay-form">
                  <label class="overlay-field">
                    <span>Topic</span>
                    <select
                      value={filters().topic}
                      onChange={(event) => setFilters((current) => ({ ...current, topic: event.currentTarget.value as FilterState["topic"] }))}
                    >
                      <option value="all">All</option>
                      <option value="general">General</option>
                      <option value="it">IT</option>
                      <option value="software">Software</option>
                      <option value="management">Management</option>
                    </select>
                  </label>
                  <label class="overlay-field">
                    <span>Level</span>
                    <select
                      value={filters().level}
                      onChange={(event) => setFilters((current) => ({ ...current, level: event.currentTarget.value as FilterState["level"] }))}
                    >
                      <option value="all">All</option>
                      <option value="A2">A2</option>
                      <option value="B1">B1</option>
                      <option value="B2">B2</option>
                    </select>
                  </label>
                  <label class="overlay-field">
                    <span>Type</span>
                    <select
                      value={filters().type}
                      onChange={(event) => setFilters((current) => ({ ...current, type: event.currentTarget.value as FilterState["type"] }))}
                    >
                      <option value="all">All</option>
                      <option value="word">Word</option>
                      <option value="phrase">Phrase</option>
                      <option value="sentence">Sentence</option>
                    </select>
                  </label>
                  <label class="overlay-field">
                    <span>Status</span>
                    <select
                      value={filters().status}
                      onChange={(event) => setFilters((current) => ({ ...current, status: event.currentTarget.value as FilterState["status"] }))}
                    >
                      <option value="all">All</option>
                      <option value="new">New</option>
                      <option value="learning">Learning</option>
                      <option value="known">Known</option>
                      <option value="difficult">Difficult</option>
                    </select>
                  </label>
                </div>
              </div>
            </Show>

            <Show when={overlay() === "search"}>
              <div class="overlay-content">
                <div class="overlay-head">
                  <h3>Search</h3>
                  <button class="close-button" type="button" onClick={() => setOverlay(null)}>
                    Close
                  </button>
                </div>
                <div class="overlay-form">
                  <label class="overlay-field">
                    <span>Term or translation</span>
                    <input
                      value={filters().search}
                      onInput={(event) => setFilters((current) => ({ ...current, search: event.currentTarget.value }))}
                      placeholder="Search term or translation"
                    />
                  </label>
                  <div class="overlay-actions">
                    <button
                      class="ghost-action full-width"
                      type="button"
                      onClick={() => setFilters((current) => ({ ...current, search: "" }))}
                    >
                      Clear Search
                    </button>
                    <button class="primary-action full-width" type="button" onClick={() => setOverlay(null)}>
                      Done
                    </button>
                  </div>
                </div>
              </div>
            </Show>

            <Show when={overlay() === "add"}>
              <div class="overlay-content">
                <div class="overlay-head">
                  <h3>Quick Add</h3>
                  <button class="close-button" type="button" onClick={() => setOverlay(null)}>
                    Close
                  </button>
                </div>

                <form
                  class="overlay-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSave();
                  }}
                >
                  <label class="overlay-field">
                    <span>English term</span>
                    <input
                      value={draft().term}
                      placeholder="release, exception, stakeholder"
                      onInput={(event) => {
                        const term = event.currentTarget.value;
                        setDraft((current) => ({ ...current, term }));
                        setSelectedDictionaryItem(null);
                        setQuickAddMessage("");
                      }}
                    />
                  </label>

                  <Show when={draft().term.trim()}>
                    <div class="suggestion-box modal-suggestions">
                      <div class="suggestion-head">
                        <strong>Local matches</strong>
                        <span>{dictionaryEntries.loading ? "Loading…" : `${suggestions().length} found`}</span>
                      </div>
                      <div class="suggestion-list">
                        <Show when={suggestions().length > 0} fallback={<p class="helper-copy">No close local matches.</p>}>
                          <For each={suggestions()}>
                            {(item) => (
                              <button
                                type="button"
                                classList={{
                                  "suggestion-item": true,
                                  selected: selectedDictionaryItem()?.id === item.id,
                                }}
                                onClick={() => handleSuggestionPick(item)}
                              >
                                <span>{item.term}</span>
                                <small>{item.translations[0]}</small>
                              </button>
                            )}
                          </For>
                        </Show>
                      </div>
                    </div>
                  </Show>

                  <label class="overlay-field">
                    <span>Ukrainian / Russian translation</span>
                    <input
                      value={draft().translation}
                      onInput={(event) => setDraft((current) => ({ ...current, translation: event.currentTarget.value }))}
                    />
                  </label>
                  <label class="overlay-field">
                    <span>Type</span>
                    <select
                      value={draft().type}
                      onChange={(event) => setDraft((current) => ({ ...current, type: event.currentTarget.value as EntryType }))}
                    >
                      <option value="word">Word</option>
                      <option value="phrase">Phrase</option>
                      <option value="sentence">Sentence</option>
                    </select>
                  </label>
                  <label class="overlay-field">
                    <span>Topic</span>
                    <select
                      value={draft().topic}
                      onChange={(event) => setDraft((current) => ({ ...current, topic: event.currentTarget.value as Topic }))}
                    >
                      <option value="general">General</option>
                      <option value="it">IT</option>
                      <option value="software">Software</option>
                      <option value="management">Management</option>
                    </select>
                  </label>
                  <label class="overlay-field">
                    <span>Level</span>
                    <select
                      value={draft().level}
                      onChange={(event) => setDraft((current) => ({ ...current, level: event.currentTarget.value as Level }))}
                    >
                      <option value="A2">A2</option>
                      <option value="B1">B1</option>
                      <option value="B2">B2</option>
                    </select>
                  </label>
                  <label class="overlay-field">
                    <span>Context / example</span>
                    <textarea
                      rows={4}
                      value={draft().context}
                      onInput={(event) => setDraft((current) => ({ ...current, context: event.currentTarget.value }))}
                    />
                  </label>

                  <div class="overlay-actions">
                    <button class="primary-action full-width" type="submit" disabled={duplicateExists()}>
                      Save Entry
                    </button>
                    <button class="ghost-action full-width" type="button" onClick={resetDraft}>
                      Reset
                    </button>
                  </div>
                  <Show when={quickAddMessage()}>
                    <p class="helper-copy">{quickAddMessage()}</p>
                  </Show>
                  <Show when={duplicateExists()}>
                    <p class="helper-copy warning">This term is already in your deck.</p>
                  </Show>
                </form>

                <div class="packs-block">
                  <h4>Starter Packs</h4>
                    <div class="overlay-actions">
                    <button class="ghost-action full-width" type="button" onClick={() => void handleStarterImport("general")}>
                      Import Common English Pack
                    </button>
                    <button class="ghost-action full-width" type="button" onClick={() => void handleStarterImport("it")}>
                      Import IT Pack
                    </button>
                    <button class="ghost-action full-width" type="button" onClick={() => void handleStarterImport("software")}>
                      Import Software Pack
                    </button>
                    <button class="ghost-action full-width" type="button" onClick={() => void handleStarterImport("management")}>
                      Import Management Pack
                    </button>
                    <button class="ghost-action full-width" type="button" onClick={() => void handleBusinessConversationImport()}>
                      Import Business Conversation Pack
                    </button>
                  </div>
                  <Show when={packMessage()}>
                    <p class="helper-copy">{packMessage()}</p>
                  </Show>
                </div>
              </div>
            </Show>
          </section>
        </div>
      </Show>
    </div>
  );
};
