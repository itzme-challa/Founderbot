import { Context, Telegraf } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';

// Helper function to check if the user is an admin
async function isAdmin(ctx: Context): Promise<boolean> {
  const chat = ctx.chat;
  const user = ctx.from;
  if (!chat || !user) return false;

  try {
    const member = await ctx.telegram.getChatMember(chat.id, user.id);
    return ['administrator', 'creator'].includes(member.status);
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// Command to kick a user from the group
export function kick() {
  return async (ctx: Context) => {
    if (!(await isAdmin(ctx))) {
      return ctx.reply('You must be an admin to use this command.');
    }

    const replyTo = ctx.message?.['reply_to_message'];
    if (!replyTo || !replyTo.from) {
      return ctx.reply('Please reply to a user’s message to kick them.');
    }

    try {
      await ctx.telegram.kickChatMember(ctx.chat!.id, replyTo.from.id);
      await ctx.reply(`${replyTo.from.first_name} has been kicked from the group.`);
    } catch (error) {
      console.error('Error kicking user:', error);
      await ctx.reply('Failed to kick the user. Ensure I have the necessary permissions.');
    }
  };
}

// Command to ban a user from the group
export function ban() {
  return async (ctx: Context) => {
    if (!(await isAdmin(ctx))) {
      return ctx.reply('You must be an admin to use this command.');
    }

    const replyTo = ctx.message?.['reply_to_message'];
    if (!replyTo || !replyTo.from) {
      return ctx.reply('Please reply to a user’s message to ban them.');
    }

    try {
      await ctx.telegram.banChatMember(ctx.chat!.id, replyTo.from.id);
      await ctx.reply(`${replyTo.from.first_name} has been banned from the group.`);
    } catch (error) {
      console.error('Error banning user:', error);
      await ctx.reply('Failed to ban the user. Ensure I have the necessary permissions.');
    }
  };
}

// Command to mute a user (restrict sending messages)
export function mute() {
  return async (ctx: Context) => {
    if (!(await isAdmin(ctx))) {
      return ctx.reply('You must be an admin to use this command.');
    }

    const replyTo = ctx.message?.['reply_to_message'];
    if (!replyTo || !replyTo.from) {
      return ctx.reply('Please reply to a user’s message to mute them.');
    }

    try {
      await ctx.telegram.restrictChatMember(ctx.chat!.id, replyTo.from.id, {
        permissions: { can_send_messages: false },
      });
      await ctx.reply(`${replyTo.from.first_name} has been muted.`);
    } catch (error) {
      console.error('Error muting user:', error);
      await ctx.reply('Failed to mute the user. Ensure I have the necessary permissions.');
    }
  };
}

// Command to unmute a user
export function unmute() {
  return async (ctx: Context) => {
    if (!(await isAdmin(ctx))) {
      return ctx.reply('You must be an admin to use this command.');
    }

    const replyTo = ctx.message?.['reply_to_message'];
    if (!replyTo || !replyTo.from) {
      return ctx.reply('Please reply to a user’s message to unmute them.');
    }

    try {
      await ctx.telegram.restrictChatMember(ctx.chat!.id, replyTo.from.id, {
        permissions: {
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
        },
      });
      await ctx.reply(`${replyTo.from.first_name} has been unmuted.`);
    } catch (error) {
      console.error('Error unmuting user:', error);
      await ctx.reply('Failed to unmute the user. Ensure I have the necessary permissions.');
    }
  };
}

// Command to promote a user to admin
export function promote() {
  return async (ctx: Context) => {
    if (!(await isAdmin(ctx))) {
      return ctx.reply('You must be an admin to use this command.');
    }

    const replyTo = ctx.message?.['reply_to_message'];
    if (!replyTo || !replyTo.from) {
      return ctx.reply('Please reply to a user’s message to promote them.');
    }

    try {
      await ctx.telegram.promoteChatMember(ctx.chat!.id, replyTo.from.id, {
        can_manage_chat: true,
        can_delete_messages: true,
        can_restrict_members: true,
        can_promote_members: false, // Prevent promoting others to avoid escalation
      });
      await ctx.reply(`${replyTo.from.first_name} has been promoted to admin.`);
    } catch (error) {
      console.error('Error promoting user:', error);
      await ctx.reply('Failed to promote the user. Ensure I have the necessary permissions.');
    }
  };
}

// Command to set group description
export function setDescription() {
  return async (ctx: Context) => {
    if (!(await isAdmin(ctx))) {
      return ctx.reply('You must be an admin to use this command.');
    }

    const text = ctx.message?.['text']?.split(' ').slice(1).join(' ');
    if (!text) {
      return ctx.reply('Please provide a description. Usage: /setdescription <text>');
    }

    try {
      await ctx.telegram.setChatDescription(ctx.chat!.id, text);
      await ctx.reply('Group description updated.');
    } catch (error) {
      console.error('Error setting description:', error);
      await ctx.reply('Failed to set group description. Ensure I have the necessary permissions.');
    }
  };
}

// Register all group admin commands
export function registerGroupCommands(bot: Telegraf<Context<Update>>) {
  bot.command('kick', kick());
  bot.command('ban', ban());
  bot.command('mute', mute());
  bot.command('unmute', unmute());
  bot.command('promote', promote());
  bot.command('setdescription', setDescription());
}
