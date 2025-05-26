import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { saveToSheet } from './utils/saveToSheet';
import { fetchChatIdsFromSheet } from './utils/chatStore';
import { about } from './commands/about';
import { help, handleHelpPagination, groupHelp } from './commands/help';
import { pdf } from './commands/pdf';
import { greeting } from './text/greeting';
import { production, development } from './core';
import { isPrivateChat, isGroupChat } from './utils/groupSettings';
import { setupBroadcast } from './commands/broadcast';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
console.log(`Running bot in ${ENVIRONMENT} mode`);

const bot = new Telegraf(BOT_TOKEN);

// --- Commands ---
bot.command('about', about());

// Multiple triggers for help/material/pdf content
const helpTriggers = ['help', 'study', 'material', 'pdf', 'pdfs'];
helpTriggers.forEach(trigger => bot.command(trigger, help()));
bot.hears(/^(help|study|material|pdf|pdfs)$/i, help());

// Admin: /users
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

// --- Group Admin Commands ---
bot.command('all', async (ctx) => {
  if (!isGroupChat(ctx.chat?.type)) return;
  
  try {
    // Check if user is admin
    const member = await ctx.getChatMember(ctx.from.id);
    if (!['administrator', 'creator'].includes(member.status)) {
      return ctx.reply('Only admins can use this command.');
    }

    const message = ctx.message.text.replace('/all', '').trim();
    if (!message) return ctx.reply('Please provide a message after /all');

    // Get all chat members
    const members = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const chunk = await ctx.getChatAdministrators({ limit: 100, offset });
      members.push(...chunk);
      offset += 100;
      hasMore = chunk.length === 100;
    }

    // Filter out bots and send mentions in chunks
    const users = members
      .filter(m => !m.user.is_bot && m.user.username)
      .map(m => `@${m.user.username}`);

    // Send mentions in batches of 5 to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      await ctx.reply(`${message}\n${batch.join(' ')}`, {
        disable_notification: true
      });
      // Delay to avoid rate limiting
      if (i + batchSize < users.length) await new Promise(r => setTimeout(r, 1000));
    }

  } catch (err) {
    console.error('Error in /all command:', err);
    await ctx.reply('❌ Error processing your request.');
  }
});

// Group help command
bot.command('ghelp', async (ctx) => {
  if (!isGroupChat(ctx.chat?.type)) return;
  
  const isAdmin = ['administrator', 'creator'].includes(
    (await ctx.getChatMember(ctx.from.id)).status
  );

  await groupHelp(isAdmin)(ctx);
});

// Group info command
bot.command('ginfo', async (ctx) => {
  if (!isGroupChat(ctx.chat?.type)) return;

  try {
    const chat = await ctx.getChat();
    const admins = await ctx.getChatAdministrators();
    
    let adminList = admins
      .filter(a => !a.user.is_bot)
      .map(a => a.user.username ? `@${a.user.username}` : a.user.first_name)
      .join('\n');

    await ctx.replyWithMarkdown(
      `*Group Info*\n\n` +
      `*Title:* ${chat.title}\n` +
      `*Members:* ${chat.members_count}\n` +
      `*Admins (${admins.length - 1}):*\n${adminList}`
    );
  } catch (err) {
    console.error('Error in /ginfo:', err);
    await ctx.reply('❌ Could not fetch group info.');
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
  if (!ctx.chat) return;

  if (isPrivateChat(ctx.chat.type)) {
    const text = ctx.message.text?.toLowerCase();
    if (['help', 'study', 'material', 'pdf', 'pdfs'].includes(text)) {
      await help()(ctx);
    } else {
      await greeting()(ctx);
      await pdf()(ctx);
    }
  }
});

// --- New Member Welcome (Group) ---
bot.on('new_chat_members', async (ctx) => {
  for (const member of ctx.message.new_chat_members) {
    if (member.username === ctx.botInfo.username) {
      await ctx.reply(
        'Thanks for adding me to the group! Here are things I can do:\n\n' +
        '• /ghelp - Show group commands\n' +
        '• /ginfo - Show group information\n' +
        'Admins can use /all to mention everyone'
      );
    } else {
      // Welcome new members
      await ctx.replyWithMarkdown(
        `Welcome [${member.first_name}](tg://user?id=${member.id}) to the group! ` +
        `Type /help to see what I can do.`
      );
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

// --- Channel Post Forwarding (without "forwarded from") ---
bot.on('channel_post', async (ctx) => {
  const sourceChannel = ctx.channelPost?.chat?.username;
  const targetChannel = '@AkashTest_Series';

  if (sourceChannel?.toLowerCase() === 'akashaiats2026') {
    try {
      // Instead of forwarding, create a new message with the same content
      const post = ctx.channelPost;
      let caption = post.caption || '';
      
      if (post.photo) {
        await ctx.telegram.sendPhoto(
          targetChannel,
          post.photo[post.photo.length - 1].file_id,
          { caption }
        );
      } else if (post.video) {
        await ctx.telegram.sendVideo(
          targetChannel,
          post.video.file_id,
          { caption }
        );
      } else if (post.document) {
        await ctx.telegram.sendDocument(
          targetChannel,
          post.document.file_id,
          { caption }
        );
      } else if (post.text) {
        await ctx.telegram.sendMessage(
          targetChannel,
          post.text
        );
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
