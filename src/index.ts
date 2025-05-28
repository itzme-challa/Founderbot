const { Telegraf } = require('telegraf');
require('dotenv').config();

// Initialize the bot with the token from environment variables
const bot = new Telegraf(process.env.BOT_TOKEN);

// Handle /start command
bot.start((ctx) => {
  ctx.reply('Welcome to the bot! Type /help to see what I can do.');
});

// Handle /help command
bot.help((ctx) => {
  ctx.reply('I’m a simple bot! Send me any message, and I’ll echo it back. Use /start to greet me or /help to see this message.');
});

// Echo back any text message
bot.on('text', (ctx) => {
  ctx.reply(`You said: ${ctx.message.text}`);
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
});

// Vercel serverless function handler
module.exports = async (req, res) => {
  try {
    // Set webhook for Telegram
    if (req.method === 'GET') {
      const webhookUrl = `https://${req.headers.host}/`;
      await bot.telegram.setWebhook(webhookUrl);
      return res.status(200).json({ status: 'Webhook set', url: webhookUrl });
    }

    // Handle Telegram updates
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      return res.status(200).json({ status: 'ok' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in handler:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
