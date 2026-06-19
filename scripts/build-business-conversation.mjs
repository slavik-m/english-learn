import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "public");
const outFile = path.join(outDir, "business-conversation.generated.json");
const metaFile = path.join(outDir, "business-conversation.meta.json");

const normalize = (value) => value.trim().toLowerCase().replace(/\s+/g, " ");

const classifyType = (term) => {
  const normalized = normalize(term);
  if (/[.?!]$/.test(term) || normalized.split(" ").length >= 5) return "sentence";
  if (normalized.includes(" ")) return "phrase";
  return "word";
};

const rows = [
  ["How are you doing?", "Як справи?", "Как дела?", "opening", "A2"],
  ["How’s your day going?", "Як проходить день?", "Как проходит день?", "opening", "A2"],
  ["Thanks for joining.", "Дякую, що приєдналися.", "Спасибо, что присоединились.", "opening", "A2"],
  ["Let’s get started.", "Почнімо.", "Давайте начнем.", "opening", "A2"],
  ["Shall we start?", "Починаємо?", "Начнем?", "opening", "A2"],
  ["I’d like to quickly discuss...", "Я хотів би швидко обговорити...", "Я хотел бы быстро обсудить...", "opening", "B1"],
  ["From my point of view...", "З моєї точки зору...", "С моей точки зрения...", "opinion", "B1"],
  ["As far as I understand...", "Наскільки я розумію...", "Насколько я понимаю...", "opinion", "B1"],
  ["What I mean is...", "Я маю на увазі...", "Я имею в виду...", "opinion", "A2"],
  ["The main point is...", "Головна ідея в тому, що...", "Основная мысль в том, что...", "opinion", "B1"],
  ["To be honest, I think...", "Чесно кажучи, я думаю...", "Честно говоря, я думаю...", "opinion", "B1"],
  ["I’d say that...", "Я б сказав, що...", "Я бы сказал, что...", "opinion", "B1"],
  ["Could you clarify that, please?", "Можеш уточнити?", "Можешь уточнить?", "clarify", "B1"],
  ["Could you give me more context?", "Можеш дати більше контексту?", "Можешь дать больше контекста?", "clarify", "B1"],
  ["Do you mean that...?", "Ти маєш на увазі, що...?", "Ты имеешь в виду, что...?", "clarify", "B1"],
  ["Just to make sure I understood correctly...", "Щоб переконатися, що я правильно зрозумів...", "Чтобы убедиться, что я правильно понял...", "clarify", "B1"],
  ["Could you repeat that, please?", "Можеш повторити?", "Можешь повторить?", "clarify", "A2"],
  ["Could you say that in another way?", "Можеш сказати це іншими словами?", "Можешь сказать это по-другому?", "clarify", "B1"],
  ["Sorry, I didn’t catch that.", "Вибач, я не вловив.", "Извини, я не уловил.", "misunderstanding", "A2"],
  ["I’m not sure I fully understand.", "Я не впевнений, що повністю зрозумів.", "Я не уверен, что полностью понял.", "misunderstanding", "B1"],
  ["I’m a bit confused about this part.", "Я трохи заплутався в цій частині.", "Я немного запутался в этой части.", "misunderstanding", "B1"],
  ["Could you explain it step by step?", "Можеш пояснити покроково?", "Можешь объяснить пошагово?", "misunderstanding", "B1"],
  ["I agree.", "Я згоден.", "Я согласен.", "agreement", "A2"],
  ["That makes sense.", "Це має сенс.", "В этом есть смысл.", "agreement", "A2"],
  ["Sounds good to me.", "Мені підходить.", "Меня устраивает.", "agreement", "A2"],
  ["I’m on the same page.", "Я на тій самій хвилі.", "Я на той же волне.", "agreement", "B1"],
  ["Exactly.", "Саме так.", "Именно.", "agreement", "A2"],
  ["I see your point, but...", "Я розумію твою думку, але...", "Я понимаю твою мысль, но...", "soft-disagreement", "B1"],
  ["I’m not sure I agree with that.", "Я не впевнений, що згоден з цим.", "Я не уверен, что согласен с этим.", "soft-disagreement", "B1"],
  ["I have a slightly different view.", "У мене трохи інший погляд.", "У меня немного другой взгляд.", "soft-disagreement", "B1"],
  ["That might work, but I’m concerned about...", "Це може спрацювати, але мене турбує...", "Это может сработать, но меня беспокоит...", "soft-disagreement", "B2"],
  ["I’d suggest a different approach.", "Я б запропонував інший підхід.", "Я бы предложил другой подход.", "soft-disagreement", "B1"],
  ["I suggest we...", "Я пропоную, щоб ми...", "Я предлагаю, чтобы мы...", "solution", "A2"],
  ["Maybe we could...", "Можливо, ми могли б...", "Возможно, мы могли бы...", "solution", "A2"],
  ["One option would be to...", "Один із варіантів — це...", "Один из вариантов — это...", "solution", "B1"],
  ["The best approach might be...", "Найкращий підхід може бути...", "Лучший подход может быть...", "solution", "B2"],
  ["Let’s consider...", "Давайте розглянемо...", "Давайте рассмотрим...", "solution", "A2"],
  ["What’s the current status?", "Який поточний статус?", "Какой текущий статус?", "status", "A2"],
  ["Is there any blocker?", "Є якісь блокери?", "Есть какие-то блокеры?", "status", "B1"],
  ["I’m currently working on...", "Я зараз працюю над...", "Я сейчас работаю над...", "status", "A2"],
  ["I’ve finished...", "Я завершив...", "Я завершил...", "status", "A2"],
  ["I’m still investigating this issue.", "Я все ще досліджую цю проблему.", "Я все еще исследую эту проблему.", "status", "B1"],
  ["This task is almost done.", "Ця задача майже готова.", "Эта задача почти готова.", "status", "A2"],
  ["It needs more time.", "Потрібно більше часу.", "Нужно больше времени.", "status", "A2"],
  ["We’ve run into an issue.", "Ми зіткнулися з проблемою.", "Мы столкнулись с проблемой.", "issue", "B1"],
  ["There is a problem with...", "Є проблема з...", "Есть проблема с...", "issue", "A2"],
  ["The main blocker is...", "Основний блокер — це...", "Основной блокер — это...", "issue", "B1"],
  ["It doesn’t work as expected.", "Це не працює як очікувалось.", "Это не работает как ожидалось.", "issue", "B1"],
  ["We need to investigate it further.", "Нам потрібно дослідити це глибше.", "Нам нужно изучить это глубже.", "issue", "B1"],
  ["I’ll take a closer look.", "Я подивлюся детальніше.", "Я посмотрю внимательнее.", "issue", "A2"],
  ["What’s the deadline for this?", "Який дедлайн для цього?", "Какой дедлайн для этого?", "priority", "B1"],
  ["Is this urgent?", "Це терміново?", "Это срочно?", "priority", "A2"],
  ["What’s the priority?", "Який пріоритет?", "Какой приоритет?", "priority", "A2"],
  ["Can we move this to the next sprint?", "Можемо перенести це на наступний спринт?", "Можем перенести это на следующий спринт?", "priority", "B1"],
  ["This might take longer than expected.", "Це може зайняти більше часу, ніж очікувалося.", "Это может занять больше времени, чем ожидалось.", "priority", "B1"],
  ["I can deliver it by tomorrow.", "Я можу зробити це до завтра.", "Я могу сделать это к завтрашнему дню.", "priority", "A2"],
  ["Can we schedule a quick call?", "Можемо запланувати короткий дзвінок?", "Можем запланировать короткий звонок?", "meeting", "A2"],
  ["Let’s sync on this later.", "Давайте синхронізуємось щодо цього пізніше.", "Давайте синхронизируемся по этому позже.", "meeting", "B1"],
  ["Can we go through this together?", "Можемо пройтися по цьому разом?", "Можем пройтись по этому вместе?", "meeting", "B1"],
  ["Let’s discuss it offline.", "Давайте обговоримо це окремо, не на цьому мітингу.", "Давайте обсудим это отдельно, не на этой встрече.", "meeting", "B1"],
  ["We’re running out of time.", "У нас закінчується час.", "У нас заканчивается время.", "meeting", "B1"],
  ["Let’s move on to the next topic.", "Переходимо до наступної теми.", "Перейдем к следующей теме.", "meeting", "A2"],
  ["To summarize...", "Підсумовуючи...", "Подводя итог...", "closing", "B1"],
  ["The next steps are...", "Наступні кроки такі...", "Следующие шаги такие...", "closing", "B1"],
  ["I’ll follow up with you later.", "Я повернуся до тебе з цим пізніше.", "Я вернусь к тебе с этим позже.", "closing", "B1"],
  ["I’ll send an update in Slack.", "Я надішлю апдейт у Slack.", "Я отправлю обновление в Slack.", "closing", "A2"],
  ["Thanks, everyone.", "Дякую всім.", "Спасибо всем.", "closing", "A2"],
  ["Have a good day.", "Гарного дня.", "Хорошего дня.", "closing", "A2"],
  ["Let me think for a second.", "Дай мені секунду подумати.", "Дай мне секунду подумать.", "glue", "A2"],
  ["How can I put it...", "Як би це сказати...", "Как бы это сказать...", "glue", "B1"],
  ["What’s the right word...?", "Яке правильне слово...?", "Какое правильное слово...?", "glue", "B1"],
  ["I mean...", "Я маю на увазі...", "Я имею в виду...", "glue", "A2"],
  ["Basically...", "В основному...", "В основном...", "glue", "A2"],
  ["In other words...", "Іншими словами...", "Иными словами...", "glue", "B1"],
  ["The idea is that...", "Ідея в тому, що...", "Идея в том, что...", "glue", "B1"],
  ["It depends on...", "Це залежить від...", "Это зависит от...", "glue", "A2"],
  ["I need to double-check that.", "Мені потрібно це перевірити.", "Мне нужно это проверить.", "glue", "B1"],
];

