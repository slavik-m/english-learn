# English Learn Cards

Offline-first PWA for learning English words, phrases, and topic sentences in the domains of `IT`, `Software`, and `Management`.

The app is built for mobile-first usage and keeps all user data on the device. No sync backend is used in the current MVP.

## Stack

- `SolidJS`
- `TypeScript`
- `Vite`
- `vite-plugin-pwa`
- `IndexedDB` via `idb`
- browser `SpeechSynthesis` for pronunciation

## Product Scope

The MVP supports:

- local dictionary and local learning deck
- `Quick Add` with local autofill
- starter packs by topic
- one-card learning screen with swipe navigation
- practice in two modes:
  - `Manual Input`
  - `Multiple Choice`
- typo-tolerant answer evaluation
- progress tracking
- installable PWA behavior

## Main Decisions

### 1. Local-first only

The app does not use a backend and stores user state in `IndexedDB`.

Reason:

- matches the requirement to work only on the device
- removes sync complexity from MVP
- makes PWA behavior straightforward

### 2. Dictionary is not bundled into main JS

The dictionary is generated into runtime assets:

- `public/dictionary.generated.json`
- `public/dictionary.meta.json`

The app loads them with `fetch` through [src/lib/dictionary-store.ts](src/lib/dictionary-store.ts).

Reason:

- the original approach pushed the main bundle to roughly `~873 kB`
- after moving the dictionary out of the bundle, the main JS chunk dropped to roughly `~46 kB`

### 3. Open datasets instead of proprietary dictionaries

The project intentionally avoids embedding Cambridge/Oxford content directly.

Used sources:

- `Kaikki / Wiktionary` topic dumps for dictionary entries
- `Tatoeba` bilingual sentence pairs for context sentences

Reason:

- better licensing position for local redistribution
- enough structure to build a useful offline seed dataset

### 4. Browser speech instead of external TTS API

Pronunciation uses `SpeechSynthesis`.

Reason:

- free
- offline-capable depending on device/browser voices
- good enough for MVP

## Current Features

### Learn

- one card per screen
- swipe left/right to move through the filtered deck
- search and filters moved behind toolbar icons
- card actions:
  - `Know`
  - `Again`
  - `Speak`

### Quick Add

- single main input for English term
- opened from the top-right add icon as a modal overlay
- local search suggestions
- autofill when a dictionary match is selected
- manual fallback when no good match exists
- duplicate protection

### Starter Packs

- `IT`
- `Software`
- `Management`

Import pulls entries from the local dictionary into the user deck.

### Practice

- separate main screen
- one card per screen
- swipe left/right to move between practice cards
- filters behind toolbar icon

#### Manual Input

- reverse translation `UA/RU -> EN`
- exact match support
- accepted variants support
- typo tolerance:
  - short answers allow 1 symbol error
  - longer answers allow up to 2 symbol errors

Verdicts:

- `correct`
- `almost`
- `wrong`

#### Multiple Choice

- 4-option choice flow
- distractors selected from the local filtered pool

### Progress

Tracked per entry:

- `reviewCount`
- `successCount`
- `failCount`
- `status`
- `lastReviewedAt`

Aggregated in UI:

- `Known`
- `Reviewed`
- `Accuracy`
- `Learning`
- `Difficult`

### Navigation

- top navigation:
  - menu icon
  - `Learn`
  - `Practice`
  - add icon
- secondary surfaces are moved out of the main screens:
  - `Statistics` in menu
  - `Install App` in menu
  - `Quick Add` in modal overlay
  - search and filters in overlay

## Dataset

Current generated dataset:

- `1236` total entries
- `833` words
- `43` phrases
- `360` sentences

By topic:

- `IT`: `475`
- `Software`: `250`
- `Management`: `511`

Generation pipeline:

- [scripts/build-dictionary.mjs](scripts/build-dictionary.mjs)
- [scripts/augment-dictionary.py](scripts/augment-dictionary.py)

Build command:

```bash
npm run build:dictionary
```

## Project Structure

- [src/App.tsx](src/App.tsx) — main UI and app flows
- [src/lib/db.ts](src/lib/db.ts) — IndexedDB access and entry persistence
- [src/lib/dictionary-store.ts](src/lib/dictionary-store.ts) — runtime dictionary loading and search
- [src/styles.css](src/styles.css) — mobile-first styling
- [public/dictionary.generated.json](public/dictionary.generated.json) — runtime dictionary asset
- [public/dictionary.meta.json](public/dictionary.meta.json) — dataset metadata
- [vite.config.ts](vite.config.ts) — Vite + PWA config

## Run

Install dependencies:

```bash
npm install
```

Run dev server:

```bash
npm run dev
```

Build dictionary assets:

```bash
npm run build:dictionary
```

Production build:

```bash
npm run build
```

Preview production build:

```bash
npm run preview -- --host 127.0.0.1 --port 4173
```

## Mobile UX Check

A headless mobile viewport pass was run with Playwright on an `iPhone 13` sized viewport.

What was checked:

- no horizontal overflow at `390px` width
- no page scroll on primary `Learn` and `Practice` screens
- single-card viewport layout on both main screens
- modal overlays for `Menu` and `Quick Add`
- forms and buttons fit inside viewport width
- multiple-choice options fit the card width

Observed results:

- layout is stable on narrow mobile viewport
- `Learn` and `Practice` now behave as dedicated single-card screens
- `Quick Add` and `Menu` work as overlay surfaces instead of taking over the main layout
- no clipping or horizontal scroll was detected

Files used during local viewport validation were generated in `C:\tmp` during development and are not part of the app.

## Known Issues

### 1. Dictionary quality is useful, but not clean

Open lexical sources are noisy. Some terms are polysemous and can produce unexpected suggestions.

Example:

- a query can return technically related but semantically weaker matches because Wiktionary topic tagging is broad

### 2. Software domain quality is better than before, but still not ideal

The `software` segment was improved by reclassifying technical entries from broader `computing` sources, but it is still not a curated software-engineering glossary.

### 3. Suggestion ranking can still be improved

Quick Add now avoids generic fallback noise when no match exists, but ranking for ambiguous terms can still be better.

### 4. Speech quality depends on the device

`SpeechSynthesis` depends on browser and installed voices. Quality and offline availability vary between devices.

### 5. Multiple-choice distractors are basic

Distractors are currently picked from the filtered local pool. They are functional, but not yet semantically tuned.

## Next Improvements

### Product

- smarter review scheduling
- recent additions screen
- edit/delete entry flows
- per-topic progress screens
- better starter pack selection UI

### Data

- improve software-engineering term curation
- add more phrases and collocations
- reduce noisy open-dataset entries
- stronger translation ranking

### Practice

- smarter distractors
- sentence-specific answer normalization
- partial-credit handling for long phrase/sentence answers

### Tech

- service worker cache policy review for dictionary assets
- optional local asset compression for dictionary files
- split runtime loading by topic if dataset keeps growing

## Notes on External APIs

External APIs were intentionally left out of the MVP.

The codebase is structured so that future enrichment can be added later for:

- translation
- example sentence generation
- audio
- word discovery

without changing the local-first storage model.
