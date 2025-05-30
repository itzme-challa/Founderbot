import { Context } from 'telegraf';
import packageJson from '../../package.json'; // Import package.json directly

const about = () => (ctx: Context) => {
  const author = packageJson.author || 'EduHub Team'; // Fallback if author is not defined
  const version = packageJson.version || '1.0.0';
  const description = packageJson.description || 'A Telegram bot for educational quizzes and resources.';

  return ctx.reply(
    `*About ${packageJson.name || 'EduHub Bot'}*\n` +
    `Version: ${version}\n` +
    `Author: ${author}\n` +
    `Description: ${description}\n` +
    `Source: https://github.com/itzfew/Founderbot\n` +
    `Contact: Use /contact to reach the admin.`,
    { parse_mode: 'Markdown' }
  );
};

export { about };