const entries = rows.map(([term, uk, ru, category, level], index) => {
  const normalizedTerm = normalize(term);
  const type = classifyType(term);

  return {
    id: `business-conversation-${index + 1}`,
    term,
    normalizedTerm,
    translations: [uk, ru],
    acceptedAnswers: [normalizedTerm],
    type,
    topic: "management",
    level,
    context: `Business conversation: ${category}.`,
    note: "Curated phrase for meetings, calls, status updates, and work communication.",
    tags: ["business-conversation", "work-communication", category],
    frequencyRank: index + 1,
    source: "curated",
    sourceTopics: ["management", "business-conversation", category],
    sourceLanguages: ["uk", "ru"],
  };
});

const meta = {
  generatedAt: new Date().toISOString(),
  count: entries.length,
  byTopic: {
    general: 0,
    it: 0,
    software: 0,
    management: entries.length,
  },
  byType: entries.reduce(
    (acc, entry) => {
      acc[entry.type] += 1;
      return acc;
    },
    { word: 0, phrase: 0, sentence: 0 },
  ),
  byLevel: entries.reduce(
    (acc, entry) => {
      acc[entry.level] += 1;
      return acc;
    },
    { A2: 0, B1: 0, B2: 0 },
  ),
};

fs.writeFileSync(outFile, `${JSON.stringify(entries, null, 2)}\n`);
fs.writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);

console.log(`Generated business conversation dataset with ${entries.length} entries.`);
console.log(JSON.stringify(meta, null, 2));
