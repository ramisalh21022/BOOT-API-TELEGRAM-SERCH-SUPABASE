// index_bot.js
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ضع التوكن الذي حصلت عليه من BotFather
const TOKEN = process.env.TELEGRAM_TOKEN;
const API_URL = process.env.API_URL || 'https://YOUR-RENDER-APP.onrender.com';

// إنشاء البوت
const bot = new TelegramBot(TOKEN, { polling: true });

// عند استقبال رسالة من المستخدم
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const keyword = msg.text?.trim();

  if (!keyword) {
    return bot.sendMessage(chatId, "أرسل كلمة للبحث 🔍 مثال: سكر");
  }

  try {
    const response = await axios.get(`${API_URL}/products/search?keyword=${encodeURIComponent(keyword)}`);
    const products = response.data;

    if (products.length === 0) {
      return bot.sendMessage(chatId, `🚫 لا يوجد نتائج لكلمة: ${keyword}`);
    }

    for (const product of products) {
      const caption = `🛒 *${product.product_name}*\n📦 ${product.category}\n💵 ${product.price} ل.س`;
      if (product.image_url) {
        await bot.sendPhoto(chatId, product.image_url, { caption, parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
      }
    }

  } catch (err) {
    console.error(err.message);
    bot.sendMessage(chatId, "⚠️ حدث خطأ في البحث، حاول لاحقًا.");
  }
});
