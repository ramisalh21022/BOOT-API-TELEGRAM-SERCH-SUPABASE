const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 5000;

const bot = new TelegramBot(TOKEN, { polling: false });
const app = express();
app.use(bodyParser.json());

// clients cache
const clientsCache = new Map();

// webhook endpoint
app.post(`/webhook/${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// تسجيل العميل أو جلبه إذا موجود
const getOrCreateClient = async (chatId, msg) => {
  let clientId = clientsCache.get(chatId);
  if (clientId) return clientId;

  const phone = msg.from.username ? `@${msg.from.username}` : `tg_${chatId}`;
  const owner_name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || 'غير معروف';
  const store_name = `Client-${chatId}`;

  // تحقق إذا موجود
  const check = await axios.get(`${SUPABASE_URL}/rest/v1/clients?phone=eq.${phone}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });

  let client;
  if (check.data.length > 0) {
    client = check.data[0];
  } else {
    // إنشاء جديد
    const response = await axios.post(`${SUPABASE_URL}/rest/v1/clients`, {
      phone, owner_name, store_name, address: null
    }, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    });
    client = response.data[0];
  }

  clientsCache.set(chatId, client);
  return client;
};

// استقبال رسائل
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const keyword = msg.text?.trim();

  try {
    const client = await getOrCreateClient(chatId, msg);

    // رسالة الترحيب
    await bot.sendMessage(chatId, `👋 أهلا ${client.owner_name}، مرحبًا بك في متجرنا!`);

    // إذا كانت الرسالة مشاركة رقم الهاتف
    if (msg.contact?.phone_number) {
      // تحديث رقم الهاتف مباشرة في Supabase
      const response = await axios.patch(
        `${SUPABASE_URL}/rest/v1/clients?id=eq.${client.id}`,
        { phone: msg.contact.phone_number },
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          }
        }
      );
      const updatedClient = response.data[0];
      clientsCache.set(chatId, updatedClient);
      await bot.sendMessage(chatId, `✅ تم تحديث رقم الهاتف بنجاح: ${updatedClient.phone}`);
      return;
    }

    if (!keyword) return bot.sendMessage(chatId, "أرسل كلمة للبحث 🔍 مثال: سكر");

    // البحث عن المنتجات
    const response = await axios.get(`${SUPABASE_URL}/rest/v1/products?product_name=ilike.%${keyword}%`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
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

      await new Promise(r => setTimeout(r, 800)); // لتفادي Too Many Requests
    }

    // إرسال زر مشاركة رقم الهاتف
    const shareButton = {
      text: "مشاركة رقم الهاتف",
      request_contact: true
    };
    await bot.sendMessage(chatId, "📱 لتأكيد طلبك يرجى مشاركة رقم هاتفك:", {
      reply_markup: { keyboard: [[shareButton]], one_time_keyboard: true }
    });

  } catch (err) {
    console.error(err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ حدث خطأ، حاول لاحقًا.");
  }
});

// التعامل مع الضغط على زر "اطلب الآن"
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('order_')) {
    try {
      const productId = parseInt(data.split('_')[1]);
      const client = clientsCache.get(chatId);
      if (!client) throw new Error("Client not found in cache");

      // إنشاء الطلب
      const orderRes = await axios.post(`${SUPABASE_URL}/rest/v1/orders`, {
        client_id: client.id, status: "pending"
      }, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
      });
      const order = orderRes.data[0];

      // إضافة المنتج للطلب
      await axios.post(`${SUPABASE_URL}/rest/v1/order_items`, {
        order_id: order.id, product_id: productId, quantity: 1
      }, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
      });

      await bot.sendMessage(chatId,
        `✅ تم إضافة المنتج إلى طلبك بنجاح.\n🎉 رقم الطلب: ${order.id}\n👤 العميل: ${client.owner_name}\n📱 الهاتف: ${client.phone}\n🚚 سيتم التواصل معك للتوصيل.`
      );

      bot.answerCallbackQuery(callbackQuery.id);

    } catch (err) {
      console.error(err.response?.data || err.message);
      bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء تأكيد الطلب، حاول لاحقًا.");
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
