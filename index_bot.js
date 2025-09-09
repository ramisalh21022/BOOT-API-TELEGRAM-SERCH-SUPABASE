// index_bot.js
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const API_URL = process.env.API_URL || 'https://YOUR-API-SERVICE.onrender.com';
const PORT = process.env.PORT || 5000;

// إنشاء بوت بدون polling
const bot = new TelegramBot(TOKEN, { polling: false });

// إنشاء تطبيق Express
const app = express();
app.use(bodyParser.json());

// استقبال التحديثات من Telegram عبر Webhook
app.post(`/webhook/${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// التعامل مع الرسائل
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

    // إرسال النتائج
    for (const product of products) {
            const caption = `🛒 *${product.product_name}*\n📦 ${product.category}\n💵 ${product.price} ل.س`;
            if (product.image_url) {
                await bot.sendPhoto(chatId, product.image_url, { caption, parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
            }
        }
    } catch (err) {
        console.error("Bot Axios error:", err.response?.data || err.message);
        bot.sendMessage(chatId, "⚠️ حدث خطأ في البحث، حاول لاحقًا.");
    }
});

// تشغيل السيرفر
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook/${TOKEN}`;
  try {
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set to: ${webhookUrl}`);
  } catch (err) {
    console.error("❌ Error setting webhook:", err.message);
  }
});

