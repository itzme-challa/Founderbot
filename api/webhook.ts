import { VercelRequest, VercelResponse } from '@vercel/node';
import { Telegraf } from 'telegraf';
import crypto from 'crypto';

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';

const bot = new Telegraf(BOT_TOKEN);

// Webhook handler for Cashfree payment status updates
export default async function webhook(req: VercelRequest, res: VercelResponse) {
  try {
    const webhookData = req.body;
    const { order_id, order_status, transaction_id, customer_details } = webhookData;

    // Verify webhook signature (example implementation, adjust as per Cashfree's docs)
    const signature = req.headers['x-webhook-signature'] as string;
    const rawBody = JSON.stringify(req.body);
    const computedSignature = crypto
      .createHmac('sha256', CASHFREE_SECRET_KEY)
      .update(rawBody)
      .digest('base64');

    if (signature !== computedSignature) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ status: 'error', message: 'Invalid signature' });
    }

    if (order_status === 'PAID') {
      // Notify user of successful payment
      const userId = customer_details?.customer_id;
      if (userId) {
        await bot.telegram.sendMessage(
          userId,
          `Payment successful! Order ID: ${order_id}, Transaction ID: ${transaction_id}`
        );
      }
    } else if (order_status === 'FAILED' || order_status === 'CANCELLED') {
      // Notify user of failed payment
      const userId = customer_details?.customer_id;
      if (userId) {
        await bot.telegram.sendMessage(
          userId,
          `Payment failed for Order ID: ${order_id}. Please try again.`
        );
      }
    }

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ status: 'error', message: 'Webhook processing failed' });
  }
}
