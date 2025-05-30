import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';

// Initialize bot with token
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const CHANNEL_ID = '@NEETUG_26';

const bot = new Telegraf(BOT_TOKEN);

// Commands (from your original code)
const about = () => (ctx: any) => {
  ctx.reply('This bot searches for notes in @NEETUG_26. Use /search <keyword> to find messages.');
};

const greeting = () => (ctx: any) => {
  ctx.reply('Hello! Use /search <keyword> to find notes in @NEETUG_26.');
};

// Search command (unchanged for brevity, but ensure it’s implemented as in the previous response)
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

// Production mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  try {
    // Log the incoming request for debugging
    console.log('Incoming request:', {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });

    // Check if the request is a POST with a valid body
    if (req.method !== 'POST') {
      console.warn('Invalid method:', req.method);
      return res.status(405).send('Method Not Allowed');
    }

    if (!req.body) {
      console.warn('Request body is undefined');
      return res.status(400).send('Bad Request: Missing body');
    }

    if (!req.body.update_id) {
      console.warn('Invalid Telegram update:', req.body);
      return res.status(400).send('Bad Request: Invalid Telegram update');
    }

    // Process the Telegram update
    await bot.handleUpdate(req.body);

    // Send a 200 response to acknowledge receipt
    res.status(200).send('OK');
  } catch (error) {
    console.error('Vercel error:', error);
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
}

// Register commands
bot.command('about', about());
bot.on('message', greeting());
