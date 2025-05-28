import { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';

export async function production(req: VercelRequest, res: VercelResponse, bot: Telegraf) {
  try {
    await bot.handleUpdate(req.body);
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Error in production mode:', error);
    res.status(500).json({ status: 'error', message: 'Failed to process update' });
  }
}
