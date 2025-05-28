import { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';
import axios from 'axios';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const bot = new Telegraf(BOT_TOKEN);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { data } = req.body;

  if (!data || !data.order || !data.order.order_id) {
    return res.status(400).json({ success: false, error: 'Invalid webhook data' });
  }

  const { order } = data;
  const { order_id, order_amount, customer_details, order_note } = order;
  const customerId = customer_details?.customer_id?.replace('cust_', ''); // Extract user ID
  const telegramLink = order_note; // Telegram link from order

  try {
    // Verify payment status with Cashfree API
    const response = await axios.get(`https://api.cashfree.com/pg/orders/${order_id}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2022-09-01',
        'x-client-id': process.env.CASHFREE_CLIENT_ID,
        'x-client-secret': process.env.CASHFREE_CLIENT_SECRET,
      },
    });

    const paymentStatus = response.data.order_status;

    if (paymentStatus === 'PAID') {
      // Send success message to user
      const userId = parseInt(customerId, 10);
      const user = await bot.telegram.getChat(userId).catch(() => null);
      const name = user && 'first_name' in user ? user.first_name : 'User';
      const username = user && 'username' in user ? `@${user.username}` : 'N/A';

      await bot.telegram.sendMessage(
        userId,
        `*Payment Successful!*\n\n` +
        `Thank you, *${name}* (${username}), for your support of ₹${order_amount}!\n` +
        `You can now join the Telegram group: ${telegramLink}\n\n` +
        `Details:\n` +
        `- *User ID*: ${userId}\n` +
        `- *Order ID*: ${order_id}\n` +
        `- *Amount*: ₹${order_amount}`,
        { parse_mode: 'Markdown' }
      );

      // Notify admin
      await bot.telegram.sendMessage(
        6930703214, // ADMIN_ID
        `*Payment Success Notification!*\n\n` +
        `*User*: ${name} (${username})\n` +
        `*User ID*: ${userId}\n` +
        `*Order ID*: ${order_id}\n` +
        `*Amount*: ₹${order_amount}\n` +
        `*Telegram Link*: ${telegramLink}`,
        { parse_mode: 'Markdown' }
      );

      return res.status(200).json({ success: true, message: 'Webhook processed' });
    } else {
      return res.status(400).json({ success: false, error: 'Payment not completed' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ success: false, error: 'Failed to process webhook' });
  }
}
