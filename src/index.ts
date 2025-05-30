import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const CHANNEL_ID = '@NEETUG_26';

const bot = new Telegraf(BOT_TOKEN);

// Simulated message database (replace with actual database or API call)
const messageDatabase = [
  { id: 123, text: 'Physics notes on mechanics', keywords: ['physics', 'mechanics', 'notes'] },
  { id: 124, text: 'Chemistry organic notes', keywords: ['chemistry', 'organic', 'notes'] },
  // Add more messages as needed
];

// Commands
bot.command('about', (ctx) => {
  ctx.reply('This bot searches for notes in @NEETUG_26. Use /search <keyword> to find messages.');
});

// Search command
bot.command('search', async (ctx) => {
  const query = ctx.message.text.split(' ').slice(1).join(' ').toLowerCase();
  if (!query) {
    return ctx.reply('Please provide a search term, e.g., /search physics notes');
  }

  try {
    ctx.reply(`Searching for "${query}" in @NEETUG_26...`);

    // Simulated search in message database
    const results = messageDatabase.filter((msg) =>
      msg.keywords.some((keyword) => keyword.includes(query))
    );

    if (results.length === 0) {
      return ctx.reply('No matches found. Try a different keyword.');
    }

    // Forward the first matching message
    const messageId = results[0].id;
    await ctx.telegram.forwardMessage(
      ctx.chat.id,
      CHANNEL_ID,
      messageId
    );
    ctx.reply(`Forwarded a matching message from @NEETUG_26.`);
  } catch (error) {
    console.error('Search error:', error);
    ctx.reply('An error occurred while searching. Please try again later.');
  }
});

// Handle non-command text messages
bot.on('text', (ctx) => {
  if (!ctx.message.text.startsWith('/')) {
    ctx.reply('Hello! Use /search <keyword> to find notes in @NEETUG_26.');
  }
});

// Webhook setup for production
if (ENVIRONMENT === 'production' && WEBHOOK_URL) {
  bot.telegram.setWebhook(`${WEBHOOK_URL}/api/bot`)
    .then(() => console.log('Webhook set successfully'))
    .catch((err) => console.error('Failed to set webhook:', err));
}

// Export the Vercel handler function
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  try {
    // Handle GET requests (health checks)
    if (req.method === 'GET') {
      return res.status(200).json({
        status: 'ok',
        message: 'Telegram bot is running',
        environment: ENVIRONMENT,
      });
    }

    // Only accept POST requests
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    // Process Telegram update
    await bot.handleUpdate(req.body);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).send('Internal Server Error');
  }
};

// Development mode
if (ENVIRONMENT !== 'production') {
  bot.launch()
    .then(() => console.log('Bot started in development mode'))
    .catch((err) => console.error('Failed to start bot:', err));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
