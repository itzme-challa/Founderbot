import { Telegraf } from 'telegraf';
import { firebase } from '../utils/firebase'; // Adjusted import for v8
import { ADMIN_ID, CHANNEL_ID } from '../config';
import { Context } from 'telegraf';
import createDebug from 'debug';

const debug = createDebug('bot:yakeen');

interface BatchData {
  [subject: string]: {
    [chapter: string]: {
      keys: {
        [key: string]: number;
      };
    };
  };
}

interface PublishState {
  subject?: string;
  chapter?: string;
  awaitingKeys?: boolean;
}

const publishStates: Record<number, PublishState> = {};

export function setupYakeenCommands(bot: Telegraf) {
  // Command to access Yakeen content
  bot.command(/yakeen_([a-zA-Z0-9_]+)/i, async (ctx) => {
    const key = ctx.match[1];
    debug(`Yakeen key requested: ${key}`);

    try {
      // Fetch all batches data from Firebase
      const snapshot = await firebase.database().ref('batches').once('value');

      if (!snapshot.exists()) {
        return ctx.reply('No batches data found. Contact admin @itzfew');
      }

      const batchesData: Record<string, BatchData> = snapshot.val();
      let found = false;
      let messageId: number | null = null;

      // Search through all batches, subjects, and chapters for the key
      for (const [batch, subjects] of Object.entries(batchesData)) {
        for (const [subject, chapters] of Object.entries(subjects)) {
          for (const [chapter, data] of Object.entries(chapters)) {
            if (data.keys && data.keys[key]) {
              messageId = data.keys[key];
              found = true;
              break;
            }
          }
          if (found) break;
        }
        if (found) break;
      }

      if (found && messageId) {
        try {
          // Fixed: Use two arguments for forwardMessage
          await ctx.telegram.forwardMessage(ctx.chat.id, messageId);
          debug(`Successfully forwarded message with key ${key}`);
        } catch (err) {
          debug(`Failed to forward message: ${err}`);
          await ctx.reply(
            `Message with key ${key} exists but couldn't be forwarded. Contact admin @itzfew`
          );
        }
      } else {
        await ctx.reply(
          `Key "${key}" not found. Contact admin @itzfew if you believe this is an error.`
        );
      }
    } catch (error) {
      debug('Error fetching from Firebase:', error);
      await ctx.reply('Error accessing content. Please try again later or contact admin @itzfew');
    }
  });

  // Admin command to publish new keys
  bot.command('publish', async (ctx) => {
    if (ctx.from?.id !== ADMIN_ID) {
      return ctx.reply('You are not authorized to use this command.');
    }

    try {
      // Fetch batches data to get subjects
      const snapshot = await firebase.database().ref('batches').once('value');

      if (!snapshot.exists()) {
        return ctx.reply('No batches data found in Firebase.');
      }

      const batchesData: Record<string, BatchData> = snapshot.val();
      const subjects = new Set<string>();

      // Collect all unique subjects across batches
      for (const batch of Object.values(batchesData)) {
        for (const subject of Object.keys(batch)) {
          subjects.add(subject);
        }
      }

      if (subjects.size === 0) {
        return ctx.reply('No subjects found in Firebase.');
      }

      const subjectList = Array.from(subjects)
        .map((subj, index) => `${index + 1}. ${subj}`)
        .join('\n');

      publishStates[ctx.from.id] = {
        subject: undefined,
        chapter: undefined,
        awaitingKeys: false,
      };

      await ctx.reply(`Select a subject by replying with its number:\n\n${subjectList}`);
    } catch (error) {
      debug('Error in publish command:', error);
      await ctx.reply('Error fetching subjects. Please try again later.');
    }
  });

  // Handle subject and chapter selection, and key-value pairs
  bot.on('message', async (ctx: Context) => {
    if (!ctx.from || !publishStates[ctx.from.id] || ctx.from.id !== ADMIN_ID) return;

    const state = publishStates[ctx.from.id];
    const msg = ctx.message as any;

    if (!state.subject && !state.awaitingKeys) {
      // Subject selection
      const subjectNumber = parseInt(msg.text?.trim() || '', 10);
      if (isNaN(subjectNumber)) return;

      try {
        const snapshot = await firebase.database().ref('batches').once('value');

        if (!snapshot.exists()) return;

        const batchesData: Record<string, BatchData> = snapshot.val();
        const subjects = new Set<string>();

        for (const batch of Object.values(batchesData)) {
          for (const subject of Object.keys(batch)) {
            subjects.add(subject);
          }
        }

        const subjectList = Array.from(subjects);
        if (subjectNumber < 1 || subjectNumber > subjectList.length) {
          return ctx.reply('Invalid subject number. Please try again.');
        }

        state.subject = subjectList[subjectNumber - 1];

        // Fetch chapters for this subject
        const chapters: string[] = [];
        for (const batch of Object.values(batchesData)) {
          if (batch[state.subject]) {
            chapters.push(...Object.keys(batch[state.subject]));
          }
        }

        if (chapters.length === 0) {
          delete publishStates[ctx.from.id];
          return ctx.reply(`No chapters found for subject ${state.subject}`);
        }

        const uniqueChapters = [...new Set(chapters)];
        const chapterList = uniqueChapters
          .map((chap, index) => `${index + 1}. ${chap}`)
          .join('\n');

        await ctx.reply(
          `Selected subject: ${state.subject}\n\n` +
          `Select a chapter by replying with its number:\n\n${chapterList}`
        );
      } catch (error) {
        debug('Error in subject selection:', error);
        await ctx.reply('Error processing your request. Please try again.');
      }
    } else if (state.subject && !state.chapter && !state.awaitingKeys) {
      // Chapter selection
      const chapterNumber = parseInt(msg.text?.trim() || '', 10);
      if (isNaN(chapterNumber)) return;

      try {
        const snapshot = await firebase.database().ref('batches').once('value');

        if (!snapshot.exists()) return;

        const batchesData: Record<string, BatchData> = snapshot.val();
        const chapters: string[] = [];

        for (const batch of Object.values(batchesData)) {
          if (batch[state.subject!]) {
            chapters.push(...Object.keys(batch[state.subject!]));
          }
        }

        const uniqueChapters = [...new Set(chapters)];
        if (chapterNumber < 1 || chapterNumber > uniqueChapters.length) {
          return ctx.reply('Invalid chapter number. Please try again.');
        }

        state.chapter = uniqueChapters[chapterNumber - 1];
        state.awaitingKeys = true;

        await ctx.reply(
          `Selected chapter: ${state.chapter}\n\n` +
          `Please send the keys and message IDs in the format:\n` +
          `key1:123,key2:456,key3:789\n\n` +
          `Where the numbers are the message IDs in the channel.`
        );
      } catch (error) {
        debug('Error in chapter selection:', error);
        await ctx.reply('Error processing your request. Please try again.');
      }
    } else if (state.awaitingKeys && msg.text) {
      // Key-value pairs input
      const keyValuePairs: string[] = msg.text
        .split(',')
        .map((pair: string) => pair.trim())
        .filter((pair: string) => pair.includes(':'));

      if (keyValuePairs.length === 0) {
        return ctx.reply(
          'Invalid format. Please use: key1:123,key2:456\n' +
          'Where numbers are message IDs in the channel.'
        );
      }

      const entries: Record<string, number> = {};
      let hasError = false;

      for (const pair of keyValuePairs) {
        const [key, value]: string[] = pair.split(':').map((part: string) => part.trim());
        const messageId = parseInt(value, 10);

        if (!key || isNaN(messageId)) {
          hasError = true;
          continue;
        }

        entries[key] = messageId;
      }

      if (Object.keys(entries).length === 0) {
        return ctx.reply('No valid key:value pairs found. Please try again.');
      }

      if (hasError) {
        await ctx.reply('Some entries were invalid and skipped. Processing valid ones...');
      }

      try {
        // Find the first batch that has this subject and chapter
        const snapshot = await firebase.database().ref('batches').once('value');

        if (!snapshot.exists()) return;

        const batchesData: Record<string, BatchData> = snapshot.val();
        let targetBatch: string | null = null;

        for (const [batch, subjects] of Object.entries(batchesData)) {
          if (subjects[state.subject!]?.[state.chapter!]) {
            targetBatch = batch;
            break;
          }
        }

        if (!targetBatch) {
          // If no existing batch has this subject/chapter, use the first batch
          targetBatch = Object.keys(batchesData)[0];
        }

        const updatePath = `batches/${targetBatch}/${state.subject}/${state.chapter}/keys`;
        const existingSnapshot = await firebase.database().ref(updatePath).once('value');
        const existingKeys = existingSnapshot.exists() ? existingSnapshot.val() : {};
        const mergedKeys = { ...existingKeys, ...entries };

        await firebase.database().ref(updatePath).set(mergedKeys);

        await ctx.reply(
          `✅ Successfully added/updated ${Object.keys(entries).length} keys ` +
          `for ${state.subject} (${state.chapter}) in batch ${targetBatch}.`
        );

        // Clear the publish state
        delete publishStates[ctx.from.id];
      } catch (error) {
        debug('Error saving keys:', error);
        await ctx.reply('Error saving keys to Firebase. Please try again.');
      }
    }
  });
}
