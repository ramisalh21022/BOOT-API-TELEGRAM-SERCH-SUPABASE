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

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const keyword = msg.text?.trim();
    if (!keyword) return bot.sendMessage(chatId, "أرسل كلمة للبحث 🔍 مثال: سكر");

    try {

      let clientId = clientsCache.get(chatId);

   if (!clientId) {
  // تسجيل العميل
  const clientRes = await axios.post(`${API_URL}/clients`, client);
  clientId = clientRes.data.id;
  clientsCache.set(chatId, clientId);

  // رسالة ترحيب للعميل الجديد
  if (clientRes.data && clientRes.data.created_at) {
    await bot.sendMessage(chatId, `👋 أهلا ${client.owner_name || "عميل"}، تم تسجيلك معنا بنجاح!`);
  }
}
      
        const response = await axios.get(`${API_URL}/products/search?keyword=${encodeURIComponent(keyword)}`);
        const products = response.data;
        if (!products.length) return bot.sendMessage(chatId, `🚫 لا يوجد نتائج لكلمة: ${keyword}`);

        for (const product of products) {
            const caption = `🛒 *${product.product_name}*\n📦 ${product.category}\n💵 ${product.price} ل.س`;
            const inlineKeyboard = [[{ text: `اطلب الآن`, callback_data: `order_${product.id}` }]];

            if (product.image_url) {
                await bot.sendPhoto(chatId, product.image_url, {
                    caption, parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard }
                });
            } else {
                await bot.sendMessage(chatId, caption, {
                    parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard }
                });
            }
        }
    } catch (err) {
        console.error(err.message);
        bot.sendMessage(chatId, "⚠️ حدث خطأ في البحث، حاول لاحقًا.");
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    if (data.startsWith('order_')) {
        const productId = parseInt(data.split('_')[1]);
        try {

          let clientId = clientsCache.get(chatId);

      if (!clientId) {
        // لو ما كان مخزن بالذاكرة نجيب العميل من API
        const phone = `tg_${chatId}`;
        const clientRes = await axios.get(`${API_URL}/clients/byPhone/${phone}`);
        clientId = clientRes.data.id;
        clientsCache.set(chatId, clientId);
      }

           
            const orderRes = await axios.post(`${API_URL}/orders/init`, { client_id: clientId });
            const orderId = orderRes.data.id;
            await axios.post(`${API_URL}/order_items`, { order_id: orderId, product_id: productId, quantity: 1 });

            await bot.sendMessage(chatId, `✅ تم إضافة المنتج إلى طلبك بنجاح.`);
            bot.answerCallbackQuery(callbackQuery.id);
          await bot.sendMessage(
  chatId,
  `🎉 تم تسجيل طلبك بنجاح!\n📦 رقم الطلب: ${orderId}\n👤 العميل: ${callbackQuery.from.first_name || "غير معروف"}\n📱 الهاتف: ${callbackQuery.from.username ? '@' + callbackQuery.from.username : "غير متوفر"}\n🚚 سيتم التواصل معك لتوصيل الطلب.`
);

        } catch (err) {
            console.error(err.response?.data || err.message);
            bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء تسجيل الطلب، حاول لاحقًا.");
            bot.answerCallbackQuery(callbackQuery.id);
        }
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



