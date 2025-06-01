import { Context } from 'telegraf';
import createDebug from 'debug';
import { db, ref, onValue } from '../utils/firebase';
import { DataSnapshot } from 'firebase/database';

const debug = createDebug('bot:yakeen');

export function yakeen(CHANNEL_ID: string) {
  return async (ctx: Context) => {
    const commandText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const key = commandText.split(' ')[0].substring(1).toLowerCase(); // Extract key from /<keycommand>

    // Validate key
    if (!key) {
      await ctx.reply('Please specify a valid command.\nExample: /video');
      return;
    }

    // Assuming batch '2026' for simplicity; extend to allow batch selection if needed
    const batch = '2026';

    // Fetch subjects to search for the key
    const subjectsRef = ref(db, `batches/${batch}`);
    onValue(
      subjectsRef,
      async (snapshot: DataSnapshot) => {
        const subjects = snapshot.val() ? Object.keys(snapshot.val()) : [];
        let found = false;

        for (const subject of subjects) {
          const chaptersRef = ref(db, `batches/${batch}/${subject}`);
          onValue(
            chaptersRef,
            async (chapterSnapshot: DataSnapshot) => {
              const chapters = chapterSnapshot.val() ? Object.keys(chapterSnapshot.val()).filter((ch) => ch !== 'keys') : [];

              for (const chapter of chapters) {
                const messageId = await new Promise<number | null>((resolve) => {
                  const keyRef = ref(db, `batches/${batch}/${subject}/${chapter}/keys/${key}`);
                  onValue(
                    keyRef,
                    (keySnapshot: DataSnapshot) => {
                      const messageId = keySnapshot.val();
                      resolve(messageId || null);
                    },
                    (error: Error) => {
                      debug('Error fetching key:', error.message);
                      resolve(null);
                    }
                  );
                });

                if (messageId) {
                  found = true;
                  try {
                    await ctx.telegram.forwardMessage(ctx.chat!.id, CHANNEL_ID, messageId);
                    debug(`Forwarded message ${messageId} for key ${key} to chat ${ctx.chat!.id}`);
                    return;
                  } catch (error) {
                    debug('Failed to forward message:', error);
                    await ctx.reply(`❌ Failed to forward message for key: ${key}`);
                    return;
                  }
                }
              }

              // Reply only if no message was found after checking all chapters
              if (!found) {
                await ctx.reply(`❌ No message found for key: ${key}`);
              }
            },
            (error: Error) => {
              debug('Error fetching chapters:', error.message);
              ctx.reply('❌ Error fetching chapters.');
            }
      );
    }
  };
}
