import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllChatIds, saveChatId, fetchChatIdsFromSheet } from './utils/chatStore';
import { db, ref, push, set, onValue } from './utils/firebase';
import { DataSnapshot } from 'firebase/database';
import { saveToSheet } from './utils/saveToSheet';
import { about } from './commands';
import { quizes, greeting, yakeen } from './text'; // Added yakeen import
import { development, production } from './core';
import { isPrivateChat } from './utils/groupSettings';
import { quote } from './commands/quotes';
import createDebug from 'debug';

const debug = createDebug('bot:index');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;
const CHANNEL_ID = process.env.CHANNEL_ID || ''; // Add your channel ID in environment variables
let accessToken: string | null = null;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
if (!CHANNEL_ID) throw new Error('CHANNEL_ID not provided!');
const bot = new Telegraf(BOT_TOKEN);

// Store pending question submissions
interface PendingQuestion {
  subject: string;
  chapter: string;
  count: number;
  questions: Array<{
    question: string;
    options: { [key: string]: string };
    correct_option: string;
    explanation: string;
    image?: string;
  }>;
  expectingImageFor?: string;
  awaitingChapterSelection?: boolean;
}

// Store pending Yakeen key submissions
interface PendingYakeenSubmission {
  batch: string;
  subject: string;
  chapter: string;
  awaitingSubjectSelection?: boolean;
  awaitingChapterSelection?: boolean;
  awaitingKeys?: boolean;
  page?: number; // For pagination
}

const pendingSubmissions: { [key: number]: PendingQuestion } = {};
const pendingYakeenSubmissions: { [key: number]: PendingYakeenSubmission } = {};

// --- TELEGRAPH INTEGRATION ---
async function createTelegraphAccount() {
  try {
    const res = await fetch('https://api.telegra.ph/createAccount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_name: 'EduhubBot', author_name: 'Eduhub KMR Bot' }),
    });
    const data = await res.json();
    if (data.ok) {
      accessToken = data.result.access_token;
      debug('Telegraph account created, access token:', accessToken);
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    debug('Failed to create Telegraph account:', error);
  }
}

async function createTelegraphPage(title: string, content: string | any[]) {
  if (!accessToken) {
    await createTelegraphAccount();
  }
  try {
    const res = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        title,
        content: typeof content === 'string' ? [{ tag: 'p', children: [content] }] : content,
        return_content: true,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      return data.result.url;
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    debug('Failed to create Telegraph page:', error);
    return null;
  }
}

// --- FETCH DATA FROM FIREBASE ---
async function fetchBatches(): Promise<string[]> {
  return new Promise((resolve) => {
    const batchesRef = ref(db, 'batches');
    onValue(
      batchesRef,
      (snapshot: DataSnapshot) => {
        const data = snapshot.val();
        const batches = data ? Object.keys(data).filter((b) => b) : [];
        resolve(batches.sort());
      },
      (error: Error) => {
        debug('Error fetching batches:', error.message);
        resolve([]);
      }
    );
  });
}

async function fetchSubjects(batch: string): Promise<string[]> {
  return new Promise((resolve) => {
    const subjectsRef = ref(db, `batches/${batch}`);
    onValue(
      subjectsRef,
      (snapshot: DataSnapshot) => {
        const data = snapshot.val();
        const subjects = data ? Object.keys(data).filter((s) => s) : [];
        resolve(subjects.sort());
      },
      (error: Error) => {
        debug('Error fetching subjects for batch:', error.message);
        resolve([]);
      }
    );
  });
}

async function fetchChapters(batch: string, subject: string): Promise<string[]> {
  return new Promise((resolve) => {
    const chaptersRef = ref(db, `batches/${batch}/${subject}`);
    onValue(
      chaptersRef,
      (snapshot: DataSnapshot) => {
        const data = snapshot.val();
        const chapters = data ? Object.keys(data).filter((ch) => ch) : [];
        resolve(chapters.sort());
      },
      (error: Error) => {
        debug('Error fetching chapters:', error.message);
        resolve([]);
      }
    );
  });
}

// --- COMMANDS ---
bot.command('about', about());
bot.command('quote', quote());
bot.command('yakeen_lecture', yakeen()); // Yakeen lecture command

