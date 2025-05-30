import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const CHANNEL_ID = '@NEETUG_26';

const bot = new Telegraf(BOT_TOKEN);

// Simulated message database (replace with actual database or API call)
const messageDatabase = [
  { id: 123, text: 'Physics notes on mechanics', keywords: ['physics', 'mechanics', 'notes', 'message'] },
  { id: 124, text: 'Chemistry organic notes', keywords: ['chemistry', 'organic', 'notes', 'message'] },
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

    // Search in message database (text and keywords)
    const results = messageDatabase.filter(
      (msg) =>
        msg.text.toLowerCase().includes(query) ||
        msg.keywords.some((keyword) => keyword.toLowerCase().includes(query))
    );

    if (results.length === 0) {
      // Fallback: Try fetching recent channel messages (limited by Telegram API)
      try {
        const chat = await ctx.telegram.getChat(CHANNEL_ID);
        const messages = await ctx.telegram.getChat(CHANNEL_ID); // Note: Telegram API doesn't provide direct message fetch
        ctx.reply('No matches found in database. Real-time channel search is limited. Try a different keyword.');
        return;
      } catch (fetchError) {
        console.error('Channel fetch error:', fetchError);
        ctx.reply('No matches found. Try a different keyword.');
        return;
      }
    }

    // Forward the first matching message
    const messageId = results[0].id;
    try {
      await ctx.telegram.forwardMessage(ctx.chat.id, CHANNEL_ID, messageId);
      ctx.reply(`Forwarded a matching message from @NEETUG_26.`);
    } catch (forwardError) {
      console.error('Forward error:', forwardError);
      const messageLink = `https://t.me/NEETUG_26/${messageId}`;
      ctx.reply(`Could not forward message. View it here: ${messageLink}`);
    }
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

// Capture new channel messages to update database (requires admin privileges)
bot.on('channel_post', (ctx) => {
  const message = ctx.channelPost;
  if (message.chat.id.toString() === CHANNEL_ID || message.chat.username === CHANNEL_ID) {
    const messageId = message.message_id;
    const text = message.text || '';
    const keywords = text.toLowerCase().split(' ').filter((word) => word.length > 3); // Simple keyword extraction
    messageDatabase.push({ id: messageId, text, keywords });
    console.log(`Added message ${messageId} to database: ${text}`);
  }
});

// Webhook setup for production
if (ENVIRONMENT === 'production' && WEBHOOK_URL) {
  bot.telegram
    .setWebhook(`${WEBHOOK_URL}/api/bot`)
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
