import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import { about } from './commands';
import { greeting } from './text';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';

const bot = new Telegraf(BOT_TOKEN);

// Store user sessions to track pagination
const userSessions = new Map();

// Helper function to fetch word definition
async function fetchWordDefinition(word) {
  try {
    const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
    return response.data[0]; // Return the first entry
  } catch (error) {
    console.error('Error fetching definition:', error.message);
    return null;
  }
}

// Helper function to format a meaning for display
function formatMeaning(meaning, index, total) {
  const definition = meaning.definitions[0];
  return (
    `*Definition* (${index + 1}/${total})\n` +
    `*Part of Speech*: ${meaning.partOfSpeech}\n` +
    `*Definition*: ${definition.definition}\n` +
    (definition.example ? `*Example*: ${definition.example}\n` : '')
  );
}

// Handle /try command
bot.command('try', async (ctx) => {
  const word = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!word) {
    return ctx.reply('Please provide a word. Usage: /try <word>');
  }

  const data = await fetchWordDefinition(word);
  if (!data || !data.meanings || data.meanings.length === 0) {
    return ctx.reply(`No definitions found for "${word}".`);
  }

  // Initialize session for the user
  const userId = ctx.from.id;
  userSessions.set(userId, {
    word,
    meanings: data.meanings,
    currentIndex: 0,
  });

  // Send the first meaning with navigation buttons
  const meaning = data.meanings[0];
  const total = data.meanings.length;
  await ctx.replyWithMarkdown(
    `*Word*: ${word}\n${formatMeaning(meaning, 0, total)}`,
    Markup.inlineKeyboard([
      total > 1 ? Markup.button.callback('Next', `next_${userId}`) : null,
    ].filter(Boolean))
  );
});

// Handle Next and Previous buttons
bot.action(/next_(\d+)/, async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  const session = userSessions.get(userId);
  if (!session) return ctx.answerCbQuery('Session expired.');

  session.currentIndex = (session.currentIndex + 1) % session.meanings.length;
  const meaning = session.meanings[session.currentIndex];
  const total = session.meanings.length;

  await ctx.editMessageText(
    `*Word*: ${session.word}\n${formatMeaning(meaning, session.currentIndex, total)}`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        session.currentIndex > 0 ? Markup.button.callback('Previous', `prev_${userId}`) : null,
        session.currentIndex < total - 1 ? Markup.button.callback('Next', `next_${userId}`) : null,
      ].filter(Boolean)).reply_markup,
    }
  );
  ctx.answerCbQuery();
});

bot.action(/prev_(\d+)/, async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  const session = userSessions.get(userId);
  if (!session) return ctx.answerCbQuery('Session expired.');

  session.currentIndex = (session.currentIndex - 1 + session.meanings.length) % session.meanings.length;
  const meaning = session.meanings[session.currentIndex];
  const total = session.meanings.length;

  await ctx.editMessageText(
    `*Word*: ${session.word}\n${formatMeaning(meaning, session.currentIndex, total)}`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        session.currentIndex > 0 ? Markup.button.callback('Previous', `prev_${userId}`) : null,
        session.currentIndex < total - 1 ? Markup.button.callback('Next', `next_${userId}`) : null,
      ].filter(Boolean)).reply_markup,
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
