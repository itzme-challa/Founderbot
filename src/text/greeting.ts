import { Context } from 'telegraf';
import createDebug from 'debug';

const debug = createDebug('bot:greeting_text');

// Utility function to reply to a specific message
const replyToMessage = (ctx: Context, messageId: number, string: string) =>
  ctx.reply(string, {
    reply_parameters: { message_id: messageId },
  });

// Array of varied greeting responses
const greetings = [
  (name: string) => `Hello, ${name}! Great to see you! 😊`,
  (name: string) => `Hey ${name}, what's up? Ready to chat? 🚀`,
  (name: string) => `Hi ${name}! Hope you're having an awesome day! 🌟`,
  (name: string) => `Greetings, ${name}! How can I make your day even better? 😉`,
];

// Function to get a random greeting from the array
const getRandomGreeting = (name: string): string => {
  const randomIndex = Math.floor(Math.random() * greetings.length);
  return greetings[randomIndex](name);
};

const greeting = () => async (ctx: Context) => {
  debug('Triggered "greeting" text command');

  const messageId = ctx.message?.message_id;
  // Safely handle user name, falling back to username or "friend" if no name is available
  const firstName = ctx.message?.from.first_name || ctx.message?.from.username || 'friend';
  const lastName = ctx.message?.from.last_name || '';
  const userName = lastName ? `${firstName} ${lastName}`.trim() : firstName;

  if (messageId) {
    const response = getRandomGreeting(userName);
    await replyToMessage(ctx, messageId, response);
  } else {
    // Fallback in case messageId is not available
    await ctx.reply(`Hello, ${userName}! Something went wrong, but I'm still happy to greet you! 😄`);
  }
};

export { greeting };
