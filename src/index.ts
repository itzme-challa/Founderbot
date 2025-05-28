import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
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
const SOURCE_CHANNEL = '@pw_yakeen2_neet2026';
const TARGET_CHANNEL = '@AkashTest_Series';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://founderbot.vercel.app/';  // Replace with your Vercel app URL

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
console.log(`Running bot in ${ENVIRONMENT} mode`);

const bot = new Telegraf(BOT_TOKEN);

// --- Commands ---
bot.command('about', about());

// Multiple triggers for help/material/pdf content
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

// --- /support Command ---
bot.command('support', async (ctx) => {
  if (!ctx.chat || !isPrivateChat(ctx.chat.type)) {
    return ctx.reply('Please use this command in a private chat.');
  }

  const user = ctx.from;
  const args = ctx.message.text.split(' ').slice(1); // Get arguments after /support
  const amount = args[0] === '20' ? 20 : 10; // Default to 10 INR, 20 INR if specified
  const productId = `support_${amount}`; // Unique product ID
  const productName = `Support Donation (${amount} INR)`;
  const telegramLink = 'https://t.me/AkashTest_Series'; // Replace with actual Telegram link for post-payment access

  const customerName = user?.first_name || 'Unknown';
  const customerUsername = user?.username ? `@${user.username}` : 'N/A';
  const customerId = user?.id.toString();
  const customerEmail = `${customerId}@example.com`; // Placeholder email, as Telegram doesn't provide email
  const customerPhone = '9999999999'; // Placeholder phone, replace with actual if available

  try {
    const response = await axios.post(`${BASE_URL}/api/createOrder`, {
      productId,
      productName,
      amount,
      telegramLink,
      customerName,
      customerEmail,
      customerPhone,
    });

    if (response.data.success) {
      const { paymentSessionId } = response.data;
      await ctx.reply(
        `Thank you for supporting us! Please complete the payment of ₹${amount} using the link below:\n\n` +
        `https://api.cashfree.com/pg/links/${paymentSessionId}\n\n` +
        `After payment, you'll be redirected to the Telegram group. You can also join manually: ${telegramLink}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: 'Pay Now', url: `https://api.cashfree.com/pg/links/${paymentSessionId}` }]],
          },
        }
      );
    } else {
      await ctx.reply('❌ Failed to initiate payment. Please try again later.');
    }
  } catch (error) {
    console.error('Error initiating payment:', error);
    await ctx.reply('❌ An error occurred while processing your request. Please try again.');
  }
});

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

// --- New Member Welcome (Group) ---
bot.on('new_chat_members', async (ctx) => {
  for (const member of ctx.message.new_chat_members) {
    if (member.username === ctx.botInfo.username) {
      await ctx.reply('Thanks for adding me! Type /help to get started.');
    }
  }
});

// --- Message Tracker for Private Chats ---
bot.on('message', async (ctx) => {
  const chat = ctx.chat;
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

// --- Channel Message Forwarding ---
bot.on('channel_post', async (ctx) => {
  const chat = ctx.chat;
  if (!chat || chat.username !== SOURCE_CHANNEL) return;

  const message = ctx.channelPost;
  if (!message) return;

  try {
    await ctx.telegram.forwardMessage(TARGET_CHANNEL, chat.id, message.message_id);
    console.log(`Forwarded message ${message.message_id} from ${SOURCE_CHANNEL} to ${TARGET_CHANNEL}`);
  } catch (err: unknown) {
    console.error(`Error forwarding message from ${SOURCE_CHANNEL} to ${TARGET_CHANNEL}:`, err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `❌ Failed to forward message from ${SOURCE_CHANNEL} to ${TARGET_CHANNEL}.\nError: ${errorMessage}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// --- Vercel Export ---
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
