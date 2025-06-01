import { Context } from 'telegraf';
import { db, ref, onValue } from '../utils/firebase';
import { DataSnapshot } from 'firebase/database';
import createDebug from 'debug';

const debug = createDebug('bot:yakeen');

const CHANNEL_ID = process.env.CHANNEL_ID || '';

export function yakeen() {
  return async (ctx: Context) => {
    const command = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (!command) return;

    const match = command.match(/\/yakeen_lecture_(\d+)/);
    if (!match) {
      await ctx.reply('Usage: /yakeen_lecture_<number> (e.g., /yakeen_lecture_1)');
      return;
    }

    const lectureNumber = match[1];
    const key = `yakeen_lecture_${lectureNumber}`;
    const batch = '2026'; // Hardcoded for simplicity

    const subjectsRef = ref(db, `batches/${batch}`);
    onValue(
      subjectsRef,
      async (snapshot: DataSnapshot) => {
        const subjectsData = snapshot.val();
        if (!subjectsData) {
          await ctx.reply(`❌ No subjects found for batch ${batch}.`);
          return;
        }

        const subjects = Object.keys(subjectsData);
        let messageId: number | null = null;
        let found = false;

        for (const subject of subjects) {
          const chaptersRef = ref(db, `batches/${batch}/${subject}`);
          await new Promise<void>((resolve) => {
            onValue(
              chaptersRef,
              (chapterSnapshot: DataSnapshot) => {
                const chaptersData = chapterSnapshot.val();
                if (chaptersData) {
                  const chapters = Object.keys(chaptersData);
                  for (const chapter of chapters) {
                    const keys = chaptersData[chapter]?.keys;
                    if (keys && keys[key]) {
                      messageId = keys[key];
                      found = true;
                      break;
                    }
                  }
                }
                resolve();
              },
              (error: Error) => {
                debug('Error fetching chapters:', error.message);
                resolve();
              }
            );
          });
          if (found) break;
        }

        if (!found || !messageId) {
          await ctx.reply(`❌ No lecture found for /yakeen_lecture_${lectureNumber}.`);
          return;
        }

        try {
          await ctx.telegram.forwardMessage(ctx.chat!.id, CHANNEL_ID, messageId);
        } catch (error) {
          debug('Failed to forward message:', error);
          await ctx.reply('❌ Error: Unable to forward the lecture message.');
        }
      },
      (error: Error) => {
        debug('Error fetching subjects:', error.message);
        ctx.reply('❌ Error: Unable to fetch data from Firebase.');
      }
    );
  };
}
