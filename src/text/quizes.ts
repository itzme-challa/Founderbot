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
  query = query.toLowerCase();
  const exactMatch = items.find((item) => item.toLowerCase() === query);
  if (exactMatch) return exactMatch;

  const containsMatch = items.find(
    (item) =>
      item.toLowerCase().includes(query) ||
      query.includes(item.toLowerCase())
  );
  if (containsMatch) return containsMatch;

  const queryWords = query.split(/\s+/).filter((w) => w.length > 2);
  let bestMatch: string | null = null;
  let bestScore = 0.5;

  for (const item of items) {
    const itemWords = item.toLowerCase().split(/\s+/);
    const matchingWords = queryWords.filter((qw) =>
      itemWords.some((cw) => getSimilarityScore(qw, cw) > 0.7)
    );
    const overlapScore = matchingWords.length / Math.max(queryWords.length, 1);
    const fullSimilarity = getSimilarityScore(item.toLowerCase(), query);
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
            ? '/chapter Living World 2'
            : '/subject Biology 2',
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
    let path = 'questions';
    if (subject && chapter) {
      path = `questions/${subject.toLowerCase()}/${chapter.toLowerCase()}`;
    } else if (subject) {
      path = `questions/${subject.toLowerCase()}`;
    }
    debug('Fetching questions from path:', path);
    const questionsRef = ref(db, path);
    onValue(
      questionsRef,
      (snapshot: DataSnapshot) => {
        const questions: any[] = [];
        const data = snapshot.val();
        debug('Fetched data:', data ? Object.keys(data).length : 'null');
        if (!data) {
          debug('No data found at path:', path);
          resolve(questions);
          return;
        }

        if (subject && chapter) {
          for (const questionId in data) {
            questions.push({
              ...data[questionId],
              subject,
              chapter,
            });
          }
        } else if (subject) {
          for (const chapterKey in data) {
            const chapterQuestions = data[chapterKey];
            for (const questionId in chapterQuestions) {
              questions.push({
                ...chapterQuestions[questionId],
                subject,
                chapter: chapterKey,
              });
            }
          }
        } else {
          for (const subjectKey in data) {
            for (const chapterKey in data[subjectKey]) {
              const chapterQuestions = data[subjectKey][chapterKey];
              for (const questionId in chapterQuestions) {
                questions.push({
                  ...chapterQuestions[questionId],
                  subject: subjectKey,
                  chapter: chapterKey,
                });
              }
            }
          }
        }
        debug('Returning questions:', questions.length);
        resolve(questions);
      },
      (error: Error) => {
        debug('Firebase error:', error.message);
        resolve([]);
      }
    );
  });
};

// Function to get unique chapters or subjects
const getUniqueItems = async (type: 'chapters' | 'subjects', subject?: string): Promise<string[]> => {
  return new Promise((resolve) => {
    if (type === 'subjects') {
      const subjectsRef = ref(db, 'questions');
      onValue(
        subjectsRef,
        (snapshot: DataSnapshot) => {
          const data = snapshot.val();
          const subjects = data ? Object.keys(data) : [];
          debug('Fetched subjects:', subjects);
          resolve(subjects.sort());
        },
        (error: Error) => {
          debug('Error fetching subjects:', error.message);
          resolve([]);
        }
      );
    } else if (type === 'chapters' && subject) {
      const chaptersRef = ref(db, `questions/${subject.toLowerCase()}`);
      onValue(
        chaptersRef,
        (snapshot: DataSnapshot) => {
          const data = snapshot.val();
          const chapters = data ? Object.keys(data) : [];
          debug('Fetched chapters for', subject, ':', chapters);
          resolve(chapters.sort());
        },
        (error: Error) => {
          debug('Error fetching chapters:', error.message);
          resolve([]);
        }
      );
    } else {
      resolve([]);
    }
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
        `Example: <code>/${type === 'chapters' ? 'chapter Living World 2' : 'subject Biology 2'}</code>`,
      items,
    };
  } catch (err) {
    debug(`Error generating ${type} message:`, err);
    throw err;
  }
};

// Function to find subject for a chapter
const findSubjectForChapter = async (chapterQuery: string): Promise<string | null> => {
  return new Promise((resolve) => {
    const questionsRef = ref(db, 'questions');
    onValue(
      questionsRef,
      (snapshot: DataSnapshot) => {
        const data = snapshot.val();
        if (!data) {
          resolve(null);
          return;
        }
        for (const subjectKey in data) {
          for (const chapterKey in data[subjectKey]) {
            if (chapterKey.toLowerCase() === chapterQuery.toLowerCase()) {
              resolve(subjectKey);
              return;
            }
          }
        }
        resolve(null);
      },
      (error: Error) => {
        debug('Error finding subject for chapter:', error.message);
        resolve(null);
      }
    );
  });
};

