import { Context } from 'telegraf';
import { db, ref, onValue } from '../utils/firebase';
import { DataSnapshot } from 'firebase/database';

const CHANNEL_ID = process.env.CHANNEL_ID || '-1002277073649';
const ADMIN_USERNAME = '@itzfew';

export const yakeen = () => async (ctx: Context) => {
  const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  if (!messageText || !messageText.startsWith('/yakeen_')) return;

  const key = messageText.split('/yakeen_')[1]?.toLowerCase();
  if (!key) {
    await ctx.reply('Please provide a valid key. Usage: /yakeen_<key>');
    return;
  }

  // Fetch batches from Firebase
  const batchesRef = ref(db, 'batches');
  onValue(
    batchesRef,
    async (snapshot: DataSnapshot) => {
      const batches = snapshot.val();
      if (!batches) {
        await ctx.reply(`Key not found: ${key}. Please contact ${ADMIN_USERNAME}.`);
        return;
      }

      let found = false;
      for (const batch of Object.keys(batches)) {
        const subjects = batches[batch];
        for (const subject of Object.keys(subjects)) {
          const chapters = subjects[subject];
          for (const chapter of Object.keys(chapters)) {
            const keys = chapters[chapter].keys;
            if (keys && keys[key]) {
              const messageId = keys[key];
              try {
                await ctx.telegram.forwardMessage(ctx.chat!.id, CHANNEL_ID, parseInt(messageId));
                found = true;
                return;
              } catch (error) {
                console.error('Failed to forward message:', error);
                await ctx.reply(`Message ID not found: ${messageId}. Please contact ${ADMIN_USERNAME}.`);
                return;
              }
            }
          }
        }
      }

      if (!found) {
        await ctx.reply(`Key not found: ${key}. Please contact ${ADMIN_USERNAME}.`);
      }
    },
    (error: Error) => {
      console.error('Error fetching batches:', error.message);
      ctx.reply('Error accessing Firebase. Please try again later.');
    }
  );
};
