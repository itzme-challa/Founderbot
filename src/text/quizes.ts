import { Context } from 'telegraf';
import createDebug from 'debug';
import { distance } from 'fastest-levenshtein';
import { db, ref, onValue } from '../utils/firebase';
import { DataSnapshot } from 'firebase/database';

const debug = createDebug('bot:quizes');

let accessToken: string | null = null;

// Function to calculate similarity score between two strings
const getSimilarityScore = (a: string, b: string): number => {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0;
  return (maxLength - distance(a, b)) / maxLength;
};

// Function to find best matching chapter or subject using fuzzy search
const findBestMatchingItem = (items: string[], query: string): string | null => {
  if (!query || !items.length) return null;

  const exactMatch = items.find((item) => item.toLowerCase() === query.toLowerCase());
  if (exactMatch) return exactMatch;

  const containsMatch = items.find(
    (item) =>
      item.toLowerCase().includes(query.toLowerCase()) ||
      query.toLowerCase().includes(item.toLowerCase())
  );
  if (containsMatch) return containsMatch;

  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  let bestMatch: string | null = null;
  let bestScore = 0.5;

  for (const item of items) {
    const itemWords = item.toLowerCase().split(/\s+/);
    const matchingWords = queryWords.filter((qw) =>
      itemWords.some((cw) => getSimilarityScore(qw, cw) > 0.7)
    );

    const overlapScore = matchingWords.length / Math.max(queryWords.length, 1);
    const fullSimilarity = getSimilarityScore(item.toLowerCase(), query.toLowerCase());
    const totalScore = overlapScore * 0.7 + fullSimilarity * 0.3;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestMatch = item;
    }
  }

  return bestMatch;
};

// Function to create a Telegraph account
const createTelegraphAccount = async () => {
  try {
    const res = await fetch('https://api.telegra.ph/createAccount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        short_name: 'EduHubBot',
        author_name: 'EduHub Bot',
        author_url: 'https://t.me/neetpw01',
      }),
    });
    const data = await res.json();
    if (data.ok) {
      accessToken = data.result.access_token;
      debug('Telegraph account created successfully');
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    debug('Error creating Telegraph account:', err);
    throw err;
  }
};

// Function to create a Telegraph page with chapters or subjects list
const createTelegraphPage = async (title: string, items: string[]) => {
  try {
    if (!accessToken) {
      await createTelegraphAccount();
    }

    const now = new Date();
    const dateTimeString = now.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const content = [
      { tag: 'h4', children: [`📚 ${title}`] },
      { tag: 'br' },
      { tag: 'p', children: [{ tag: 'i', children: [`Last updated: ${dateTimeString}`] }] },
      { tag: 'br' },
      {
        tag: 'ul',
        children: items.map((item) => ({
          tag: 'li',
          children: [item],
        })),
      },
      { tag: 'br' },
      { tag: 'p', children: ['To get questions, use:'] },
      { tag: 'code', children: [title.includes('Chapters') ? '/chapter [name] [count]' : '/subject [name] [count]'] },
      { tag: 'br' },
      { tag: 'p', children: ['Example:'] },
      {
        tag: 'code',
        children: [
          title.includes('Chapters')
            ? '/chapter living world 2'
            : '/subject biology 2',
        ],
      },
    ];

    const res = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        title: `EduHub ${title} - ${dateTimeString}`,
        author_name: 'EduHub Bot',
        author_url: 'https://t.me/neetpw01',
        content,
        return_content: false,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      return data.result.url;
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    debug('Error creating Telegraph page:', err);
    throw err;
  }
};

// Function to fetch questions from Firebase
const fetchQuestions = async (subject?: string, chapter?: string): Promise<any[]> => {
  return new Promise((resolve) => {
    const questionsRef = ref(db, 'questions');
    onValue(
      questionsRef,
      (snapshot: DataSnapshot) => {
        const data = snapshot.val();
        if (!data) return resolve([]);

        let questions: any[] = [];

        // Iterate through subjects
        for (const subjectKey in data) {
          if (subject && subjectKey.toLowerCase() !== subject.toLowerCase()) continue;

          // Iterate through chapters
          for (const chapterKey in data[subjectKey]) {
            if (chapter && chapterKey.toLowerCase() !== chapter.toLowerCase()) continue;

            // Collect questions
            for (const questionId in data[subjectKey][chapterKey]) {
              const question = data[subjectKey][chapterKey][questionId];
              questions.push({
                ...question,
                subject: subjectKey,
                chapter: chapterKey,
              });
            }
          }
        }

        resolve(questions);
      },
      { onlyOnce: true }
    );
  });
};