const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) {
    await ctx.reply('Please provide a valid command.');
    return;
  }

  const text = ctx.message.text.trim();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/i);
  const subjectMatch = text.match(/^\/subject\s+(.+?)(?:\s+(\d+))?$/i);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/i);

  if (chapterMatch) {
    const chapterQuery = chapterMatch[1].trim();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 1;

    try {
      const chapters = await getUniqueItems('chapters', 'biology'); // Temporary: check all subjects later
      const matchedChapter = findBestMatchingItem(chapters, chapterQuery);

      if (!matchedChapter) {
        const { message } = await getItemsMessage('chapters');
        await ctx.replyWithHTML(
          `❌ No matching chapter found for "<b>${chapterQuery}</b>"\n\n${message}`
        );
        return;
      }

      const subject = await findSubjectForChapter(matchedChapter);
      if (!subject) {
        await ctx.reply(`No subject found for chapter "${matchedChapter}".`);
        return;
      }

      const filteredByChapter = await fetchQuestions(subject, matchedChapter);

      if (!filteredByChapter.length) {
        const { message } = await getItemsMessage('chapters', subject);
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

      if (!selected.length) {
        await ctx.reply(`No questions available for chapter "${matchedChapter}".`);
        return;
      }

      for (const question of selected) {
        const options = [
          question.options?.A || 'Option A',
          question.options?.B || 'Option B',
          question.options?.C || 'Option C',
          question.options?.D || 'Option D',
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (question.image) {
          await ctx.replyWithPhoto({ url: question.image });
        }

        await ctx.sendPoll(
          question.question || 'No question text',
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
      debug('Error fetching chapter questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

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

      if (!selected.length) {
        await ctx.reply(`No questions available for subject "${matchedSubject}".`);
        return;
      }

      for (const question of selected) {
        const options = [
          question.options?.A || 'Option A',
          question.options?.B || 'Option B',
          question.options?.C || 'Option C',
          question.options?.D || 'Option D',
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (question.image) {
          await ctx.replyWithPhoto({ url: question.image });
        }

        await ctx.sendPoll(
          question.question || 'No question text',
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
      debug('Error fetching subject questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

  if (cmdMatch) {
    const cmd = cmdMatch[1].toLowerCase();
    const subjectCode = cmdMatch[2];
    const count = cmdMatch[3] ? parseInt(cmdMatch[3].trim(), 10) : 1;

    const subjectMap: Record<string, string> = {
      b: 'biology',
      c: 'chemistry',
      p: 'physics',
    };

    let subject: string | null = null;
    let isMixed = false;

    if (cmd === 'pyq' && !subjectCode) {
      isMixed = true; // Random questions from all subjects
    } else if (subjectCode) {
      subject = subjectMap[subjectCode];
    } else if (['b1', 'c1'].includes(cmd)) {
      subject = subjectMap[cmd[0]];
    } else {
      await ctx.reply('Invalid command format. Use /pyq [count], /pyqb [count], /pyqc [count], /pyqp [count], /b1 [count], or /c1 [count].');
      return;
    }

    try {
      const filtered = isMixed ? await fetchQuestions() : await fetchQuestions(subject!);

      if (!filtered.length) {
        await ctx.reply(`No questions available for ${subject || 'the selected subjects'}.`);
        return;
      }

      const shuffled = filtered.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, filtered.length));

      if (!selected.length) {
        await ctx.reply(`No questions available for ${subject || 'the selected subjects'}.`);
        return;
      }

      for (const question of selected) {
        const options = [
          question.options?.A || 'Option A',
          question.options?.B || 'Option B',
          question.options?.C || 'Option C',
          question.options?.D || 'Option D',
        ];
        const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

        if (!question.correct_option || correctOptionIndex === -1) {
          debug('Invalid correct_option for question:', question);
          continue; // Skip questions with invalid correct_option
        }

        if (question.image) {
          try {
            await ctx.replyWithPhoto({ url: question.image });
          } catch (photoErr) {
            debug('Error sending photo:', photoErr);
          }
        }

        try {
          await ctx.sendPoll(
            question.question || 'No question text',
            options,
            {
              type: 'quiz',
              correct_option_id: correctOptionIndex,
              is_anonymous: false,
              explanation: question.explanation || 'No explanation provided.',
            } as any
          );
        } catch (pollErr) {
          debug('Error sending poll:', pollErr);
          continue; // Skip to next question if poll fails
        }
      }

      if (selected.length === 0) {
        await ctx.reply('No valid questions could be sent. Please try again.');
      }
    } catch (err) {
      debug('Error fetching questions for command:', cmd, err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

  await ctx.reply(
    'Invalid command. Use:\n' +
    '- /chapter [name] [count] (e.g., /chapter Living World 2)\n' +
    '- /subject [name] [count] (e.g., /subject Biology 2)\n' +
    '- /pyq [count] (e.g., /pyq 2 for random questions)\n' +
    '- /pyqb [count], /pyqc [count], /pyqp [count]\n' +
    '- /b1 [count], /c1 [count]'
  );
};

export { quizes };
