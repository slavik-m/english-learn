import bz2
import json
import re
from pathlib import Path

ROOT = Path.cwd()
DATA_DIR = ROOT / "public"
RAW_DIR = ROOT / "data" / "raw"

DICTIONARY_FILE = DATA_DIR / "dictionary.generated.json"
META_FILE = DATA_DIR / "dictionary.meta.json"

TOPIC_LIMITS = {
    "it": 120,
    "software": 120,
    "management": 120,
}


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, payload):
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def build_keywords(entries):
    keywords = {"it": [], "software": [], "management": []}

    for topic in keywords:
        topic_entries = sorted(
            [entry for entry in entries if entry["topic"] == topic and entry["type"] != "sentence"],
            key=lambda entry: entry["frequencyRank"],
        )[:220]

        seen = set()
        for entry in topic_entries:
            term = entry["term"].strip()
            normalized = normalize(term)
            if normalized in seen:
                continue
            if len(normalized) < 3 or len(normalized) > 32:
                continue
            if not re.fullmatch(r"[a-z0-9 .,'()/+-]+", normalized):
                continue
            seen.add(normalized)
            keywords[topic].append(term)
            if len(keywords[topic]) >= 90:
                break

    return keywords


def build_patterns(keywords):
    patterns = {}
    for topic, words in keywords.items():
        parts = []
        for word in sorted(words, key=len, reverse=True):
            escaped = re.escape(word)
            escaped = escaped.replace(r"\ ", r"\s+")
            if " " in word:
                parts.append(escaped)
            else:
                parts.append(rf"\b{escaped}\b")
        patterns[topic] = re.compile("|".join(parts), re.IGNORECASE) if parts else None
    return patterns


def collect_english_candidates(patterns):
    candidates = {}
    path = RAW_DIR / "eng_sentences_detailed.tsv.bz2"

    with bz2.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            sentence_id, _lang, text = parts[:3]
            normalized = normalize(text)
            if len(normalized) < 24 or len(normalized) > 180:
                continue
            if not re.match(r"^[A-Z0-9\"']", text):
                continue
            if text.count(" ") < 3:
                continue

            matches = []
            for topic, pattern in patterns.items():
                if pattern and pattern.search(text):
                    matches.append(topic)

            if len(matches) != 1:
                continue

            topic = matches[0]
            candidates[sentence_id] = {
                "id": sentence_id,
                "topic": topic,
                "term": text.strip(),
            }

    return candidates


def collect_translations(link_file: Path, english_candidates, target_lang: str):
    links = {}
    with bz2.open(link_file, "rt", encoding="utf-8") as handle:
      for line in handle:
            eng_id, target_id = line.rstrip("\n").split("\t")[:2]
            if eng_id in english_candidates and eng_id not in links:
                links[eng_id] = target_id
    return links


def load_sentence_texts(path: Path, wanted_ids):
    resolved = {}
    with bz2.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            sentence_id, _lang, text = parts[:3]
            if sentence_id in wanted_ids:
                resolved[sentence_id] = text.strip()
    return resolved


def sentence_level(text: str) -> str:
    words = normalize(text).split(" ")
    if len(words) >= 11 or len(text) >= 80:
        return "B2"
    return "B1"


def topic_note(topic: str) -> str:
    return {
        "it": "Technical context sentence from Tatoeba.",
        "software": "Software engineering context sentence from Tatoeba.",
        "management": "Management or business context sentence from Tatoeba.",
    }[topic]


def build_sentence_entries(existing_entries):
    keywords = build_keywords(existing_entries)
    patterns = build_patterns(keywords)
    english_candidates = collect_english_candidates(patterns)

    ukr_links = collect_translations(RAW_DIR / "eng-ukr_links.tsv.bz2", english_candidates, "uk")
    rus_links = collect_translations(RAW_DIR / "eng-rus_links.tsv.bz2", english_candidates, "ru")

    ukr_texts = load_sentence_texts(RAW_DIR / "ukr_sentences_detailed.tsv.bz2", set(ukr_links.values()))
    rus_texts = load_sentence_texts(RAW_DIR / "rus_sentences_detailed.tsv.bz2", set(rus_links.values()))

    sentence_entries = []
    per_topic_counts = {"it": 0, "software": 0, "management": 0}

    for english_id, candidate in english_candidates.items():
        topic = candidate["topic"]
        if per_topic_counts[topic] >= TOPIC_LIMITS[topic]:
            continue

        translation = None
        source_lang = None

        if english_id in ukr_links:
            translation = ukr_texts.get(ukr_links[english_id])
            source_lang = "uk"

        if not translation and english_id in rus_links:
            translation = rus_texts.get(rus_links[english_id])
            source_lang = "ru"

        if not translation:
            continue

        normalized_term = normalize(candidate["term"])
        sentence_entries.append(
            {
                "id": f"sentence-{topic}-{english_id}",
                "term": candidate["term"],
                "normalizedTerm": normalized_term,
                "translations": [translation],
                "acceptedAnswers": [normalized_term],
                "type": "sentence",
                "topic": topic,
                "level": sentence_level(candidate["term"]),
                "context": topic_note(topic),
                "note": "Bilingual sentence pair imported from Tatoeba.",
                "tags": ["tatoeba", "sentence", topic],
                "source": "kaikki",
                "sourceTopics": [topic, "tatoeba"],
                "sourceLanguages": [source_lang],
            }
        )
        per_topic_counts[topic] += 1

    return sentence_entries


def merge_entries(dictionary_entries, sentence_entries):
    max_rank = max(entry["frequencyRank"] for entry in dictionary_entries)
    merged = list(dictionary_entries)
    existing = {entry["normalizedTerm"] for entry in merged}

    for index, entry in enumerate(sentence_entries, start=1):
        if entry["normalizedTerm"] in existing:
            continue
        entry["frequencyRank"] = max_rank + index
        merged.append(entry)
        existing.add(entry["normalizedTerm"])

    return merged


def rebuild_meta(entries):
    return {
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "count": len(entries),
        "byTopic": {
            "it": sum(1 for entry in entries if entry["topic"] == "it"),
            "software": sum(1 for entry in entries if entry["topic"] == "software"),
            "management": sum(1 for entry in entries if entry["topic"] == "management"),
        },
        "byType": {
            "word": sum(1 for entry in entries if entry["type"] == "word"),
            "phrase": sum(1 for entry in entries if entry["type"] == "phrase"),
            "sentence": sum(1 for entry in entries if entry["type"] == "sentence"),
        },
        "byLevel": {
            "A2": sum(1 for entry in entries if entry["level"] == "A2"),
            "B1": sum(1 for entry in entries if entry["level"] == "B1"),
            "B2": sum(1 for entry in entries if entry["level"] == "B2"),
        },
    }


def main():
    dictionary_entries = load_json(DICTIONARY_FILE)
    sentence_entries = build_sentence_entries(dictionary_entries)
    merged = merge_entries(dictionary_entries, sentence_entries)
    meta = rebuild_meta(merged)
    save_json(DICTIONARY_FILE, merged)
    save_json(META_FILE, meta)
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
