bot.command('support', async (ctx) => {
  if (!ctx.chat || !isPrivateChat(ctx.chat.type)) {
    return ctx.reply('Please use this command in a private chat.');
  }

  const user = ctx.from;
  const args = ctx.message.text.split(' ').slice(1);
  const amount = args[0] === '20' ? 20 : 10;
  const productId = `support_${amount}`;
  const productName = `Support Donation (${amount} INR)`;
  const telegramLink = 'https://t.me/AkashTest_Series';
  const customerName = user?.first_name || 'Unknown';
  const customerUsername = user?.username ? `@${user.username}` : 'N/A';
  const customerId = user?.id.toString();
  const customerEmail = `${customerId}@example.com`;
  const customerPhone = '9999999999';

  try {
    const response = await axios.post(`${BASE_URL}/api/createOrder`, {
      productId,
      productName,
      amount,
      telegramLink,
      customerName,
      customerEmail,
      customerPhone,
    }, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.data.success) {
      const { paymentSessionId } = response.data;
      await ctx.reply(
        `Thank you for supporting us! Please complete the payment of ₹${amount} using the link below:\n\n` +
        `https://api.cashfree.com/pg/links/${paymentSessionId}\n\n` +
        `After payment, you'll be redirected to the Telegram group. You can also join manually: ${telegramLink}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: 'Pay Now', url: `https://api.cashfree.com/pg/links/${paymentSessionId}` }]],
          },
        }
      );
    } else {
      await ctx.reply('❌ Failed to initiate payment. Please try again later.');
    }
  } catch (error: any) {
    console.error('Error initiating payment:', error?.response?.data || error.message);
    await ctx.reply('❌ An error occurred while processing your request. Please try again.');
  }
});
