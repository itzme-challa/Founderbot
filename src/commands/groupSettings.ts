import { Telegraf, Context } from 'telegraf';
import { ChatMember } from 'telegraf/typings/core/types/typegram';

function extractTarget(ctx: Context): { userId?: number; name?: string } | null {
  const reply = ctx.message?.reply_to_message;
  const entities = ctx.message?.entities;

  if (reply) {
    return {
      userId: reply.from.id,
      name: reply.from.username ? `@${reply.from.username}` : `${reply.from.first_name}`
    };
  }

  const mention = ctx.message?.text?.split(' ')[1];
  if (mention?.startsWith('@')) {
    // Placeholder for extracting user ID from @mention if needed
    return {
      name: mention
    };
  }

  return null;
}

export function registerGroupCommands(bot: Telegraf<Context>) {
  // Generic response for missing target
  const missingTargetMsg = "❗ I don't know who you're talking about, you're going to need to specify a user (by replying or mentioning).";

  // /ban command
  bot.command('ban', async (ctx) => {
    if (ctx.chat.type === 'private') return;

    const target = extractTarget(ctx);
    if (!target?.userId) return ctx.reply(missingTargetMsg);

    try {
      await ctx.banChatMember(target.userId);
      ctx.reply(`🚫 Banned ${target.name || 'user'} from the group.`);
    } catch (err) {
      ctx.reply('❌ Failed to ban the user. Make sure I have the necessary rights.');
    }
  });

  // /unban command
  bot.command('unban', async (ctx) => {
    if (ctx.chat.type === 'private') return;

    const target = extractTarget(ctx);
    if (!target?.userId) return ctx.reply(missingTargetMsg);

    try {
      await ctx.unbanChatMember(target.userId);
      ctx.reply(`✅ Unbanned ${target.name || 'user'}.`);
    } catch (err) {
      ctx.reply('❌ Failed to unban the user.');
    }
  });

  // /mute command
  bot.command('mute', async (ctx) => {
    if (ctx.chat.type === 'private') return;

    const target = extractTarget(ctx);
    if (!target?.userId) return ctx.reply(missingTargetMsg);

    try {
      await ctx.restrictChatMember(target.userId, {
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
        }
      });
      ctx.reply(`🔇 Muted ${target.name || 'user'}.`);
    } catch (err) {
      ctx.reply('❌ Failed to mute the user.');
    }
  });

  // /unmute command
  bot.command('unmute', async (ctx) => {
    if (ctx.chat.type === 'private') return;

    const target = extractTarget(ctx);
    if (!target?.userId) return ctx.reply(missingTargetMsg);

    try {
      await ctx.restrictChatMember(target.userId, {
        permissions: {
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        }
      });
      ctx.reply(`🔊 Unmuted ${target.name || 'user'}.`);
    } catch (err) {
      ctx.reply('❌ Failed to unmute the user.');
    }
  });

  // /kick command
  bot.command('kick', async (ctx) => {
    if (ctx.chat.type === 'private') return;

    const target = extractTarget(ctx);
    if (!target?.userId) return ctx.reply(missingTargetMsg);

    try {
      await ctx.kickChatMember(target.userId);
      ctx.reply(`👢 Kicked ${target.name || 'user'} from the group.`);
    } catch (err) {
      ctx.reply('❌ Failed to kick the user.');
    }
  });

  // /info command
  bot.command('info', async (ctx) => {
    if (ctx.chat.type === 'private') return;

    const target = extractTarget(ctx);
    if (!target?.userId) return ctx.reply(missingTargetMsg);

    try {
      const member: ChatMember = await ctx.getChatMember(target.userId);
      ctx.reply(`ℹ️ Info for ${target.name || 'user'}:
- Status: ${member.status}
- Is Admin: ${['administrator', 'creator'].includes(member.status) ? 'Yes' : 'No'}
- User ID: ${target.userId}`);
    } catch (err) {
      ctx.reply('❌ Could not fetch user info.');
    }
  });

  // /link or link command
  bot.hears(/^(\/)?link$/, async (ctx) => {
    if (ctx.chat.type === 'private') return;
    const link = `https://t.me/${ctx.chat.username || `c/${String(ctx.chat.id).slice(4)}`}`;
    ctx.reply(`🔗 Group link:\n${link}`);
  });

  // /date or today's date
  bot.hears(/^(\/)?(date|today('|’)s date)$/i, async (ctx) => {
    const now = new Date();
    const formatted = now.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    ctx.reply(`📅 Today's date is: ${formatted}`);
  });
}
