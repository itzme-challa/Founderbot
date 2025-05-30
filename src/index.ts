// src/index.ts
import { Telegraf, Context } from 'telegraf';
import { about } from './commands';
import { greeting } from './text';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';
import { db, ref, set, onValue, remove } from './utils/firebase';

// Initialize the bot
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';

const bot = new Telegraf(BOT_TOKEN);

// Helper function to check if a user is an admin in a chat
async function isAdmin(ctx: Context, userId: number, chatId: number | string): Promise<boolean> {
  try {
    const admins = await ctx.telegram.getChatAdministrators(chatId);
    return admins.some(admin => admin.user.id === userId);
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// Helper function to get the custom message from Firebase
function getCustomMessage(chatId: string, callback: (message: string | null) => void) {
  const messageRef = ref(db, `channels/${chatId}/customMessage`);
  onValue(messageRef, (snapshot) => {
    const message = snapshot.val();
    callback(message || null);
  }, (error) => {
    console.error('Error fetching custom message:', error);
    callback(null);
  });
}

// Command: /setmessage @channelname message
bot.command('setmessage', async (ctx) => {
  const messageText = ctx.message?.text;
  if (!messageText) return;

  const match = messageText.match(/^\/setmessage\s+@(\w+)\s+(.+)$/);
  if (!match) {
    return ctx.reply('Usage: /setmessage @channelname message');
  }

  const [, channelName, customMessage] = match;
  const channel = await ctx.telegram.getChat(`@${channelName}`).catch(() => null);
  if (!channel) {
    return ctx.reply(`Channel @${channelName} not found.`);
  }

  const chatId = channel.id.toString();
  const userId = ctx.from?.id;
  if (!userId) {
    return ctx.reply('Error: Could not identify user.');
  }

  // Check if the user is an admin
  const isUserAdmin = await isAdmin(ctx, userId, chatId);
  if (!isUserAdmin) {
    return ctx.reply('You must be an admin of the channel to set a message.');
  }

  // Check if the bot is an admin
  const botId = (await ctx.telegram.getMe()).id;
  const isBotAdmin = await isAdmin(ctx, botId, chatId);
  if (!isBotAdmin) {
    return ctx.reply('I must be an admin of the channel to set a message.');
  }

  // Save the custom message to Firebase
  try {
    await set(ref(db, `channels/${chatId}/customMessage`), customMessage);
    ctx.reply(`Custom message set for @${channelName}: "${customMessage}"`);
  } catch (error) {
    console.error('Error saving custom message:', error);
    ctx.reply('Error saving the custom message. Please try again.');
  }
});

// Command: /unsetmessage @channelname
bot.command('unsetmessage', async (ctx) => {
  const messageText = ctx.message?.text;
  if (!messageText) return;

  const match = messageText.match(/^\/unsetmessage\s+@(\w+)$/);
  if (!match) {
    return ctx.reply('Usage: /unsetmessage @channelname');
  }

  const [, channelName] = match;
  const channel = await ctx.telegram.getChat(`@${channelName}`).catch(() => null);
  if (!channel) {
    return ctx.reply(`Channel @${channelName} not found.`);
  }

  const chatId = channel.id.toString();
  const userId = ctx.from?.id;
  if (!userId) {
    return ctx.reply('Error: Could not identify user.');
  }

  // Check if the user is an admin
  const isUserAdmin = await isAdmin(ctx, userId, chatId);
  if (!isUserAdmin) {
    return ctx.reply('You must be an admin of the channel to unset the message.');
  }

  // Remove the custom message from Firebase
  try {
    await remove(ref(db, `channels/${chatId}/customMessage`));
    ctx.reply(`Custom message unset for @${channelName}.`);
  } catch (error) {
    console.error('Error unsetting custom message:', error);
    ctx.reply('Error unsetting the custom message. Please try again.');
  }
});

// Handle all messages in channels
bot.on('message', async (ctx) => {
  const chatId = ctx.chat?.id.toString();
  const message = ctx.message;
  if (!chatId || !message || !('text' in message)) {
    return greeting()(ctx); // Fallback to greeting for non-text messages
  }

  // Check if the message is in a channel and if a custom message exists
  getCustomMessage(chatId, async (customMessage) => {
    if (customMessage) {
      const botId = (await ctx.telegram.getMe()).id;
      const isBotAdmin = await isAdmin(ctx, botId, chatId);
      if (isBotAdmin) {
        // Edit the message to append the custom message
        try {
          const newText = `${message.text}\n\n${customMessage}`;
          await ctx.telegram.editMessageText(chatId, message.message_id, undefined, newText).catch(async () => {
            // If editing fails (e.g., message not sent by bot), send a new message
            await ctx.telegram.sendMessage(chatId, newText);
          });
        } catch (error) {
          console.error('Error editing message:', error);
        }
      }
    } else {
      // If no custom message, fallback to greeting
      greeting()(ctx);
    }
  });
});

// Existing command
bot.command('about', about());

// Production mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

// Development mode
if (ENVIRONMENT !== 'production') {
  development(bot);
}
