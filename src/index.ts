import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';

// Initialize bot with token
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const CHANNEL_ID = '@NEETUG_26'; // Target channel

const bot = new Telegraf(BOT_TOKEN);

// Commands
const about = () => (ctx: any) => {
  ctx.reply('This bot searches for notes in @NEETUG_26. Use /search <keyword> to find messages.');
};

const greeting = () => (ctx: any) => {
  ctx.reply('Hello! Use /search <keyword> to find notes in @NEETUG_26.');
};

// Search command to find messages in the channel
bot.command('search', async (ctx) => {
  const query = ctx.message.text.split(' ').slice(1).join(' ').toLowerCase();
  if (!query) {
    return ctx.reply('Please provide a search term, e.g., /search physics notes');
  }

  try {
    // Search for messages in the channel
    let found = false;
    // Note: Telegram Bot API doesn't provide a direct search method, so we simulate it
    // This is a simplified approach; for real search, you'd need to store messages or use a third-party service
    // Here, we'll assume you have a way to fetch recent messages (e.g., via a database or by polling)

    // Placeholder: Iterate over recent messages (requires storing messages or using a chat history API)
    // For demonstration, we'll reply with a sample response
    // In practice, you'd need to fetch messages from @NEETUG_26
    ctx.reply(`Searching for "${query}" in @NEETUG_26...`);

    // Example: Simulate finding a message
    const messageId = 123; // Replace with actual message ID from search
    const messageLink = `https://t.me/NEETUG_26/${messageId}`;
    
    // Option 1: Send the message link
    ctx.reply(`Found a match: ${messageLink}`);

    // Option 2: Forward the message (uncomment to use)
    // await ctx.telegram.forwardMessage(ctx.chat.id, CHANNEL_ID, messageId);

    found = true;

    if (!found) {
      ctx.reply(`No messages found for "${query}" in @NEETUG_26.`);
    }
  } catch (error) {
    console.error('Search error:', error);
    ctx.reply('An error occurred while searching. Please try again later.');
  }
});

// Production mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Vercel error:', error);
    res.status(500).send('Error');
  }
};

// Development mode
if (ENVIRONMENT !== 'production') {
  bot.launch().then(() => {
    console.log('Bot started in development mode');
  }).catch((err) => {
    console.error('Failed to start bot:', err);
  });
}

// Register commands
bot.command('about', about());
bot.on('message', greeting());