bot.command('users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply('You are not authorized to use this command.');
  }

  try {
    const chatIds = await fetchChatIdsFromSheet();
    const totalUsers = chatIds.length;

    await ctx.reply(
      `📊 Total users: ${totalUsers}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
        },
      }
    );
  } catch (err) {
    debug('Failed to fetch user count:', err);
    await ctx.reply('❌ Error: Unable to fetch user count from Google Sheet.');
  }
});

bot.action('refresh_users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    await ctx.answerCbQuery('Unauthorized');
    return;
  }

  try {
    const chatIds = await fetchChatIdsFromSheet();
    const totalUsers = chatIds.length;

    await ctx.editMessageText(
      `📊 Total users: ${totalUsers} (refreshed)`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
        },
      }
    );
    await ctx.answerCbQuery('Refreshed!');
  } catch (err) {
    debug('Failed to refresh user count:', err);
    await ctx.answerCbQuery('Refresh failed');
  }
});

bot.command('broadcast', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.reply('You are not authorized to use this command.');

  const msg = ctx.message?.text?.split(' ').slice(1).join(' ');
  if (!msg) return ctx.reply('Usage:\n/broadcast Your message here');

  let chatIds: number[] = [];

  try {
    chatIds = await fetchChatIdsFromSheet();
  } catch (err) {
    debug('Failed to fetch chat IDs:', err);
    return ctx.reply('❌ Error: Unable to fetch chat IDs from Google Sheet.');
  }

  if (chatIds.length === 0) {
    return ctx.reply('No users to broadcast to.');
  }

  let success = 0;
  for (const id of chatIds) {
    try {
      await ctx.telegram.sendMessage(id, msg);
      success++;
    } catch (err) {
      debug(`Failed to send to ${id}:`, err);
    }
  }

  await ctx.reply(`✅ Broadcast sent to ${success} users.`);
});

bot.command('reply', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.reply('You are not authorized to use this command.');

  const parts = ctx.message?.text?.split(' ');
  if (!parts || parts.length < 3) {
    return ctx.reply('Usage:\n/reply <chat_id> [message]');
  }

  const chatIdStr = parts[1].trim();
  const chatId = Number(chatIdStr);
  const message = parts.slice(2).join(' ');

  if (isNaN(chatId)) {
    return ctx.reply(`Invalid chat ID: ${chatIdStr}`);
  }

  try {
    await ctx.telegram.sendMessage(
      chatId,
      `*Admin's Reply:*\n${message}`,
      { parse_mode: 'Markdown' }
    );
    await ctx.reply(`Reply sent to ${chatId}`, { parse_mode: 'Markdown' });
  } catch (error) {
    debug('Reply error:', error);
    await ctx.reply(`Failed to send reply to ${chatId}`, { parse_mode: 'Markdown' });
  }
});

