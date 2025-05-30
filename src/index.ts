import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';

// Initialize bot with token
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const CHANNEL_ID = '@NEETUG_26';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';

const bot = new Telegraf(BOT_TOKEN);

// Commands
const about = () => (ctx: any) => {
  ctx.reply('This bot searches for notes in @NEETUG_26. Use /search <keyword> to find messages.');
};

const greeting = () => (ctx: any) => {
  ctx.reply('Hello! Use /search <keyword> to find notes in @NEETUG_26.');
};

// Search command
bot.command('search', async (ctx) => {
  const query = ctx.message.text.split(' ').slice(1).join(' ').toLowerCase();
  if (!query) {
    return ctx.reply('Please provide a search term, e.g., /search physics notes');
  }
  try {
    ctx.reply(`Searching for "${query}" in @NEETUG_26...`);
    const messageId = 123; // Replace with actual message ID from search
    const messageLink = `https://t.me/NEETUG_26/${messageId}`;
    ctx.reply(`Found a match: ${messageLink}`);
  } catch (error) {
    console.error('Search error:', error);
    ctx.reply('An error occurred while searching. Please try again later.');
  }
});

// Register commands
bot.command('about', about());
bot.on('message', greeting());

// Webhook setup for production
if (ENVIRONMENT === 'production' && WEBHOOK_URL) {
  bot.telegram.setWebhook(`${WEBHOOK_URL}/api/bot`);
}

// Production mode (Vercel)
export default async (req: VercelRequest, res: VercelResponse) => {
  try {
    // Handle GET requests (like health checks or favicon)
    if (req.method === 'GET') {
      if (req.url === '/api/bot') {
        return res.status(200).json({
          status: 'ok',
          message: 'Telegram bot webhook is ready',
          environment: ENVIRONMENT,
        });
      }
      return res.status(200).send('Telegram bot is running');
    }

    // Check if the request is a POST with a valid body
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    if (!req.body) {
      return res.status(400).send('Bad Request: Missing body');
    }

    // Process the Telegram update
    await bot.handleUpdate(req.body);

    // Send a 200 response to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Internal Server Error');
  }
};

// Development mode
if (ENVIRONMENT !== 'production') {
  bot.launch().then(() => {
    console.log('Bot started in development mode');
  }).catch((err) => {
    console.error('Failed to start bot:', err);
  });

  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
