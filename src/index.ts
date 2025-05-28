import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { saveToSheet } from './utils/saveToSheet';
import { fetchChatIdsFromSheet } from './utils/chatStore';
import { about } from './commands/about';
import { help, handleHelpPagination } from './commands/help';
import { pdf } from './commands/pdf';
import { greeting } from './text/greeting';
import { production, development } from './core';
import { isPrivateChat } from './utils/groupSettings';
import { setupBroadcast } from './commands/broadcast';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
console.log(`Running bot in ${ENVIRONMENT} mode`);

const bot = new Telegraf(BOT_TOKEN);

// --- Utility Functions ---
async function isAdmin(ctx: Context, userId: number): Promise<boolean> {
  if (userId === ADMIN_ID) return true;
  if (!ctx.chat || isPrivateChat(ctx.chat.type)) return false;

  try {
    const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
    return admins.some(admin => admin.user.id === userId);
  } catch (err) {
    console.error('Error checking admin status:', err);
    return false;
  }
}

async function getGroupMembers(ctx: Context): Promise<any[]> {
  if (!ctx.chat || isPrivateChat(ctx.chat.type)) return [];
  try {
    const members = await ctx.telegram.getChatMembersCount(ctx.chat.id);
    // Note: Telegram API doesn't provide a direct way to get all members.
    // This is a placeholder; you'll need a database or custom logic to track members.
    // For now, we'll simulate by fetching recent message senders or use a stored list.
    return []; // Replace with actual member fetching logic.
  } catch (err) {
    console.error('Error fetching group members:', err);
    return [];
  }
}

// --- Commands: General ---
bot.command('about', about());

const helpTriggers = ['help', 'study', 'material', 'pdf', 'pdfs'];
helpTriggers.forEach(trigger => bot.command(trigger, async (ctx) => {
  if (ctx.chat && !isPrivateChat(ctx.chat.type)) {
    // Group-specific help
    const isUserAdmin = await isAdmin(ctx, ctx.from?.id || 0);
    await ctx.reply(
      `*Group Commands:*\n` +
      `/help - Show this help message\n` +
      `/about - About the bot\n` +
      (isUserAdmin ? 
        `*Admin Commands:*\n` +
        `/all [message] - Mention all group members with a message\n` +
        `/warn [user] [reason] - Warn a user\n` +
        `/mute [user] [duration] - Mute a user (e.g., 1h, 1d)\n` +
        `/ban [user] [reason] - Ban a user\n` +
        `/users - Show total bot users (global admin only)`
        : ''),
      { parse_mode: 'Markdown' }
    );
  } else {
    // Private chat help
    await help()(ctx);
  }
}));
bot.hears(/^(help|study|material|pdf|pdfs)$/i, help());

// --- Commands: Admin (Global) ---
bot.command('users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.reply('You are not authorized.');

  try {
    const chatIds = await fetchChatIdsFromSheet();
    await ctx.reply(`📊 Total users: ${chatIds.length}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
      },
    });
  } catch (err) {
    console.error('Error fetching user count:', err);
    await ctx.reply('❌ Unable to fetch user count.');
  }
});

// Admin: /broadcast
setupBroadcast(bot);

// --- Commands: Group Admin ---
bot.command('all', async (ctx) => {
  if (!ctx.chat || isPrivateChat(ctx.chat.type)) {
    return ctx.reply('This command is only available in groups.');
  }

  if (!(await isAdmin(ctx, ctx.from?.id || 0))) {
    return ctx.reply('You are not authorized to use this command.');
  }

  const message = ctx.message?.text?.split(' ').slice(1).join(' ') || 'Hello!';
  const members = await getGroupMembers(ctx);
  if (members.length === 0) {
    return ctx.reply('No members found or unable to fetch members.');
  }

  const chunkSize = 5; // Number of mentions per message to avoid Telegram limits
  const chunks: string[] = [];
  let currentChunk = '';

  for (const member of members) {
    const mention = member.username ? `[${member.first_name}](tg://user?id=${member.id})` : member.first_name;
    const line = `${mention}: ${message}\n`;
    if ((currentChunk + line).length > 4000) { // Telegram message length limit
      chunks.push(currentChunk);
      currentChunk = '';
    }
    currentChunk += line;
  }
  if (currentChunk) chunks.push(currentChunk);

  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: 'Markdown' });
    await new Promise(resolve => setTimeout(resolve, 1000)); // Avoid rate limits
  }
});