// Function to get unique chapters or subjects
const getUniqueItems = async (type: 'chapters' | 'subjects', subject?: string): Promise<string[]> => {
  const questionsRef = ref(db, 'questions');
  return new Promise((resolve) => {
    onValue(
      questionsRef,
      (snapshot: DataSnapshot) => {
        const data = snapshot.val();
        if (!data) return resolve([]);

        if (type === 'subjects') {
          const subjects = Object.keys(data).sort();
          resolve(subjects);
        } else {
          let chapters: string[] = [];
          for (const subjectKey in data) {
            if (subject && subjectKey.toLowerCase() !== subject.toLowerCase()) continue;
            chapters = chapters.concat(Object.keys(data[subjectKey])).sort();
          }
          resolve([...new Set(chapters)]);
        }
      },
      { onlyOnce: true }
    );
  });
};

// Function to generate message with chapters or subjects list
const getItemsMessage = async (type: 'chapters' | 'subjects', subject?: string) => {
  try {
    const items = await getUniqueItems(type, subject);
    const title = type === 'chapters' ? `Available Chapters${subject ? ` for ${subject}` : ''}` : 'Available Subjects';
    const telegraphUrl = await createTelegraphPage(title, items);
    return {
      message: `📚 <b>${title}</b>\n\n` +
        `View all ${type} here: <a href="${telegraphUrl}">${telegraphUrl}</a>\n\n` +
        `Then use: <code>/${type === 'chapters' ? 'chapter' : 'subject'} [name] [count]</code>\n` +
        `Example: <code>/${type === 'chapters' ? 'chapter living world 2' : 'subject biology 2'}</code>`,
      items,
    };
  } catch (err) {
    debug(`Error generating ${type} message:`, err);
    throw err;
  }
};

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);
  const subjectMatch = text.match(/^\/subject\s+(.+?)(?:\s+(\d+))?$/);
  const randomMatch = text.match(/^\/random(?:\s+(\d+))?$/);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);

  // Handle /chapter command
  if (chapterMatch) {
    const chapterQuery = chapterMatch[1].trim();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 1;

    try {
      const allQuestions = await fetchQuestions();
      const chapters = await getUniqueItems('chapters');

      const matchedChapter = findBestMatchingItem(chapters, chapterQuery);

      if (!matchedChapter) {
        const { message } = await getItemsMessage('chapters');
        await ctx.replyWithHTML(
          `❌ No matching chapter found for "<b>${chapterQuery}</b>"\n\n${message}`
        );
        return;
      }

      const filteredByChapter = await fetchQuestions(undefined, matchedChapter);

      if (!filteredByChapter.length) {
        const { message } = await getItemsMessage('chapters');
        await ctx.replyWithHTML(
          `❌ No questions found for chapter "<b>${matchedChapter}</b>"\n\n${message}`
        );
        return;
      }

      if (matchedChapter.toLowerCase() !== chapterQuery.toLowerCase()) {
        await ctx.replyWithHTML(
          `🔍 Did you mean "<b>${matchedChapter}</b>"?\n\n` +
          `Sending questions from this chapter...\n` +
          `(If this isn't correct, please try again with a more specific chapter name)`
        );
      }

      const shuffled = filteredByChapter.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, filteredByChapter.length));

      for (const question of selected) {
        const options = [
          question.options.A,
          question.options.B,
          question.options.C,
          question.options.D,
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (question.image) {
          await ctx.replyWithPhoto({ url: question.image });
        }

        await ctx.sendPoll(
          question.question,
          options,
          {
            type: 'quiz',
            correct_option_id: correctOptionIndex,
            is_anonymous: false,
            explanation: question.explanation || 'No explanation provided.',
          } as any
        );
      }
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

  // Handle /subject command
  if (subjectMatch) {
    const subjectQuery = subjectMatch[1].trim();
    const count = subjectMatch[2] ? parseInt(subjectMatch[2], 10) : 1;

    try {
      const subjects = await getUniqueItems('subjects');
      const matchedSubject = findBestMatchingItem(subjects, subjectQuery);

      if (!matchedSubject) {
        const { message } = await getItemsMessage('subjects');
        await ctx.replyWithHTML(
          `❌ No matching subject found for "<b>${subjectQuery}</b>"\n\n${message}`
        );
        return;
      }

      const filteredBySubject = await fetchQuestions(matchedSubject);

      if (!filteredBySubject.length) {
        const { message } = await getItemsMessage('subjects');
        await ctx.replyWithHTML(
          `❌ No questions found for subject "<b>${matchedSubject}</b>"\n\n${message}`
        );
        return;
      }

      if (matchedSubject.toLowerCase() !== subjectQuery.toLowerCase()) {
        await ctx.replyWithHTML(
          `🔍 Did you mean "<b>${matchedSubject}</b>"?\n\n` +
          `Sending questions from this subject...\n` +
          `(If this isn't correct, please try again with a more specific subject name)`
        );
      }

      const shuffled = filteredBySubject.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, filteredBySubject.length));

      for (const question of selected) {
        const options = [
          question.options.A,
          question.options.B,
          question.options.C,
          question.options.D,
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (question.image) {
          await ctx.replyWithPhoto({ url: question.image });
        }

        await ctx.sendPoll(
          question.question,
          options,
          {
            type: 'quiz',
            correct_option_id: correctOptionIndex,
            is_anonymous: false,
            explanation: question.explanation || 'No explanation provided.',
          } as any
        );
      }
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

  // Handle /random command
  if (randomMatch) {
    const count = randomMatch[1] ? parseInt(randomMatch[1], 10) : 1;

    try {
      const allQuestions = await fetchQuestions();

      if (!allQuestions.length) {
        await ctx.reply('No questions available.');
        return;
      }

      const shuffled = allQuestions.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, allQuestions.length));

      for (const question of selected) {
        const options = [
          question.options.A,
          question.options.B,
          question.options.C,
          question.options.D,
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (question.image) {
          await ctx.replyWithPhoto({ url: question.image });
        }

        await ctx.sendPoll(
          question.question,
          options,
          {
            type: 'quiz',
            correct_option_id: correctOptionIndex,
            is_anonymous: false,
            explanation: question.explanation || 'No explanation provided.',
          } as any
        );
      }
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

  // Handle legacy /pyq, /b1, /c1, /p1 commands
  if (cmdMatch) {
    const cmd = cmdMatch[1];
    const subjectCode = cmdMatch[2];
    const count = cmdMatch[3] ? parseInt(cmdMatch[3].trim(), 10) : 1;

    const subjectMap: Record<string, string> = {
      b: 'biology',
      c: 'chemistry',
      p: 'physics',
    };

    let subject: string | null = null;
    let isMixed = false;

    if (cmd === 'pyq') {
      isMixed = true;
    } else if (subjectCode) {
      subject = subjectMap[subjectCode];
    } else if (['b1', 'c1', 'p1'].includes(cmd)) {
      subject = subjectMap[cmd[0]];
    }

    try {
      const filtered = isMixed ? await fetchQuestions() : await fetchQuestions(subject!);

      if (!filtered.length) {
        await ctx.reply(`No questions available for ${subject || 'the selected subjects'}.`);
        return;
      }

      const shuffled = filtered.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, filtered.length));

      for (const question of selected) {
        const options = [
          question.options.A,
          question.options.B,
          question.options.C,
          question.options.D,
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (question.image) {
          await ctx.replyWithPhoto({ url: question.image });
        }

        await ctx.sendPoll(
          question.question,
          options,
          {
            type: 'quiz',
            correct_option_id: correctOptionIndex,
            is_anonymous: false,
            explanation: question.explanation || 'No explanation provided.',
          } as any
        );
      }
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
  }
};

export { quizes };
