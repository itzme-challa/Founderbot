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

// --- Group Commands ---
const isAdmin = async (ctx: Context, userId: number) => {
  if (userId === ADMIN_ID) return true;
  const admins = await ctx.getChatAdministrators();
  return admins.some(admin => admin.user.id === userId);
};

// Group: /help (for group-specific commands)
bot.command('help', async (ctx) => {
  if (isPrivateChat(ctx.chat?.type)) {
    await help()(ctx);
    return;
  }

  const isGroupAdmin = await isAdmin(ctx, ctx.from?.id || 0);
  const commands = isGroupAdmin
    ? `
*Group Admin Commands:*
/all [message] - Mention all group members one by one with the provided message (sent in batches).
/mute [user_id] - Mute a user in the group (requires user ID).
/unmute [user_id] - Unmute a user in the group (requires user ID).
/kick [user_id] - Kick a user from the group (requires user ID).
/announce [message] - Send an announcement to the group (pinned).
/groupstats - Show group member count and basic stats.
/help - Show this help menu.
`
    : `
*Group Commands (Non-Admins):*
/about - Learn about the bot.
/groupstats - Show group member count and basic stats.
/help - Show this help menu.
`;

  await ctx.reply(commands, { parse_mode: 'Markdown' });
});

// Group: /all [message] - Mention all members one by one
bot.command('all', async (ctx) => {
  if (isPrivateChat(ctx.chat?.type)) return ctx.reply('This command is only for groups.');
  if (!(await isAdmin(ctx, ctx.from?.id || 0))) return ctx.reply('Only admins can use this command.');

  const message = ctx.message?.text?.replace(/^\/all\s*/, '') || 'Hey there!';
  try {
    const members = await ctx.getChatMembers();
    const memberChunks = chunkArray(members.filter(m => !m.user.is_bot), 5); // Exclude bots, chunk into groups of 5

    for (const chunk of memberChunks) {
      const mentionText = chunk
        .map(member => {
          const username = member.user.username
            ? `@${member.user.username}`
            : `[${member.user.first_name}](tg://user?id=${member.user.id})`;
          return `${username}: ${message}`;
        })
        .join('\n');
      await ctx.reply(mentionText, { parse_mode: 'Markdown' });
      await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid rate limits
    }
  } catch (err) {
    console.error('Error mentioning members:', err);
    await ctx.reply('❌ Failed to mention members.');
  }
});

// Group: /mute [user_id]
bot.command('mute', async (ctx) => {
  if (isPrivateChat(ctx.chat?.type)) return ctx.reply('This command is only for groups.');
  if (!(await isAdmin(ctx, ctx.from?.id || 0))) return ctx.reply('Only admins can use this command.');

  const userId = ctx.message?.text?.split(' ')[1];
  if (!userId) return ctx.reply('Please provide a user ID. Usage: /mute [user_id]');

  try {
    await ctx.restrictChatMember(parseInt(userId), {
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
    });
    await ctx.reply(`User ${userId} has been muted.`);
  } catch (err) {
    console.error('Error muting user:', err);
    await ctx.reply('❌ Failed to mute user.');
  }
});

// Group: /unmute [user_id]
bot.command('unmute', async (ctx) => {
  if (isPrivateChat(ctx.chat?.type)) return ctx.reply('This command is only for groups.');
  if (!(await isAdmin(ctx, ctx.from?.id || 0))) return ctx.reply('Only admins can use this command.');

  const userId = ctx.message?.text?.split(' ')[1];
  if (!userId) return ctx.reply('Please provide a user ID. Usage: /unmute [user_id]');

  try {
    await ctx.restrictChatMember(parseInt(userId), {
      can_send_messages: true,
      can_send_media_messages: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    });
    await ctx.reply(`User ${userId} has been unmuted.`);
  } catch (err) {
    console.error('Error unmuting user:', err);
    await ctx.reply('❌ Failed to unmute user.');
  }
});

// Group: /kick [user_id]
bot.command('kick', async (ctx) => {
  if (isPrivateChat(ctx.chat?.type)) return ctx.reply('This command is only for groups.');
  if (!(await isAdmin(ctx, ctx.from?.id || 0))) return ctx.reply('Only admins can use this command.');

  const userId = ctx.message?.text?.split(' ')[1];
  if (!userId) return ctx.reply('Please provide a user ID. Usage: /kick [user_id]');

  try {
    await ctx.banChatMember(parseInt(userId));
    await ctx.reply(`User ${userId} has been kicked.`);
  } catch (err) {
    console.error('Error kicking user:', err);
    await ctx.reply('❌ Failed to kick user.');
  }
});

// Group: /announce [message]
bot.command('announce', async (ctx) => {
  if (isPrivateChat(ctx.chat?.type)) return ctx.reply('This command is only for groups.');
  if (!(await isAdmin(ctx, ctx.from?.id || 0))) return ctx.reply('Only admins can use this command.');

  const message = ctx.message?.text?.replace(/^\/announce\s*/, '');
  if (!message) return ctx.reply('Please provide a message. Usage: /announce [message]');

  try {
    const sentMessage = await ctx.reply(`📢 *Announcement:* ${message}`, { parse_mode: 'Markdown' });
    await ctx.pinChatMessage(sentMessage.message_id);
  } catch (err) {
    console.error('Error sending announcement:', err);
    await ctx.reply('❌ Failed to send announcement.');
  }
});

// Group: /groupstats
bot.command('groupstats', async (ctx) => {
  if (isPrivateChat(ctx.chat?.type)) return ctx.reply('This command is only for groups.');

  try {
    const memberCount = await ctx.getChatMembersCount();
    const chat = await ctx.getChat();
    const title = chat.title || 'Unnamed Group';
    await ctx.reply(`📊 *Group Stats:*\n\n*Name:* ${title}\n*Total Members:* ${memberCount}`, {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('Error fetching group stats:', err);
    await ctx.reply('❌ Failed to fetch group stats.');
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

// --- Channel Post Forwarding (Without Forwarded Link) ---
bot.on('channel_post', async (ctx) => {
  const sourceChannel = ctx.channelPost?.chat?.username?.toLowerCase();
  const targetChannel = '@AkashTest_Series';

  if (sourceChannel === 'akashaiats2026') {
    try {
      const post = ctx.channelPost;
      let content = '';

      if (post.text) {
        content = post.text;
      } else if (post.caption) {
        content = post.caption;
      }

      // Send as a new message instead of forwarding
      await ctx.telegram.sendMessage(targetChannel, content, {
        parse_mode: post.text ? 'Markdown' : undefined,
      });
      console.log(`Sent message from @${sourceChannel} to ${targetChannel}`);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  }
});

// --- Utility Function to Chunk Arrays ---
function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// --- Vercel Export ---
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
