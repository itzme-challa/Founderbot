import { Telegraf, Context, NarrowedContext } from 'telegraf';
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
import { Message } from 'telegraf/typings/core/types/typegram'; // Import Message type

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;
const SOURCE_CHANNEL = '@pw_yakeen2_neet2026';
const TARGET_CHANNEL = '@AkashTest_Series';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://founderbot.vercel.app/';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
console.log(`Running bot in ${ENVIRONMENT} mode`);

const bot = new Telegraf(BOT_TOKEN);

// --- /support Command ---
bot.command('support', async (ctx: NarrowedContext<Context, { message: Message.TextMessage }>) => {
  if (!ctx.chat || !isPrivateChat(ctx.chat.type)) {
    return ctx.reply('Please use this command in a private chat.');
  }

  // Since we use NarrowedContext with TextMessage, ctx.message is guaranteed to be a TextMessage
  const args = ctx.message.text.split(' ').slice(1); // Safe to access text
  const amount = args[0] === '20' ? 20 : 10;
  const productId = `support_${amount}`;
  const productName = `Support Donation (${amount} INR)`;
  const telegramLink = 'https://t.me/AkashTest_Series';
  const customerName = ctx.from?.first_name || 'Unknown';
  const customerUsername = ctx.from?.username ? `@${ctx.from.username}` : 'N/A';
  const customerId = ctx.from?.id.toString();
  const customerEmail = `${customerId}@example.com`;
  const customerPhone = '9999999999';

  try {
    const response = await axios.post(`${BASE_URL}/api/createOrder`, {
      productId,
      productName,
      amount,
      telegramLink,
      customerName,
      customerEmail,
      customerPhone,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
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
  } catch (error: any) {
    console.error('Error initiating payment:', error?.response?.data || error.message);
    await ctx.reply('❌ An error occurred while processing your request. Please try again.');
  }
});

// --- Other Commands and Handlers ---
// (Keep the rest of the file as is, ensuring all imports are at the top)

// --- Vercel Export ---
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
