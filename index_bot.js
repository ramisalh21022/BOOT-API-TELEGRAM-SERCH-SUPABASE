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

// تخزين مؤقت للـ بيانات العميل لكل chatId لتقليل الطلبات
const clientsCache = new Map();

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // التحقق إذا كانت الرسالة تحتوي على رقم الهاتف (contact)
  if (msg.contact) {
    const phone = msg.contact.phone_number;

   

  const keyword = msg.text?.trim();
  if (!keyword) return bot.sendMessage(chatId, "أرسل كلمة للبحث 🔍 مثال: سكر");

  try {
    // تحضير معلومات العميل
    const client = {
      store_name: `عميل_${chatId}`,
      owner_name: `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || "غير معروف",
      phone: null, // رقم الهاتف سيُسجل عند الضغط على الزر
      address: "غير محدد"
    };

    let clientId = clientsCache.get(chatId);
    if (!clientId) {
      // تسجيل العميل أو جلبه إذا موجود
      const clientRes = await axios.post(`${API_URL}/clients`, client);
      clientId = clientRes.data.id;
      clientsCache.set(chatId, clientId);
    }

    // رسالة ترحيب بالاسم الحقيقي
    await bot.sendMessage(chatId, `👋 أهلا ${client.owner_name}، مرحبًا بك في متجرنا!`, {
      reply_markup: {
        keyboard: [[{ text: "شارك رقم هاتفك 📱", request_contact: true }]],
        one_time_keyboard: true
      }
    });

    // البحث عن المنتجات
    const response = await axios.get(`${API_URL}/products/search?keyword=${encodeURIComponent(keyword)}`);
    const products = response.data;

    if (!products.length) return bot.sendMessage(chatId, `🚫 لا يوجد نتائج لكلمة: ${keyword}`);

    for (const product of products) {
      const caption = `🛒 *${product.product_name}*\n📦 ${product.category}\n💵 ${product.price} ل.س`;
      const inlineKeyboard = [[{ text: `اطلب الآن`, callback_data: `order_${product.id}` }]];

      if (product.image_url) {
        await bot.sendPhoto(chatId, product.image_url, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } else {
        await bot.sendMessage(chatId, caption, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      }

      // تأخير بسيط لتفادي Too Many Requests
      await new Promise(resolve => setTimeout(resolve, 800));
    }

  } catch (err) {
    console.error(err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ حدث خطأ في البحث، حاول لاحقًا.");
  }
});

// التعامل مع الضغط على زر "اطلب الآن"
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('order_')) {
    const productId = parseInt(data.split('_')[1]);

    try {
      const clientData = clientsCache.get(chatId);
      if (!clientData) throw new Error("Client not found in cache");

      const orderRes = await axios.post(`${API_URL}/orders/init`, { client_id: clientData.id });
      const orderId = orderRes.data.id;

      await axios.post(`${API_URL}/order_items`, { order_id: orderId, product_id: productId, quantity: 1 });

      await bot.sendMessage(
        chatId,
        `✅ تم إضافة المنتج إلى طلبك بنجاح.\n🎉 رقم الطلب: ${orderId}\n👤 العميل: ${clientData.owner_name}\n📱 الهاتف: ${clientData.phone}\n🚚 سيتم التواصل معك للتوصيل.`
      );

      bot.answerCallbackQuery(callbackQuery.id);
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
});


