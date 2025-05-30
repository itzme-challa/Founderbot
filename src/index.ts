import { Telegraf, Context } from 'telegraf';
import { about } from './commands';
import { greeting } from './text';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';
import { db, ref, set, onValue, remove, DataSnapshot, DatabaseError } from './utils/firebase';

// Initialize the bot
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';

const bot = new Telegraf(BOT_TOKEN);

// Helper function to check if a user is an admin in a chat
async function isAdmin(ctx: Context, userId: number, chatId: number | string): Promise<boolean> {
  try {
    const admins = await ctx.telegram.getChatAdministrators(chatId);
    return admins.some(admin => admin.user.id === userId);
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

// Helper function to get the custom message from Firebase
function getCustomMessage(chatId: string, callback: (message: string | null) => void) {
  const messageRef = ref(db, `channels/${chatId}/customMessage`);
  onValue(
    messageRef,
    (snapshot: DataSnapshot) => {
      const message = snapshot.val();
      callback(message || null);
    },
    (error: DatabaseError) => {
      console.error('Error fetching custom message:', error);
      callback(null);
    }
  );
}

// Command: /setmessage @channelname message
bot.command('setmessage', async (ctx) => {
  const messageText = ctx.message?.text;
  if (!messageText) return;

  const match = messageText.match(/^\/setmessage\s+@(\w+)\s+(.+)$/);
  if (!match) {
    return ctx.reply('Usage: /setmessage @channelname message');
  }

  const [, channelName, customMessage] = match;
  const channel = await ctx.telegram.getChat(`@${channelName}`).catch(() => null);
  if (!channel) {
    return ctx.reply(`Channel @${channelName} not found.`);
  }

  const chatId = channel.id.toString();
  const userId = ctx.from?.id;
  if (!userId) {
    return ctx.reply('Error: Could not identify user.');
  }

  // Check if the user is an admin
  const isUserAdmin = await is await isAdmin(ctx,Admin(ctx, user userId, chatId, chatId);
  if (!Id);
  if (!isisUserAdmin) {
    returnUserAdmin) {
    return ctx.reply('You ctx.reply('You must be an must be an admin of the admin of the channel to set channel to set a message.');
  }

 a message.');
  }

  // Check if  // Check if the bot the bot is an admin is an admin
  const
  const bot botId = (Id = (await ctx.telegram.getMeawait ctx.telegram.getMe()).id;
  const is()).id;
  const isBotAdmin = await isBotAdmin = await isAdmin(ctx, botId,Admin(ctx, botId, chatId);
  if chatId);
  if (!isBotAdmin) {
 (!isBotAdmin) {
    return ctx.reply('I    return ctx.reply('I must be an admin of the must be an admin of the channel to set channel to set a message.');
  }

 a message.');
  }

  // Save the  // Save the custom message to custom message to Firebase
 Firebase
  try {
  try {
    await set    await set(ref(db, `(ref(db, `channels/${chatchannels/${chatId}/customMessage`),Id}/customMessage`), customMessage); customMessage);
   
    ctx.reply(`Custom ctx.reply(`Custom message set for message set for @ @${channelName}: "${${channelName}: "${customMessage}"`);
customMessage}"`);
  } catch (error  } catch (error) {
    console.error(') {
    console.error('Error saving custom messageError saving custom:', error message:', error);
   );
    ctx.reply('Error ctx.reply('Error saving the custom message. saving the custom message. Please try again.');
  } Please try again.');
  }

});

// Command: /});

// Command: /unsetmessage @unsetmessage @channelname
botchannelname
bot.command('.command('unsetmessage',unsetmessage', async (ctx async (ctx) => {) => {
  const message
  const messageText = ctxText = ctx.message?.text;
  if.message?.text;
  if (!messageText) return;

 (!messageText) return;

  const  const match = message match = messageText.match(/^\/unsetText.match(/^\/unsetmessage\s+@message\s+@(\w+(\w+)$/);
  if)$/);
  if (!match) (!match) {
    return {
    return ctx.reply('Usage ctx.reply('Usage: /unset: /unsetmessage @message @channelname');
  }

channelname');
  }

  const [, channel  const [, channelName] =Name] = match;
  const channel match;
  const channel = await ctx = await ctx.telegram.telegram.getChat(`@${.getChat(`@${channelName}`).channelName}`).catchcatch(() => null(() => null);
  if);
  if (!channel) {
    return (!channel) {
    return ctx.reply(` ctx.reply(`Channel @Channel @${channelName} not${channelName} not found.`); found.`);
  }

  }


  const chat  const chatId = channelId = channel.id.toString();
  const.id.toString();
  const userId = ctx userId = ctx.from?.id.from?.id;
  if (!user;
  if (!userId) {Id) {

    return    return ctx ctx.reply('Error.reply('Error: Could: Could not identify user not identify user.');.');
  }
  }



  // Check if  // Check if the the user user is an admin is an admin
  const
  const isUserAdmin isUserAdmin = await is = await isAdmin(ctx, userAdmin(ctx, userId, chatId, chatId);
Id);
  if (!  if (!isUserAdmin)isUserAdmin) {
    return ctx.reply(' {
    return ctx.reply('You must be an admin ofYou must be an admin of the channel to unset the channel to unset the message the message.');
  }.');
  }

  // Remove

  // Remove the custom message from Firebase
  try {
    await remove(ref(db the custom message from Firebase
  try {
    await remove(ref(db, `, `channels/${chatchannels/${chatId}/customId}/customMessage`));
Message`));
    ctx    ctx.reply(`Custom.reply(`Custom message unset message unset for @ for @${channelName}.`);
${channelName}.`);
  } catch (error) {
  } catch (error) {
    console.error('Error unset    console.error('Error unsetting custom message:', error);
ting custom message:', error);
    ctx.reply('Error unset    ctx.reply('Error unsetting the custom message. Pleaseting the custom message. Please try again.');
  } try again.');
  }
});

//
});

// Handle all messages in channels Handle all messages in channels
bot
bot.on('message', async (.on('message', async (ctx) => {
  constctx) => {
  const chat chatId = ctx.chatId = ctx.chat?.id?.id.toString();.toString();
  const message
  const message = ctx.message = ctx.message;
;
  if (!chat  if (!chatId || !Id || !message ||message || !('text !('text'' in message)) in message)) {
 {
       return greeting return greeting()(ctx); // F()(ctx); // Fallback to greeting for non-textallback to greeting for non-text messages
 messages
  }

  //  }
 Check if the
  // Check message is in if the message is in a channel and if a channel and if a custom message a custom message exists
 exists
  get  getCustomMessage(chatCustomMessage(chatId, asyncId, async (customMessage (customMessage) => {
) => {
    if    if ( (customMessagecustomMessage)) {
 {
           const bot const botId = (await ctxId = (.telegram.getMeawait ctx.telegram()).id;.getMe()).
      constid;
 isBotAdmin      const is = await isAdmin(ctx,BotAdmin = botId, await isAdmin(ctx, bot chatId);Id, chat
      if (isBotAdminId);
) {
      if (        // EditisBotAdmin the message to append the custom) {
 message
        // Edit        try { the message to
          const append the custom newText = `${message.text}\n\n${customMessage}`;
          await ctx.telegram.editMessageText(chatId, message.message_id, undefined, newText).catch(async () => {
            // If editing fails message
        try {
          const newText = `${message.text}\n\n${customMessage}`;
          await ctx.telegram.editMessageText(chatId, message.message_id, undefined, newText).catch(async () => {
            // If editing fails (e.g., message not sent by bot (e.g), send a., message not new message sent by bot
            await), send a ctx.telegram.send new messageMessage(chatId
            await ctx, newText);
.telegram.sendMessage(chatId, newText);
          });
        } catch (error) {
          console          });
        } catch (error) {
          console.error('Error editing message:', error);
        }
      }
    } else {
      // If no custom message, fallback to greeting
.error('Error editing message:', error      greeting()(ctx);
    }
  });
});

// Existing command
bot.command('about', about);
       ());
 }
     
// Production }
    mode (V } else {ercel)
export const startV
      // If no custom message, fallbackercel = to greeting async (req
      greeting: Vercel()(ctx);Request, res
    }: Vercel
  });
Response) =>});
 {
  await
// Existing production(req, command
 res, botbot.command(');
};about', about

());

// Production// Development mode mode (Vercel)
if (ENVIRONMENT !== 'production')
export const {
  development startVerc(bot);
el = async}
``` (req:

 VercelRequest**Changes**, res::
- VercelResponse Imported `Data) => {Snapshot` and `DatabaseError
  await production` from `./(req, resutils/firebase.ts, bot);`.
-
};
 Added type annotations to the `snapshot` and `error` parameters in the `onValue` callback within `getCustomMessage`:
  ```typescript
  (snapshot: DataSnapshot) => { ... }
  (error: DatabaseError) => { ... }