bot.command(/add[A-Za-z]+(_[A-Za-z_]+)?/, async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply('You are not authorized to use this command.');
  }

  const command = ctx.message?.text?.split(' ')[0].substring(1);
  const countStr = ctx.message?.text?.split(' ')[1];
  const count = parseInt(countStr || '', 10);

  if (!countStr || isNaN(count) || count <= 0) {
    return ctx.reply('Please specify a valid number of questions.\nExample: /addBiology 10 or /addBiology_Living_World 10');
  }

  let subject = '';
  let chapter = '';

  if (command.includes('_')) {
    const parts = command.split('_');
    subject = parts[0].replace(/^add/, '').toLowerCase();
    chapter = parts.slice(1).join(' ').replace(/_/g, ' ').toLowerCase();
    pendingSubmissions[ctx.from.id] = {
      subject,
      chapter,
      count,
      questions: [],
      expectingImageFor: undefined,
      awaitingChapterSelection: false,
    };

    await ctx.reply(
      `Selected chapter: *${chapter}* for *${subject}*. ` +
      `Please share ${count} questions as Telegram quiz polls. ` +
      `Each poll should have the question, 4 options, a correct answer, and an explanation. ` +
      `After sending a poll, you can optionally send an image URL for it.`,
      { parse_mode: 'Markdown' }
    );
    return;
  } else {
    subject = command.replace(/^add/, '').toLowerCase();
    chapter = 'random';
  }

  const chapters = await fetchChapters('2026', subject); // Assuming batch '2026'
  if (chapters.length === 0) {
    return ctx.reply(
      `❌ No chapters found for ${subject}. Please specify a chapter manually using /add${subject}_<chapter> <count>\n` +
      `Example: /add${subject}_Living_World 10`
    );
  }

  const chaptersList = chapters.map((ch, index) => `${index + 1}. ${ch}`).join('\n');
  const telegraphContent = `Chapters for ${subject}:\n${chaptersList}`;
  const telegraphUrl = await createTelegraphPage(`Chapters for ${subject}`, telegraphContent);

  pendingSubmissions[ctx.from.id] = {
    subject,
    chapter,
    count,
    questions: [],
    expectingImageFor: undefined,
    awaitingChapterSelection: true,
  };

  const replyText = `Please select a chapter for *${subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
    (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : '');
  await ctx.reply(replyText, { parse_mode: 'Markdown' });
});

bot.command('publish', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply('You are not authorized to use this command.');
  }

  const batches = await fetchBatches();
  if (batches.length === 0) {
    return ctx.reply('❌ No batches found in Firebase.');
  }

  const batchesList = batches.map((b, index) => `${index + 1}. ${b}`).join('\n');
  const telegraphContent = `Batches:\n${batchesList}`;
  const telegraphUrl = await createTelegraphPage('Batches', telegraphContent);

  pendingYakeenSubmissions[ctx.from.id] = {
    batch: '',
    subject: '',
    chapter: '',
    awaitingSubjectSelection: true,
    page: 1,
  };

  const replyText = `Please select a batch by replying with the batch number:\n\n${batchesList}\n\n` +
    (telegraphUrl ? `📖 View batches on Telegraph: ${telegraphUrl}` : '');
  await ctx.reply(replyText, { parse_mode: 'Markdown' });
});

bot.start(async (ctx) => {
  if (isPrivateChat(ctx.chat.type)) {
    await ctx.reply('Welcome! Use /help to explore commands.');
    await greeting()(ctx);
  }
});

bot.on('message', async (ctx) => {
  const chat = ctx.chat;
  const msg = ctx.message as any;
  const chatType = chat.type;

  if (!chat?.id) return;

  saveChatId(chat.id);
  const alreadyNotified = await saveToSheet(chat);

  if (chat.id !== ADMIN_ID && !alreadyNotified) {
    if (chat.type === 'private' && 'first_name' in chat) {
      const usernameText = 'username' in chat && typeof chat.username === 'string' ? `@${chat.username}` : 'N/A';
      await ctx.telegram.sendMessage(
        ADMIN_ID,
        `*New user started the bot!*\n\n*Name:* ${chat.first_name}\n*Username:* ${usernameText}\nChat ID: ${chat.id}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  if (msg.text?.startsWith('/contact')) {
    const userMessage = msg.text.replace('/contact', '').trim() || msg.reply_to_message?.text;
    if (userMessage) {
      const firstName = 'first_name' in chat ? chat.first_name : 'Unknown';
      const username = 'username' in chat && typeof chat.username === 'string' ? `@${chat.username}` : 'N/A';

      await ctx.telegram.sendMessage(
        ADMIN_ID,
        `*Contact Message from ${firstName} (${username})*\nChat ID: ${chat.id}\n\nMessage:\n${userMessage}`,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply('Your message has been sent to the admin!');
    } else {
      await ctx.reply('Please provide a message or reply to a message using /contact.');
    }
    return;
  }

  if (chat.id === ADMIN_ID && msg.reply_to_message?.text) {
    const match = msg.reply_to_message.text.match(/Chat ID: (\d+)/);
    if (match) {
      const targetId = parseInt(match[1], 10);
      try {
        await ctx.telegram.sendMessage(
          targetId,
          `*Admin's Reply:*\n${msg.text}`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        debug('Failed to send swipe reply:', err);
      }
    }
    return;
  }

  // Handle Yakeen submissions
  if (chat.id === ADMIN_ID && pendingYakeenSubmissions[chat.id]) {
    const submission = pendingYakeenSubmissions[chat.id];

    if (submission.awaitingSubjectSelection && msg.text) {
      const batches = await fetchBatches();
      const batchNumber = parseInt(msg.text.trim(), 10);
      if (isNaN(batchNumber) || batchNumber < 1 || batchNumber > batches.length) {
        await ctx.reply(`Please enter a valid batch number between 1 and ${batches.length}.`);
        return;
      }

      submission.batch = batches[batchNumber - 1];
      submission.awaitingSubjectSelection = false;
      submission.awaitingChapterSelection = true;

      const subjects = await fetchSubjects(submission.batch);
      if (subjects.length === 0) {
        delete pendingYakeenSubmissions[chat.id];
        return ctx.reply(`❌ No subjects found for batch ${submission.batch}.`);
      }

      const ITEMS_PER_PAGE = 10;
      const totalPages = Math.ceil(subjects.length / ITEMS_PER_PAGE);
      const start = (submission.page! - 1) * ITEMS_PER_PAGE;
      const end = start + ITEMS_PER_PAGE;
      const paginatedSubjects = subjects.slice(start, end);

      const subjectsList = paginatedSubjects.map((s, index) => `${start + index + 1}. ${s}`).join('\n');
      const telegraphContent = `Subjects for batch ${submission.batch}:\n${subjectsList}`;
      const telegraphUrl = await createTelegraphPage(`Subjects for ${submission.batch}`, telegraphContent);

      const inlineKeyboard = [];
      if (submission.page! > 1) {
        inlineKeyboard.push([{ text: 'Previous', callback_data: `prev_subjects_${submission.page! - 1}` }]);
      }
      if (submission.page! < totalPages) {
        inlineKeyboard.push([{ text: 'Next', callback_data: `next_subjects_${submission.page! + 1}` }]);
      }

      await ctx.reply(
        `Please select a subject for batch *${submission.batch}* by replying with the subject number:\n\n${subjectsList}\n\n` +
        (telegraphUrl ? `📖 View subjects on Telegraph: ${telegraphUrl}` : ''),
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard },
        }
      );
      return;
    }

    if (submission.awaitingChapterSelection && msg.text) {
      const subjects = await fetchSubjects(submission.batch);
      const subjectNumber = parseInt(msg.text.trim(), 10);
      if (isNaN(subjectNumber) || subjectNumber < 1 || subjectNumber > subjects.length) {
        await ctx.reply(`Please enter a valid subject number between 1 and ${subjects.length}.`);
        return;
      }

      submission.subject = subjects[subjectNumber - 1];
      submission.awaitingChapterSelection = false;
      submission.awaitingKeys = true;

      const chapters = await fetchChapters(submission.batch, submission.subject);
      if (chapters.length === 0) {
        delete pendingYakeenSubmissions[chat.id];
        return ctx.reply(`❌ No chapters found for ${submission.subject} in batch ${submission.batch}.`);
      }

      const ITEMS_PER_PAGE = 10;
      const totalPages = Math.ceil(chapters.length / ITEMS_PER_PAGE);
      const start = (submission.page! - 1) * ITEMS_PER_PAGE;
      const end = start + ITEMS_PER_PAGE;
      const paginatedChapters = chapters.slice(start, end);

      const chaptersList = paginatedChapters.map((ch, index) => `${start + index + 1}. ${ch}`).join('\n');
      const telegraphContent = `Chapters for ${submission.subject}:\n${chaptersList}`;
      const telegraphUrl = await createTelegraphPage(`Chapters for ${submission.subject}`, telegraphContent);

      const inlineKeyboard = [];
      if (submission.page! > 1) {
        inlineKeyboard.push([{ text: 'Previous', callback_data: `prev_chapters_${submission.page! - 1}` }]);
      }
      if (submission.page! < totalPages) {
        inlineKeyboard.push([{ text: 'Next', callback_data: `next_chapters_${submission.page! + 1}` }]);
      }

      await ctx.reply(
        `Please select a chapter for *${submission.subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
        (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : ''),
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard },
        }
      );
      return;
    }

    if (submission.awaitingKeys && msg.text) {
      const chapters = await fetchChapters(submission.batch, submission.subject);
      const chapterNumber = parseInt(msg.text.trim(), 10);
      if (isNaN(chapterNumber) || chapterNumber < 1 || chapterNumber > chapters.length) {
        await ctx.reply(`Please enter a valid chapter number between 1 and ${chapters.length}.`);
        return;
      }

      submission.chapter = chapters[chapterNumber - 1];
      submission.awaitingKeys = false;

      await ctx.reply(
        `Selected chapter: *${submission.chapter}* for *${submission.subject}* in batch *${submission.batch}*. ` +
        `Please send the keys in the format: key1:2,key_of_example:3 (key:message_id).`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (msg.text && !submission.awaitingSubjectSelection && !submission.awaitingChapterSelection && !submission.awaitingKeys) {
      const keysInput = msg.text.split(',').map((k: string) => k.trim());
      const keys: { [key: string]: number } = {};

      for (const keyPair of keysInput) {
        const [key, messageIdStr] = keyPair.split(':').map((s: string) => s.trim());
        const messageId = parseInt(messageIdStr, 10);
        if (key && !isNaN(messageId)) {
          keys[key] = messageId;
        }
      }

      if (Object.keys(keys).length === 0) {
        await ctx.reply('Please provide valid keys in the format: key1:2,key_of_example:3');
        return;
      }

      try {
        const keysRef = ref(db, `batches/${submission.batch}/${submission.subject}/${submission.chapter}/keys`);
        await set(keysRef, keys);
        await ctx.reply(
          `✅ Successfully added ${Object.keys(keys).length} keys to *${submission.batch}/${submission.subject}/${submission.chapter}*.`
        );
        delete pendingYakeenSubmissions[chat.id];
      } catch (error) {
        debug('Failed to save keys to Firebase:', error);
        await ctx.reply('❌ Error: Unable to save keys to Firebase.');
      }
      return;
    }
  }

  // Handle question submissions
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id]?.awaitingChapterSelection && msg.text) {
    const submission = pendingSubmissions[ctx.from.id];
    const chapterNumber = parseInt(msg.text.trim(), 10);

    const chapters = await fetchChapters('2026', submission.subject); // Assuming batch '2026'
    if (isNaN(chapterNumber) || chapterNumber < 1 || chapterNumber > chapters.length) {
      await ctx.reply(`Please enter a valid chapter number between 1 and ${chapters.length}.`);
      return;
    }

    submission.chapter = chapters[chapterNumber - 1].toLowerCase();
    submission.awaitingChapterSelection = false;

    await ctx.reply(
      `Selected chapter: *${submission.chapter}* for *${submission.subject}*. ` +
      `Please share ${submission.count} questions as Telegram quiz polls. ` +
      `Each poll should have the question, 4 options, a correct answer, and an explanation. ` +
      `After sending a poll, you can optionally send an image URL for it.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && msg.poll) {
    const submission = pendingSubmissions[chat.id];
    const poll = msg.poll;

    if (poll.type !== 'quiz') {
      await ctx.reply('Please send a quiz poll with a correct answer and explanation.');
      return;
    }

    if (poll.options.length !== 4) {
      await ctx.reply('Quiz polls must have exactly 4 options.');
      return;
    }

    if (!poll.explanation) {
      await ctx.reply('Quiz polls must include an explanation.');
      return;
    }

    const correctOptionIndex = poll.correct_option_id;
    const correctOptionLetter = ['A', 'B', 'C', 'D'][correctOptionIndex];

    const question = {
      question: poll.question,
      options: {
        A: poll.options[0].text,
        B: poll.options[1].text,
        C: poll.options[2].text,
        D: poll.options[3].text,
      },
      correct_option: correctOptionLetter,
      explanation: poll.explanation,
      image: '',
    };

    submission.questions.push(question);
    submission.expectingImageFor = poll.id;

    if (submission.questions.length < submission.count) {
      await ctx.reply(
        `Question ${submission.questions.length} saved. Please send an image URL for this question (or reply "skip" to proceed), ` +
        `then send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`
      );
    } else {
      try {
        for (const q of submission.questions) {
          const questionsRef = ref(db, `questions/${submission.subject}/${submission.chapter}`);
          const newQuestionRef = push(questionsRef);
          debug('Saving question to:', `questions/${submission.subject}/${submission.chapter}`, 'data:', q);
          await set(newQuestionRef, q);
        }
        await ctx.reply(
          `✅ Successfully added ${submission.count} questions to *${submission.subject}* (Chapter: *${submission.chapter}*).`
        );
        delete pendingSubmissions[chat.id];
      } catch (error) {
        debug('Failed to save questions to Firebase:', error);
        await ctx.reply('❌ Error: Unable to save questions to Firebase.');
      }
    }
    return;
  }

  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && msg.text && pendingSubmissions[chat.id].expectingImageFor) {
    const submission = pendingSubmissions[chat.id];
    const lastQuestion = submission.questions[submission.questions.length - 1];

    if (msg.text.toLowerCase() === 'skip') {
      lastQuestion.image = '';
      submission.expectingImageFor = undefined;
      if (submission.questions.length < submission.count) {
        await ctx.reply(
          `Image skipped. Please send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`
        );
      }
    } else if (msg.text.startsWith('http') && msg.text.match(/\.(jpg|jpeg|png|gif)$/i)) {
      lastQuestion.image = msg.text;
      submission.expectingImageFor = undefined;
      if (submission.questions.length < submission.count) {
        await ctx.reply(
          `Image saved. Please send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`
        );
      }
    } else {
      await ctx.reply(
        'Please send a valid image URL (jpg, jpeg, png, or gif) or reply "skip" to proceed without an image.'
      );
    }
    return;
  }

  if (msg.poll) {
    const poll = msg.poll;
    const pollJson = JSON.stringify(poll, null, 2);

    try {
      const pollsRef = ref(db, 'polls');
      const newPollRef = push(pollsRef);
      await set(newPollRef, {
        poll,
        from: {
          id: ctx.from?.id,
          username: ctx.from?.username || null,
          first_name: ctx.from?.first_name || null,
          last_name: ctx.from?.last_name || null,
        },
        chat: {
          id: ctx.chat.id,
          type: ctx.chat.type,
        },
        receivedAt: Date.now(),
      });
    } catch (error) {
      debug('Firebase save error:', error);
    }
    await ctx.reply('Thanks for sending a poll! Your poll data has been sent to the admin.');

    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `📊 *New Telegram Poll received from @${ctx.from?.username || 'unknown'}:*\n\`\`\`json\n${pollJson}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );

    return;
  }

  await quizes()(ctx);

  if (isPrivateChat(chatType)) {
    await greeting()(ctx);
  }
});

// Pagination actions for subjects and chapters
bot.action(/prev_subjects_(\d+)/, async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    await ctx.answerCbQuery('Unauthorized');
    return;
  }

  const page = parseInt(ctx.match![1], 10);
  const submission = pendingYakeenSubmissions[ctx.from.id];
  if (!submission) return;

  submission.page = page;
  const subjects = await fetchSubjects(submission.batch);
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(subjects.length / ITEMS_PER_PAGE);
  const start = (page - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const paginatedSubjects = subjects.slice(start, end);

  const subjectsList = paginatedSubjects.map((s, index) => `${start + index + 1}. ${s}`).join('\n');
  const telegraphContent = `Subjects for batch ${submission.batch}:\n${subjectsList}`;
  const telegraphUrl = await createTelegraphPage(`Subjects for ${submission.batch}`, telegraphContent);

  const inlineKeyboard = [];
  if (page > 1) {
    inlineKeyboard.push([{ text: 'Previous', callback_data: `prev_subjects_${page - 1}` }]);
  }
  if (page < totalPages) {
    inlineKeyboard.push([{ text: 'Next', callback_data: `next_subjects_${page + 1}` }]);
  }

  await ctx.editMessageText(
    `Please select a subject for batch *${submission.batch}* by replying with the subject number:\n\n${subjectsList}\n\n` +
    (telegraphUrl ? `📖 View subjects on Telegraph: ${telegraphUrl}` : ''),
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard },
    }
  );
  await ctx.answerCbQuery();
});

bot.action(/next_subjects_(\d+)/, async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    await ctx.answerCbQuery('Unauthorized');
    return;
  }

  const page = parseInt(ctx.match![1], 10);
  const submission = pendingYakeenSubmissions[ctx.from.id];
  if (!submission) return;

  submission.page = page;
  const subjects = await fetchSubjects(submission.batch);
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(subjects.length / ITEMS_PER_PAGE);
  const start = (page - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const paginatedSubjects = subjects.slice(start, end);

  const subjectsList = paginatedSubjects.map((s, index) => `${start + index + 1}. ${s}`).join('\n');
  const telegraphContent = `Subjects for batch ${submission.batch}:\n${subjectsList}`;
  const telegraphUrl = await createTelegraphPage(`Subjects for ${submission.batch}`, telegraphContent);

  const inlineKeyboard = [];
  if (page > 1) {
    inlineKeyboard.push([{ text: 'Previous', callback_data: `prev_subjects_${page - 1}` }]);
  }
  if (page < totalPages) {
    inlineKeyboard.push([{ text: 'Next', callback_data: `next_subjects_${page + 1}` }]);
  }

  await ctx.editMessageText(
    `Please select a subject for batch *${submission.batch}* by replying with the subject number:\n\n${subjectsList}\n\n` +
    (telegraphUrl ? `📖 View subjects on Telegraph: ${telegraphUrl}` : ''),
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard },
    }
  );
  await ctx.answerCbQuery();
});

bot.action(/prev_chapters_(\d+)/, async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    await ctx.answerCbQuery('Unauthorized');
    return;
  }

  const page = parseInt(ctx.match![1], 10);
  const submission = pendingYakeenSubmissions[ctx.from.id];
  if (!submission) return;

  submission.page = page;
  const chapters = await fetchChapters(submission.batch, submission.subject);
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(chapters.length / ITEMS_PER_PAGE);
  const start = (page - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const paginatedChapters = chapters.slice(start, end);

  const chaptersList = paginatedChapters.map((ch, index) => `${start + index + 1}. ${ch}`).join('\n');
  const telegraphContent = `Chapters for ${submission.subject}:\n${chaptersList}`;
  const telegraphUrl = await createTelegraphPage(`Chapters for ${submission.subject}`, telegraphContent);

  const inlineKeyboard = [];
  if (page > 1) {
    inlineKeyboard.push([{ text: 'Previous', callback_data: `prev_chapters_${page - 1}` }]);
  }
  if (page < totalPages) {
    inlineKeyboard.push([{ text: 'Next', callback_data: `next_chapters_${page + 1}` }]);
  }

  await ctx.editMessageText(
    `Please select a chapter for *${submission.subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
    (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : ''),
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard },
    }
  );
  await ctx.answerCbQuery();
});

