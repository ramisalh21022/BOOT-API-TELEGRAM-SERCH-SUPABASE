// index_bot.js
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const API_URL = process.env.API_URL; // رابط API الخاص بك على Render
const PORT = process.env.PORT || 5000;

if (!TOKEN || !API_URL) {
  console.error("❌ يجب تحديد TELEGRAM_TOKEN و API_URL في المتغيرات البيئية!");
  process.exit(1);
}

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

// cache لتخزين clientId لكل chatId
const clientsCache = new Map();

// دالة لتسجيل العميل أو جلبه إذا موجود مسبقًا
async function getClientId(chatId, msg) {
  let clientId = clientsCache.get(chatId);
  if (clientId) return clientId;

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const keyword = msg.text?.trim();
    if (!keyword) return bot.sendMessage(chatId, "أرسل كلمة للبحث 🔍 مثال: سكر");

    // تحضير معلومات العميل
    const client = {
        store_name: `عميل_${chatId}`,
        owner_name: `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || "غير معروف",
        phone: msg.from.username ? `@${msg.from.username}` : `tg_${chatId}`,
        address: "غير محدد"
    };

    try {
        let clientId = clientsCache.get(chatId);

        if (!clientId) {
            // محاولة تسجيل العميل
            let clientRes;
            try {
                clientRes = await axios.post(`${API_URL}/clients`, client, {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err) {
                // التحقق إذا الاستجابة ليست JSON
                if (err.response && err.response.headers['content-type']?.includes('text/html')) {
                    console.error("❌ API /clients أعاد HTML بدل JSON. تحقق من API_URL أو endpoint!");
                    await bot.sendMessage(chatId, "⚠️ حدث خطأ في التواصل مع خدمة العملاء، حاول لاحقًا.");
                    return;
                }

                if (err.response?.status === 409) {
                    // العميل موجود مسبقاً، نجلبه
                    clientRes = await axios.get(`${API_URL}/clients/byPhone/${client.phone}`);
                } else {
                    throw err;
                }
            }

            if (!clientRes || !clientRes.data) {
                console.error("❌ لم يتم استرجاع بيانات العميل من API");
                await bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء تسجيل العميل، حاول لاحقًا.");
                return;
            }

            clientId = clientRes.data.id;
            clientsCache.set(chatId, clientId);
        }

        // رسالة ترحيب دائمًا
        await bot.sendMessage(chatId, `👋 أهلا ${client.owner_name || "عميل"}، مرحبًا بك في متجرنا!`);

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

  if (!data.startsWith('order_')) return;

  const productId = parseInt(data.split('_')[1]);

  try {
    const clientId = clientsCache.get(chatId);
    if (!clientId) throw new Error("Client not found in cache");

    // إنشاء الطلب
    const orderRes = await axios.post(`${API_URL}/orders/init`, { client_id: clientId });
    const orderId = orderRes.data.id;

    // إضافة المنتج للطلب
    await axios.post(`${API_URL}/order_items`, { order_id: orderId, product_id: productId, quantity: 1 });

    await bot.sendMessage(chatId,
      `✅ تم إضافة المنتج إلى طلبك بنجاح.\n🎉 رقم الطلب: ${orderId}\n🚚 سيتم التواصل معك للتوصيل.`);

    bot.answerCallbackQuery(callbackQuery.id);
  } catch (err) {
    console.error(err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء تسجيل الطلب، حاول لاحقًا.");
    bot.answerCallbackQuery(callbackQuery.id);
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

