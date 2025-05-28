import { Telegraf } from 'telegraf';
import { about } from './commands';
import { greeting } from './text';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';
import { registerGroupCommands } from './commands/groupSettings'; // Import group commands

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';

const bot = new Telegraf(BOT_TOKEN);

// Register existing commands
bot.command('about', about());
bot.on('message', greeting());

// Register group admin commands
registerGroupCommands(bot);

// Prod mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

// Dev mode
if (ENVIRONMENT !== 'production') {
  development(bot);
}
