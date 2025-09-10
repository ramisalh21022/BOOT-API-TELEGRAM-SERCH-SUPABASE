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
// ✨ الترحيب
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, `👋 أهلاً وسهلاً بك في متجرنا!  
اكتب كلمة للبحث عن المنتجات (مثلاً: سكر) 🔍`);
});

// 🔎 البحث عن المنتجات
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const keyword = msg.text?.trim();

  // تجاهل أوامر مثل /start
  if (!keyword || keyword.startsWith("/")) return;

  try {
    const response = await axios.get(`${API_URL}/products/search?keyword=${encodeURIComponent(keyword)}`);
    const products = response.data;

    if (!products.length) {
      return bot.sendMessage(chatId, `🚫 لا يوجد نتائج لكلمة: ${keyword}`);
    }

    // أول 5 منتجات فقط
    const limitedProducts = products.slice(0, 5);

    for (const product of limitedProducts) {
      const caption = `🛒 *${product.product_name}*\n📦 ${product.category}\n💵 ${product.price} ل.س`;
      const inlineKeyboard = [[{ text: `اطلب الآن`, callback_data: `order_${product.id}` }]];

      if (product.image_url) {
        await bot.sendPhoto(chatId, product.image_url, {
          caption,
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } else {
        await bot.sendMessage(chatId, caption, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }

      await new Promise(resolve => setTimeout(resolve, 1500)); // ⏳ مهلة بين الرسائل
    }

    // زر عرض المزيد
    if (products.length > 5) {
      await bot.sendMessage(chatId, `📦 يوجد ${products.length - 5} منتجات إضافية.\nاضغط أدناه لعرض المزيد 👇`, {
        reply_markup: {
          inline_keyboard: [[{ text: "عرض المزيد", callback_data: `more_${keyword}_5` }]]
        }
      });
    }
  } catch (error) {
    console.error("❌ Error searching products:", error.message);
    await bot.sendMessage(chatId, "⚠️ حدث خطأ في البحث، حاول لاحقًا.");
  }
});

// 📦 التعامل مع الأزرار
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  try {
    // 📌 عرض المزيد
    if (data.startsWith("more_")) {
      const [, keyword, offset] = data.split("_");
      const start = parseInt(offset);

      const response = await axios.get(`${API_URL}/products/search?keyword=${encodeURIComponent(keyword)}`);
      const products = response.data;

      const nextProducts = products.slice(start, start + 5);

      for (const product of nextProducts) {
        const caption = `🛒 *${product.product_name}*\n📦 ${product.category}\n💵 ${product.price} ل.س`;
        const inlineKeyboard = [[{ text: `اطلب الآن`, callback_data: `order_${product.id}` }]];

        if (product.image_url) {
          await bot.sendPhoto(chatId, product.image_url, {
            caption,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: inlineKeyboard }
          });
        } else {
          await bot.sendMessage(chatId, caption, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: inlineKeyboard }
          });
        }

        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      if (products.length > start + 5) {
        await bot.sendMessage(chatId, `📦 يوجد ${products.length - (start + 5)} منتجات إضافية.\nاضغط أدناه لعرض المزيد 👇`, {
          reply_markup: {
            inline_keyboard: [[{ text: "عرض المزيد", callback_data: `more_${keyword}_${start + 5}` }]]
          }
        });
      }
    }

    // 📌 عند الضغط على "اطلب الآن"
    if (data.startsWith("order_")) {
      const productId = data.split("_")[1];
      await bot.sendMessage(chatId, `✅ تم اختيار المنتج رقم ${productId}. سيتم تسجيل طلبك قريبًا.`);
    }

    bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error("❌ Callback error:", error.message);
    await bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء تنفيذ العملية.");
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
})

