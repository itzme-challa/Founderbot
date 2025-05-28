import { Telegraf, Markup, Context } from 'telegraf';
import axios, { AxiosError } from 'axios';
import { about } from './commands';
import { greeting } from './text';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';

// Define types for Dictionary API response
interface Definition {
  definition: string;
  example?: string;
  synonyms: string[];
  antonyms: string[];
}

interface Meaning {
  partOfSpeech: string;
  definitions: Definition[];
}

interface DictionaryEntry {
  word: string;
  phonetic?: string;
  phonetics: { text?: string; audio?: string }[];
  origin?: string;
  meanings: Meaning[];
}

// Session data for pagination
interface UserSession {
  word: string;
  meanings: Meaning[];
  currentIndex: number;
}

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';

const bot = new Telegraf(BOT_TOKEN);

// Store user sessions to track pagination
const userSessions = new Map<number, UserSession>();

// Helper function to fetch word definition
async function fetchWordDefinition(word: string): Promise<DictionaryEntry | null> {
  try {
    const response = await axios.get<DictionaryEntry[]>(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
    return response.data[0]; // Return the first entry
  } catch (error: unknown) {
    console.error('Error fetching definition:', (error as AxiosError).message);
    return null;
  }
}

// Helper function to format a meaning for display
function formatMeaning(meaning: Meaning, index: number, total: number): string {
  const definition = meaning.definitions[0];
  return (
    `*Definition* (${index + 1}/${total})\n` +
    `*Part of Speech*: ${meaning.partOfSpeech}\n` +
    `*Definition*: ${definition.definition}\n` +
    (definition.example ? `*Example*: ${definition.example}\n` : '')
  );
}

// Handle /try command
bot.command('try', async (ctx: Context) => {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const word = text.split(' ').slice(1).join(' ').trim();
  if (!word) {
    return ctx.reply('Please provide a word. Usage: /try <word>');
  }

  const data = await fetchWordDefinition(word);
  if (!data || !data.meanings || data.meanings.length === 0) {
    return ctx.reply(`No definitions found for "${word}".`);
  }

  // Initialize session for the user
  const userId = ctx.from?.id;
  if (!userId) return ctx.reply('Error: User ID not found.');
  userSessions.set(userId, {
    word,
    meanings: data.meanings,
    currentIndex: 0,
  });

  // Send the first meaning with navigation buttons
  const meaning = data.meanings[0];
  const total = data.meanings.length;
  const buttons = total > 1 ? [Markup.button.callback('Next', `next_${userId}`)] : [];
  await ctx.replyWithMarkdown(
    `*Word*: ${word}\n${formatMeaning(meaning, 0, total)}`,
    Markup.inlineKeyboard(buttons)
  );
});

// Handle Next and Previous buttons
bot.action(/next_(\d+)/, async (ctx: Context) => {
  const userId = parseInt(ctx.match![1]);
  const session = userSessions.get(userId);
  if (!session) return ctx.answerCbQuery('Session expired.');

  session.currentIndex = (session.currentIndex + 1) % session.meanings.length;
  const meaning = session.meanings[session.currentIndex];
  const total = session.meanings.length;

  const buttons = [];
  if (session.currentIndex > 0) {
    buttons.push(Markup.button.callback('Previous', `prev_${userId}`));
  }
  if (session.currentIndex < total - 1) {
    buttons.push(Markup.button.callback('Next', `next_${userId}`));
  }

  await ctx.editMessageText(
    `*Word*: ${session.word}\n${formatMeaning(meaning, session.currentIndex, total)}`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    }
  );
  ctx.answerCbQuery();
});

bot.action(/prev_(\d+)/, async (ctx: Context) => {
  const userId = parseInt(ctx.match![1]);
  const session = userSessions.get(userId);
  if (!session) return ctx.answerCbQuery('Session expired.');

  session.currentIndex = (session.currentIndex - 1 + session.meanings.length) % session.meanings.length;
  const meaning = session.meanings[session.currentIndex];
  const total = session.meanings.length;

  const buttons = [];
  if (session.currentIndex > 0) {
    buttons.push(Markup.button.callback('Previous', `prev_${userId}`));
  }
  if (session.currentIndex < total - 1) {
    buttons.push(Markup.button.callback('Next', `next_${userId}`));
  }

  await ctx.editMessageText(
    `*Word*: ${session.word}\n${formatMeaning(meaning, session.currentIndex, total)}`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    }
  );
  ctx.answerCbQuery();
});

// Existing commands
bot.command('about', about());
bot.on('message', greeting());

// Prod mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

// Dev mode
if (ENVIRONMENT !== 'production') {
  development(bot);
}
