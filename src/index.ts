 import { Telegraf } from 'telegraf';
import { about } from './commands/about';
import { greeting } from './text/greeting';
import { development, production } from './core';
import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const CASHFREE_API_URL = process.env.NODE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://test.cashfree.com/pg';

const bot = new Telegraf(BOT_TOKEN);

// Register commands and message handlers
bot.command('about', about());
bot.on('message', greeting());

// Command to initiate payment
bot.command('pay', async (ctx) => {
  try {
    const orderAmount = 100; // Example amount in INR, modify as needed
    const orderId = `order_${Date.now()}_${ctx.from?.id || 'unknown'}`; // Unique order ID
    const customerId = ctx.from?.id.toString() || 'unknown';
    const customerEmail = ctx.from?.username
      ? `${ctx.from.username}@example.com`
      : 'user@example.com'; // Replace with actual email if available
    const customerPhone = '9999999999'; // Replace with actual phone number

    // Create payment link using Cashfree API
    const paymentLinkResponse = await axios.post(
      `${CASHFREE_API_URL}/orders`,
      {
        order_amount: orderAmount,
        order_id: orderId,
        order_currency: 'INR',
        customer_details: {
          customer_id: customerId,
          customer_email: customerEmail,
          customer_phone: customerPhone,
        },
        order_meta: {
          return_url: `https://founderbot.vercel.app/api/webhook?order_id={order_id}`,
          notify_url: `https://founderbot.vercel.app/api/webhook`,
        },
      },
      {
        headers: {
          'x-api-version': '2022-09-01',
          'x-client-id': CASHFREE_APP_ID,
          'x-client-secret': CASHFREE_SECRET_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    const paymentLink = paymentLinkResponse.data.payment_link;
    await ctx.reply(`Please complete the payment using this link: ${paymentLink}`);
  } catch (error) {
    console.error('Payment initiation error:', error);
    await ctx.reply('Sorry, something went wrong while initiating the payment.');
  }
});

// Prod mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

// Dev mode
if (ENVIRONMENT !== 'production') {
  development(bot);
}
