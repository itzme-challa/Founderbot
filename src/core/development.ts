import { Telegraf } from 'telegraf';

export async function development(bot: Telegraf) {
  try {
    await bot.launch();
    console.log('Bot started in development mode (polling)');
  } catch (error) {
    console.error('Error in development mode:', error);
  }
}