bot.command('warn', async (ctx) => {
  if (!ctx.chat || isPrivateChat(ctx.chat.type)) return;
  if (!(await isAdmin(ctx, ctx.from?.id || 0))) {
    return ctx.reply('You are not authorized.');
  }

  const args = ctx.message?.text?.split(' ').slice(1) || [];
  const targetUser = ctx.message?.reply_to_message?.from || (args[0]?.startsWith('@') ? { username: args[0] } : null);
  const reason = args.slice(1).join(' ') || 'No reason provided';

  if (!targetUser) {
    return ctx.reply('Please reply to a user or provide a username.');
  }

  await ctx.reply(
    `${targetUser.username || targetUser.first_name}, you have been warned: ${reason}`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('mute', async (ctx) => {
  if (!ctx.chat || isPrivateChat(ctx.chat.type)) return;
  if (!(await isAdmin(ctx, ctx.from?.id || 0))) {
    return ctx.reply('You are not authorized.');
  }

  const args = ctx.message?.text?.split(' ').slice(1) || [];
  const targetUser = ctx.message?.reply_to_message?.from || (args[0]?.startsWith('@') ? { username: args[0] } : null);
  const duration = args[1] || '1h';

  if (!targetUser) {
    return ctx.reply('Please reply to a user or provide a username.');
  }

  // Parse duration (e.g., 1h, 1d)
  const durationSeconds = duration.match(/(\d+)([hdm])/i)?.[1] 
    ? parseInt(duration.match(/(\d+)([hdm])/i)![1]) * { h: 3600, d: 86400, m: 60 }[duration.match(/(\d+)([hdm])/i)![2].toLowerCase()]
    : 3600; // Default to 1 hour

  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, targetUser.id, {
      until_date: Math.floor(Date.now() / 1000) + durationSeconds,
      permissions: { can_send_messages: false },
    });
    await ctx.reply(
      `${targetUser.username || targetUser.first_name} has been muted for ${duration}.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Error muting user:', err);
    await ctx.reply('Failed to mute user.');
  }
});

bot.command('ban', async (ctx) => {
  if (!ctx.chat || isPrivateChat(ctx.chat.type)) return;
  if (!(await isAdmin(ctx, ctx.from?.id || 0))) {
    return ctx.reply('You are not authorized.');
  }

  const args = ctx.message?.text?.split(' ').slice(1) || [];
  const targetUser = ctx.message?.reply_to_message?.from || (args[0]?.startsWith('@') ? { username: args[0] } : null);
  const reason = args.slice(1).join(' ') || 'No reason provided';

  if (!targetUser) {
    return ctx.reply('Please reply to a user or provide a username.');
  }

  try {
    await ctx.telegram.banChatMember(ctx.chat.id, targetUser.id);
    await ctx.reply(
      `${targetUser.username || targetUser.first_name} has been banned: ${reason}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Error banning user:', err);
    await ctx.reply('Failed to ban user.');
  }
});

// --- Callback Handler ---
bot.on('callback_query', async (ctx) => {
  const callback = ctx.callbackQuery;
  if ('data' in callback) {
    const data = callback.data;

    if (data.startsWith('help_page_')) {
      await handleHelpPagination()(ctx);
    } else if (data === 'refresh_users' && ctx.from?.id === ADMIN_ID) {
      try {
        const chatIds = await fetchChatIdsFromSheet();
        await ctx.editMessageText(`📊 Total users: ${chatIds.length}`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
          },
        });
      } catch (err) {
        console.error('Error refreshing users:', err);
        await ctx.answerCbQuery('Failed to refresh.');
      }
    } else {
      await ctx.answerCbQuery('Unknown action');
    }
  } else {
    await ctx.answerCbQuery('Unsupported callback type');
  }
});

// --- /start ---
bot.start(async (ctx) => {
  if (!ctx.chat || !isPrivateChat(ctx.chat.type)) return;

  const user = ctx.from;
  const chat = ctx.chat;

  await greeting()(ctx);
  await pdf()(ctx);

  const alreadyNotified = await saveToSheet(chat);
  console.log(`Saved chat ID: ${chat.id} (${chat.type})`);

  if (chat.id !== ADMIN_ID && !alreadyNotified) {
    const name = user?.first_name || 'Unknown';
    const username = user?.username ? `@${user.username}` : 'N/A';
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `*New user started the bot!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Type:* ${chat.type}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// --- Text Handler ---
bot.on('text', async (ctx) => {
  if (!ctx.chat || !isPrivateChat(ctx.chat.type)) return;

  const text = ctx.message.text?.toLowerCase();
  if (['help', 'study', 'material', 'pdf', 'pdfs'].includes(text)) {
    await help()(ctx);
  } else {
    await greeting()(ctx);
    await pdf()(ctx);
  }
});

// --- New Member Welcome (Group) ---
bot.on('new_chat_members', async (ctx) => {
  for (const member of ctx.message.new_chat_members) {
    if (member.username === ctx.botInfo.username) {
      await ctx.reply('Thanks for adding me! Type /help to get started.');
    }
  }
});

// --- Message Tracker for Private Chats ---
bot.on('message', async (ctx) => {
  const chat = ctx.chat;
  if (!chat?.id || !isPrivateChat(chat.type)) return;

  const alreadyNotified = await saveToSheet(chat);
  console.log(`Saved chat ID: ${chat.id} (${chat.type})`);

  if (chat.id !== ADMIN_ID && !alreadyNotified) {
    const user = ctx.from;
    const name = user?.first_name || 'Unknown';
    const username = user?.username ? `@${user.username}` : 'N/A';
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `*New user interacted!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Type:* ${chat.type}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// --- Channel Post Copying (No Forwarded Link) ---
bot.on('channel_post', async (ctx) => {
  const sourceChannel = ctx.channelPost?.chat?.username?.toLowerCase();
  const targetChannel = '@AkashTest_Series';

  if (sourceChannel === 'akashaiats2026') {
    try {
      const post = ctx.channelPost;
      if (post.text) {
        await ctx.telegram.sendMessage(targetChannel, post.text, { parse_mode: 'Markdown' });
      } else if (post.photo) {
        const photo = post.photo[post.photo.length - 1]; // Get highest resolution
        await ctx.telegram.sendPhoto(targetChannel, photo.file_id, {
          caption: post.caption || '',
          parse_mode: 'Markdown',
        });
      } else if (post.document) {
        await ctx.telegram.sendDocument(targetChannel, post.document.file_id, {
          caption: post.caption || '',
          parse_mode: 'Markdown',
        });
      }
      console.log(`Copied message from @${sourceChannel} to ${targetChannel}`);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  }
});

// --- Vercel Export ---
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
