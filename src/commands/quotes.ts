import { Context } from 'telegraf';
import quotes from '../data/quotes.json';

export const quote = () => async (ctx: Context) => {
  try {
    if (!quotes || quotes.length === 0) {
      await ctx.reply('No quotes available at the moment.');
      return;
    }

    const randomIndex = Math.floor(Math.random() * quotes.length);
    const selectedQuote = quotes[randomIndex];

    await ctx.reply(`"${selectedQuote.quoteText}"\n\n– *${selectedQuote.quoteAuthor || 'Unknown'}*`, {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Failed to send quote:', error);
    await ctx.reply('❌ Error fetching quote.');
  }
};
