import { Telegraf } from 'telegraf';
import { about } from './commands';
import { greeting } from './text';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';
import { Context } from 'telegraf';

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const CHANNEL_ID = process.env.CHANNEL_ID || '@NEETUG_26'; // Channel to search (e.g., @NEETUG_26)

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Command: /about
bot.command('about', about());

// Greeting for non-command messages
bot.on('text', greeting());

// Search functionality for messages like "physics notes"
bot.hears(/.*/, async (ctx: Context) => {
  const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  if (!messageText) return;

  // Ignore commands
  if (messageText.startsWith('/')) return;

  try {
    // Split message into keywords (case-insensitive)
    const keywords = messageText.toLowerCase().split(/\s+/);

    // Fetch recent messages from the channel
    // Note: Telegram API doesn't provide a direct search endpoint, so we fetch recent messages
    const messages = await fetchChannelMessages(ctx, keywords);

    if (messages.length === 0) {
      await ctx.reply('No matching notes found in the channel.');
      return;
    }

    // Send up to 5 matching messages (to avoid flooding)
    for (const msg of messages.slice(0, 5)) {
      try {
        // Attempt to forward the message
        await ctx.telegram.forwardMessage(
          ctx.chat!.id,
          CHANNEL_ID,
          msg.message_id
        );
      } catch (error) {
        // If forwarding fails (e.g., due to permissions), send the message link instead
        const link = `https://t.me/${CHANNEL_ID.replace('@', '')}/${msg.message_id}`;
        await ctx.reply(`Found a match: ${link}`);
      }
    }

    if (messages.length > 5) {
      await ctx.reply(`Found ${messages.length} matches, showing the first 5.`);
    }
  } catch (error) {
    console.error('Error searching channel:', error);
    await ctx.reply('An error occurred while searching for notes. Please try again later.');
  }
});

// Function to fetch and filter channel messages
async function fetchChannelMessages(ctx: Context, keywords: string[]) {
  const messages: any[] = [];
  let lastMessageId: number | undefined;

  // Fetch messages in batches (max 100 per request, Telegram API limit)
  for (let i = 0; i < 3; i++) { // Limit to 3 batches (300 messages) to avoid rate limits
    try {
      const updates = await ctx.telegram.getChatHistory(CHANNEL_ID, {
        limit: 100,
        offset_id: lastMessageId,
      });

      if (!updates.messages.length) break;

      // Filter messages containing all keywords
      const filteredMessages = updates.messages.filter((msg: any) => {
        if (!msg.text) return false;
        const text = msg.text.toLowerCase();
        return keywords.every(keyword => text.includes(keyword));
      });

      messages.push(...filteredMessages);

      // Update lastMessageId for the next batch
      lastMessageId = updates.messages[updates.messages.length - 1].message_id;
    } catch (error) {
      console.error('Error fetching channel messages:', error);
      break;
    }
  }

  return messages;
}

// Prod mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

// Dev mode
if (ENVIRONMENT !== 'production') {
  development(bot);
}