bot.action(/next_chapters_(\d+)/, async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    await ctx.answerCbQuery('Unauthorized');
    return;
  }

  const page = parseInt(ctx.match![1], 10);
  const submission = pendingYakeenSubmissions[ctx.from.id];
  if (!submission) return;

  submission.page = page;
  const chapters = await fetchChapters(submission.batch, submission.subject);
  const ITEMS_PER_PAGE = 10;
  const totalPages = Math.ceil(chapters.length / ITEMS_PER_PAGE);
  const start = (page - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const paginatedChapters = chapters.slice(start, end);

  const chaptersList = paginatedChapters.map((ch, index) => `${start + index + 1}. ${ch}`).join('\n');
  const telegraphContent = `Chapters for ${submission.subject}:\n${chaptersList}`;
  const telegraphUrl = await createTelegraphPage(`Chapters for ${submission.subject}`, telegraphContent);

  const inlineKeyboard = [];
  if (page > 1) {
    inlineKeyboard.push([{ text: 'Previous', callback_data: `prev_chapters_${page - 1}` }]);
  }
  if (page < totalPages) {
    inlineKeyboard.push([{ text: 'Next', callback_data: `next_chapters_${page + 1}` }]);
  }

  await ctx.editMessageText(
    `Please select a chapter for *${submission.subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
    (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : ''),
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard },
    }
  );
  await ctx.answerCbQuery();
});

export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
