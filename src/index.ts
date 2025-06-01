import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllChatIds, saveChatId, fetchChatIdsFromSheet } from './utils/chatStore';
import { db, ref, push, set, onValue } from './utils/firebase';
import { DataSnapshot } from 'firebase/database';
import { saveToSheet } from './utils/saveToSheet';
import { about } from './commands';
import { quizes, greeting, yakeen } from './text';
import { development, production } from './core';
import { isPrivateChat } from './utils/groupSettings';
import { quote } from './commands/quotes';
import createDebug from 'debug';

const debug = createDebug('bot:index');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;
const CHANNEL_ID = process.env.CHANNEL_ID || '-1002277073649';
let accessToken: string | null = null;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
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

// Store pending publish submissions for /publish command
interface PendingPublish {
  subject: string;
  chapter: string;
  awaitingChapterSelection?: boolean;
  awaitingKeys?: boolean;
  page?: number; // For chapter pagination
}

const pendingSubmissions: { [key: number]: PendingQuestion } = {};
const pendingPublishes: { [key: number]: PendingPublish } = {};

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

// --- FETCH CHAPTERS ---
async function fetchChapters(subject: string): Promise<string[]> {
  return new Promise((resolve) => {
    const subjectRef = ref(db, `questions/${subject.toLowerCase()}`);
    onValue(
      subjectRef,
      (snapshot: DataSnapshot) => {
        const data = snapshot.val();
        debug('Fetched chapters for subject:', subject, 'data:', data);
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

// --- FETCH BATCHES ---
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

// --- FETCH SUBJECTS ---
async function fetchSubjects(batch: string): Promise<string[]> {
  return new Promise((resolve) => {
    const subjectRef = ref(db, `batches/${batch}`);
    onValue(
      subjectRef,
      (snapshot: DataSnapshot) => {
        const data = snapshot.val();
        const subjects = data ? Object.keys(data).filter((s) => s) : [];
        resolve(subjects.sort());
      },
      (error: Error) => {
        debug('Error fetching subjects:', error.message);
        resolve([]);
      }
    );
  });
}

// --- COMMANDS ---
bot.command('about', about());
bot.command('quote', quote());
bot.command('yakeen', yakeen());

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

  const msg = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ').slice(1).join(' ') : '';
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

  const parts = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ') : [];
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

  const command = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ')[0].substring(1) : '';
  const countStr = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ')[1] : '';
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
    if (ctx.from?.id) {
      pendingSubmissions[ctx.from.id] = {
        subject,
        chapter,
        count,
        questions: [],
        expectingImageFor: undefined,
        awaitingChapterSelection: false,
      };
    }

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

  const chapters = await fetchChapters(subject);
  if (chapters.length === 0) {
    return ctx.reply(
      `❌ No chapters found for ${subject}. Please specify a chapter manually using /add${subject}_<chapter> <count>\n` +
      `Example: /add${subject}_Living_World 10`
    );
  }

  const chaptersList = chapters.map((ch, index) => `${index + 1}. ${ch}`).join('\n');
  const telegraphContent = `Chapters for ${subject}:\n${chaptersList}`;
  const telegraphUrl = await createTelegraphPage(`Chapters for ${subject}`, telegraphContent);

  if (ctx.from?.id) {
    pendingSubmissions[ctx.from.id] = {
      subject,
      chapter,
      count,
      questions: [],
      expectingImageFor: undefined,
      awaitingChapterSelection: true,
    };
  }

  const replyText = `Please select a chapter for *${subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
    (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : '');
  await ctx.reply(replyText, { parse_mode: 'Markdown' });
});

// --- PUBLISH COMMAND ---
bot.command('publish', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply('You are not authorized to use this command.');
  }

  const batches = await fetchBatches();
  if (batches.length === 0) {
    return ctx.reply('No batches found in Firebase.');
  }

  const batchesList = batches.map((b, index) => `${index + 1}. ${b}`).join('\n');
  const telegraphContent = `Batches:\n${batchesList}`;
  const telegraphUrl = await createTelegraphPage('Batches', telegraphContent);

  if (ctx.from?.id) {
    pendingPublishes[ctx.from.id] = {
      subject: '',
      chapter: '',
      awaitingChapterSelection: false,
      awaitingKeys: false,
      page: 1,
    };
  }

  const replyText = `Please select a batch by replying with the batch number:\n\n${batchesList}\n\n` +
    (telegraphUrl ? `📖 View batches on Telegraph: ${telegraphUrl}` : '');
  await ctx.reply(replyText, { parse_mode: 'Markdown' });
});

bot.start(async (ctx) => {
  if (isPrivateChat(ctx.chat?.type)) {
    await ctx.reply('Welcome! Use /help to explore commands.');
    await greeting()(ctx);
  }
});

bot.on('message', async (ctx) => {
  const chat = ctx.chat;
  const msg = ctx.message as any;
  const chatType = chat?.type;

  if (!chat?.id || !ctx.from?.id) return;

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

  if (msg?.text?.startsWith('/contact')) {
    const userMessage = msg.text.replace('/contact', '').trim() || (msg.reply_to_message?.text ?? '');
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

  if (chat.id === ADMIN_ID && msg?.reply_to_message?.text) {
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

  // Handle batch selection for /publish
  if (chat.id === ADMIN_ID && pendingPublishes[ctx.from.id] && !pendingPublishes[ctx.from.id].subject && msg?.text) {
    const batchNumber = parseInt(msg.text.trim(), 10);
    const batches = await fetchBatches();
    if (isNaN(batchNumber) || batchNumber < 1 || batchNumber > batches.length) {
      await ctx.reply(`Please enter a valid batch number between 1 and ${batches.length}.`);
      return;
    }

    pendingPublishes[ctx.from.id].subject = batches[batchNumber - 1].toLowerCase();
    const subjects = await fetchSubjects(pendingPublishes[ctx.from.id].subject);
    if (subjects.length === 0) {
      await ctx.reply(`No subjects found for batch ${pendingPublishes[ctx.from.id].subject}.`);
      delete pendingPublishes[ctx.from.id];
      return;
    }

    const subjectsList = subjects.map((s, index) => `${index + 1}. ${s}`).join('\n');
    const telegraphContent = `Subjects for ${pendingPublishes[ctx.from.id].subject}:\n${subjectsList}`;
    const telegraphUrl = await createTelegraphPage(`Subjects for ${pendingPublishes[ctx.from.id].subject}`, telegraphContent);

    const replyText = `Please select a subject for *${pendingPublishes[ctx.from.id].subject}* by replying with the subject number:\n\n${subjectsList}\n\n` +
      (telegraphUrl ? `📖 View subjects on Telegraph: ${telegraphUrl}` : '');
    await ctx.reply(replyText, { parse_mode: 'Markdown' });
    return;
  }

  // Handle subject selection for /publish
  if (chat.id === ADMIN_ID && pendingPublishes[ctx.from.id]?.subject && !pendingPublishes[ctx.from.id].chapter && msg?.text) {
    const subjectNumber = parseInt(msg.text.trim(), 10);
    const subjects = await fetchSubjects(pendingPublishes[ctx.from.id].subject);
    if (isNaN(subjectNumber) || subjectNumber < 1 || subjectNumber > subjects.length) {
      await ctx.reply(`Please enter a valid subject number between 1 and ${subjects.length}.`);
      return;
    }

    pendingPublishes[ctx.from.id].subject = subjects[subjectNumber - 1].toLowerCase();
    const chapters = await fetchChapters(pendingPublishes[ctx.from.id].subject);
    if (chapters.length === 0) {
      await ctx.reply(`No chapters found for ${pendingPublishes[ctx.from.id].subject}.`);
      delete pendingPublishes[ctx.from.id];
      return;
    }

    pendingPublishes[ctx.from.id].awaitingChapterSelection = true;
    pendingPublishes[ctx.from.id].page = 1;

    const ITEMS_PER_PAGE = 10;
    const start = (pendingPublishes[ctx.from.id].page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedChapters = chapters.slice(start, end);
    const chaptersList = paginatedChapters.map((ch, index) => `${start + index + 1}. ${ch}`).join('\n');
    const telegraphContent = `Chapters for ${pendingPublishes[ctx.from.id].subject}:\n${chapters.map((ch, index) => `${index + 1}. ${ch}`).join('\n')}`;
    const telegraphUrl = await createTelegraphPage(`Chapters for ${pendingPublishes[ctx.from.id].subject}`, telegraphContent);

    const inlineKeyboard = [];
    if (chapters.length > ITEMS_PER_PAGE) {
      const buttons = [];
      if (pendingPublishes[ctx.from.id].page > 1) {
        buttons.push({ text: 'Previous', callback_data: `prev_page_${pendingPublishes[ctx.from.id].subject}` });
      }
      if (end < chapters.length) {
        buttons.push({ text: 'Next', callback_data: `next_page_${pendingPublishes[ctx.from.id].subject}` });
      }
      inlineKeyboard.push(buttons);
    }

    await ctx.reply(
      `Please select a chapter for *${pendingPublishes[ctx.from.id].subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
      (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : ''),
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard },
      }
    );
    return;
  }

  // Handle chapter selection for /publish
  if (chat.id === ADMIN_ID && pendingPublishes[ctx.from.id]?.awaitingChapterSelection && msg?.text) {
    const chapterNumber = parseInt(msg.text.trim(), 10);
    const chapters = await fetchChapters(pendingPublishes[ctx.from.id].subject);
    const start = (pendingPublishes[ctx.from.id].page - 1) * 10;
    if (isNaN(chapterNumber) || chapterNumber < start + 1 || chapterNumber > start + Math.min(10, chapters.length - start)) {
      await ctx.reply(`Please enter a valid chapter number between ${start + 1} and ${start + Math.min(10, chapters.length)}.`);
      return;
    }

    pendingPublishes[ctx.from.id].chapter = chapters[chapterNumber - 1].toLowerCase();
    pendingPublishes[ctx.from.id].awaitingChapterSelection = false;
    pendingPublishes[ctx.from.id].awaitingKeys = true;

    await ctx.reply(
      `Selected chapter: *${pendingPublishes[ctx.from.id].chapter}* for *${pendingPublishes[ctx.from.id].subject}*. ` +
      `Please send keys with message IDs in the format: key1:id1,key2:id2,...`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Handle chapter pagination for /publish
  bot.action(/prev_page_(.+)/, async (ctx) => {
    if (ctx.from?.id !== ADMIN_ID) {
      await ctx.answerCbQuery('Unauthorized');
      return;
    }

    const subject = ctx.match?.[1];
    if (!subject || !pendingPublishes[ctx.from.id] || pendingPublishes[ctx.from.id].subject !== subject) {
      await ctx.answerCbQuery('Session expired');
      return;
    }

    pendingPublishes[ctx.from.id].page = Math.max(1, pendingPublishes[ctx.from.id].page - 1);
    const chapters = await fetchChapters(subject);
    const ITEMS_PER_PAGE = 10;
    const start = (pendingPublishes[ctx.from.id].page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedChapters = chapters.slice(start, end);
    const chaptersList = paginatedChapters.map((ch, index) => `${start + index + 1}. ${ch}`).join('\n');
    const telegraphContent = `Chapters for ${subject}:\n${chapters.map((ch, index) => `${index + 1}. ${ch}`).join('\n')}`;
    const telegraphUrl = await createTelegraphPage(`Chapters for ${subject}`, telegraphContent);

    const inlineKeyboard = [];
    if (chapters.length > ITEMS_PER_PAGE) {
      const buttons = [];
      if (pendingPublishes[ctx.from.id].page > 1) {
        buttons.push({ text: 'Previous', callback_data: `prev_page_${subject}` });
      }
      if (end < chapters.length) {
        buttons.push({ text: 'Next', callback_data: `next_page_${subject}` });
      }
      inlineKeyboard.push(buttons);
    }

    await ctx.editMessageText(
      `Please select a chapter for *${subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
      (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : ''),
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard },
      }
    );
    await ctx.answerCbQuery('Previous page');
  });

  bot.action(/next_page_(.+)/, async (ctx) => {
    if (ctx.from?.id !== ADMIN_ID) {
      await ctx.answerCbQuery('Unauthorized');
      return;
    }

    const subject = ctx.match?.[1];
    if (!subject || !pendingPublishes[ctx.from.id] || pendingPublishes[ctx.from.id].subject !== subject) {
      await ctx.answerCbQuery('Session expired');
      return;
    }

    pendingPublishes[ctx.from.id].page += 1;
    const chapters = await fetchChapters(subject);
    const ITEMS_PER_PAGE = 10;
    const start = (pendingPublishes[ctx.from.id].page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const paginatedChapters = chapters.slice(start, end);
    const chaptersList = paginatedChapters.map((ch, index) => `${start + index + 1}. ${ch}`).join('\n');
    const telegraphContent = `Chapters for ${subject}:\n${chapters.map((ch, index) => `${index + 1}. ${ch}`).join('\n')}`;
    const telegraphUrl = await createTelegraphPage(`Chapters for ${subject}`, telegraphContent);

    const inlineKeyboard = [];
    if (chapters.length > ITEMS_PER_PAGE) {
      const buttons = [];
      if (pendingPublishes[ctx.from.id].page > 1) {
        buttons.push({ text: 'Previous', callback_data: `prev_page_${subject}` });
      }
      if (end < chapters.length) {
        buttons.push({ text: 'Next', callback_data: `next_page_${subject}` });
      }
      inlineKeyboard.push(buttons);
    }

    await ctx.editMessageText(
      `Please select a chapter for *${subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
      (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : ''),
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard },
      }
    );
    await ctx.answerCbQuery('Next page');
  });

  // Handle keys submission for /publish
  if (chat.id === ADMIN_ID && pendingPublishes[ctx.from.id]?.awaitingKeys && msg?.text) {
    const keysInput = msg.text.trim();
    const keyPairs = keysInput.split(',').map((pair: string) => pair.trim().split(':'));
    const validKeys: { [key: string]: string } = {};

    for (const [key, id] of keyPairs) {
      if (!key || isNaN(parseInt(id))) {
        await ctx.reply(`Invalid key or ID: ${key}:${id}. Please use format key1:id1,key2:id2,...`);
        return;
      }
      validKeys[key] = id;
    }

    try {
      const keysRef = ref(db, `batches/${pendingPublishes[ctx.from.id].subject}/${pendingPublishes[ctx.from.id].chapter}/keys`);
      await set(keysRef, { ...validKeys });
      await ctx.reply(
        `✅ Successfully added ${Object.keys(validKeys).length} keys to *${pendingPublishes[ctx.from.id].subject}* (Chapter: *${pendingPublishes[ctx.from.id].chapter}*).`
      );
      delete pendingPublishes[ctx.from.id];
    } catch (error) {
      debug('Failed to save keys to Firebase:', error);
      await ctx.reply('❌ Error: Unable to save keys to Firebase.');
    }
    return;
  }

  // Handle chapter selection for /add
  if (chat.id === ADMIN_ID && pendingSubmissions[ctx.from.id]?.awaitingChapterSelection && msg?.text) {
    const submission = pendingSubmissions[ctx.from.id];
    const chapterNumber = parseInt(msg.text.trim(), 10);

    const chapters = await fetchChapters(submission.subject);
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

  if (chat.id === ADMIN_ID && pendingSubmissions[ctx.from.id] && msg?.poll) {
    const submission = pendingSubmissions[ctx.from.id];
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
        delete pendingSubmissions[ctx.from.id];
      } catch (error) {
        debug('Failed to save questions to Firebase:', error);
        await ctx.reply('❌ Error: Unable to save questions to Firebase.');
      }
    }
    return;
  }

  if (chat.id === ADMIN_ID && pendingSubmissions[ctx.from.id] && msg?.text && pendingSubmissions[ctx.from.id].expectingImageFor) {
    const submission = pendingSubmissions[ctx.from.id];
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

  if (msg?.poll) {
    const poll = msg.poll;
    const pollJson = JSON.stringify(poll, null, 2);

    try {
      const pollsRef = ref(db, 'polls');
      const newPollRef = push(pollsRef);
      await set(newPollRef, {
        poll,
        from: {
          id: ctx.from.id,
          username: ctx.from.username || null,
          first_name: ctx.from.first_name || null,
          last_name: ctx.from.last_name || null,
        },
        chat: {
          id: chat.id,
          type: chat.type,
        },
        receivedAt: Date.now(),
      });
    } catch (error) {
      debug('Firebase save error:', error);
    }
    await ctx.reply('Thanks for sending a poll! Your poll data has been sent to the admin.');

    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `📊 *New Telegram Poll received from @${ctx.from.username || 'unknown'}:*\n\`\`\`json\n${pollJson}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );

    return;
  }

  await quizes()(ctx);

  if (isPrivateChat(chatType)) {
    await greeting()(ctx);
  }
});

export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
