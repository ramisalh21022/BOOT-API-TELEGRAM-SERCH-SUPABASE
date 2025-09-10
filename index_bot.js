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

// تخزين مؤقت للـ clientId و الطلبات
const clientsCache = new Map();

// موزع (جروب أو مستخدم)
const distributorChatId = "963933210196";

// استقبال الرسائل
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const keyword = msg.text?.trim();

  // تجاهل رسالة مشاركة الهاتف (معالجتها بمكان آخر)
  if (msg.contact) return;

  if (!keyword) return bot.sendMessage(chatId, "أرسل كلمة للبحث 🔍 مثال: سكر");

  try {
    // تحضير بيانات العميل بالاسم الحقيقي
    const client = {
      store_name: `عميل_${chatId}`,
      owner_name: `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || "غير معروف",
      phone: msg.from.username ? `@${msg.from.username}` : `tg_${chatId}`,
      address: "غير محدد"
    };

    let clientId = clientsCache.get(chatId);

    if (!clientId) {
      const clientRes = await axios.post(`${API_URL}/clients`, client);
      clientId = clientRes.data.id;
      clientsCache.set(chatId, clientId);
      clientsCache.set(`${chatId}_client`, clientRes.data); // نخزن البيانات كاملة
    }

    // رسالة ترحيب دائمًا
    await bot.sendMessage(chatId, `👋 أهلا ${client.owner_name || "عميل"}، مرحبًا بك في متجرنا!`);

    // البحث عن المنتجات
    const response = await axios.get(`${API_URL}/products/search?keyword=${encodeURIComponent(keyword)}`);
    const products = response.data;

    if (!products.length) {
      return bot.sendMessage(chatId, `🚫 لا يوجد نتائج لكلمة: ${keyword}`);
    }

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

      await new Promise(resolve => setTimeout(resolve, 800)); // منع Too Many Requests
    }

  } catch (err) {
    console.error(err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ حدث خطأ في البحث، حاول لاحقًا.");
  }
});

// عند الضغط على "اطلب الآن"
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('order_')) {
    const productId = parseInt(data.split('_')[1]);

    try {
      const clientId = clientsCache.get(chatId);
      if (!clientId) throw new Error("Client not found in cache");

      const orderRes = await axios.post(`${API_URL}/orders/init`, { client_id: clientId });
      const orderId = orderRes.data.id;

      await axios.post(`${API_URL}/order_items`, { order_id: orderId, product_id: productId, quantity: 1 });

      // حفظ الطلب المعلق
      clientsCache.set(`${chatId}_pendingOrder`, orderId);

      // طلب تأكيد الهاتف
      await bot.sendMessage(chatId, "📱 يرجى تأكيد طلبك بمشاركة رقم هاتفك:", {
        reply_markup: {
          keyboard: [[{ text: "📲 مشاركة رقمي", request_contact: true }]],
          one_time_keyboard: true,
          resize_keyboard: true
        }
      });

      bot.answerCallbackQuery(callbackQuery.id);
    } catch (err) {
      console.error(err.response?.data || err.message);
      bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء تسجيل الطلب، حاول لاحقًا.");
      bot.answerCallbackQuery(callbackQuery.id);
    }
  }
});

// استقبال رقم الهاتف من العميل
bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const phone = msg.contact.phone_number;
  const orderId = clientsCache.get(`${chatId}_pendingOrder`);
  const client = clientsCache.get(`${chatId}_client`);

  if (!orderId || !client) return;

  try {
    // تحديث العميل في قاعدة البيانات برقم الهاتف
    await axios.patch(`${API_URL}/clients/updatePhone`, {
      id: client.id,
      phone: phone
    });

    // تأكيد الطلب
    await axios.post(`${API_URL}/orders/confirm`, { order_id: orderId });

    // رسالة تأكيد للعميل
    await bot.sendMessage(chatId, `✅ تم تأكيد طلبك بنجاح.\n🎉 رقم الطلب: ${orderId}\n👤 ${client.owner_name}\n📱 هاتفك: ${phone}\n🚚 سيتم التواصل معك قريبًا.`);

    // إشعار الموزع
    await bot.sendMessage(distributorChatId, `📦 طلب جديد مؤكد!\n🎉 رقم الطلب: ${orderId}\n👤 العميل: ${client.owner_name}\n📱 الهاتف: ${phone}`);

    // تنظيف الكاش
    clientsCache.delete(`${chatId}_pendingOrder`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء تأكيد الطلب.");
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
