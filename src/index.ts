import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { saveToSheet } from './utils/saveToSheet';
import { fetchChatIdsFromSheet } from './utils/chatStore';
import { about } from './commands/about';
import { help, handleHelpPagination } from './commands/help';
import { pdf } from './commands/pdf';
import { greeting } from './text/greeting';
import { production, development } from './core';
import { isPrivateChat } from './utils/groupSettings';
import { setupBroadcast } from './commands/broadcast';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;

// Add this line near top with others
const SOURCE_GROUP_ID = -1002196697906;
const TARGET_CHANNEL_USERNAME = '@AkashTest_Series';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
console.log(`Running bot in ${ENVIRONMENT} mode`);

const bot = new Telegraf(BOT_TOKEN);

// --- Commands ---
bot.command('about', about());

const helpTriggers = ['help', 'study', 'material', 'pdf', 'pdfs'];
helpTriggers.forEach(trigger => bot.command(trigger, help()));
bot.hears(/^(help|study|material|pdf|pdfs)$/i, help());

// Admin: /users
bot.command('users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.reply('You are not authorized.');
  try {
    const chatIds = await fetchChatIdsFromSheet();
    await ctx.reply(`📊 Total users: ${chatIds.length}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
      },
    });
  } catch (err) {
    console.error('Error fetching user count:', err);
    await ctx.reply('❌ Unable to fetch user count.');
  }
});

// Admin: /broadcast
setupBroadcast(bot);

// --- Callback Handler ---
bot.on('callback_query', async (ctx) => {
  const callback = ctx.callbackQuery;
  if ('data' in callback) {
    const data = callback.data;
    if (data.startsWith('help_page_')) {
      await handleHelpPagination()(ctx);
    } else if (data === 'refresh_users' && ctx.from?.id === ADMIN_ID) {
      try {
        const chatIds = await fetchChatIdsFromSheet();
        await ctx.editMessageText(`📊 Total users: ${chatIds.length}`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
          },
        });
      } catch (err) {
        console.error('Error refreshing users:', err);
        await ctx.answerCbQuery('Failed to refresh.');
      }
    } else {
      await ctx.answerCbQuery('Unknown action');
    }
  } else {
    await ctx.answerCbQuery('Unsupported callback type');
  }
});

// --- /start ---
bot.start(async (ctx) => {
  if (!ctx.chat || !isPrivateChat(ctx.chat.type)) return;

  const user = ctx.from;
  const chat = ctx.chat;

  await greeting()(ctx);
  await pdf()(ctx);

  const alreadyNotified = await saveToSheet(chat);
  console.log(`Saved chat ID: ${chat.id} (${chat.type})`);

  if (chat.id !== ADMIN_ID && !alreadyNotified) {
    const name = user?.first_name || 'Unknown';
    const username = user?.username ? `@${user.username}` : 'N/A';
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `*New user started the bot!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Type:* ${chat.type}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// --- Text Handler ---
bot.on('text', async (ctx) => {
  if (!ctx.chat || !isPrivateChat(ctx.chat.type)) return;

  const text = ctx.message.text?.toLowerCase();
  if (['help', 'study', 'material', 'pdf', 'pdfs'].includes(text)) {
    await help()(ctx);
  } else {
    await greeting()(ctx);
    await pdf()(ctx);
  }
});
// --- Forward Group Messages ---
bot.on('message', async (ctx) => {
  const chat = ctx.chat;

  // Only handle group forwarding
  if (chat && chat.id === SOURCE_GROUP_ID) {
    try {
      const messageId = ctx.message.message_id;

      // Forward to target channel
      await ctx.telegram.forwardMessage(TARGET_CHANNEL_USERNAME, chat.id, messageId);

      console.log(`Forwarded message ${messageId} from group ${chat.id} to ${TARGET_CHANNEL_USERNAME}`);
    } catch (err) {
      console.error(`❌ Failed to forward message ${ctx.message.message_id} from group ${chat.id}`, err);

      // Optional: Notify admin (you)
      await ctx.telegram.sendMessage(
        ADMIN_ID,
        `❌ *Error Forwarding Message*\n\nGroup: \`${chat.id}\`\nMessage ID: \`${ctx.message.message_id}\`\nError: \`${(err as Error).message}\``,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  // Keep your private message tracking logic here
  if (!chat?.id || !isPrivateChat(chat.type)) return;

  const alreadyNotified = await saveToSheet(chat);
  console.log(`Saved chat ID: ${chat.id} (${chat.type})`);

  if (chat.id !== ADMIN_ID && !alreadyNotified) {
    const user = ctx.from;
    const name = user?.first_name || 'Unknown';
    const username = user?.username ? `@${user.username}` : 'N/A';
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `*New user interacted!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Type:* ${chat.type}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// --- New Member Welcome (Group) ---
bot.on('new_chat_members', async (ctx) => {
  for (const member of ctx.message.new_chat_members) {
    if (member.username === ctx.botInfo.username) {
      await ctx.reply('Thanks for adding me! Type /help to get started.');
    }
  }
});

// --- Vercel Export ---
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
