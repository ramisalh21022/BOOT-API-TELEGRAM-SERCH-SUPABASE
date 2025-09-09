const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const API_URL = process.env.API_URL;
const bot = new TelegramBot(TOKEN, { polling: false });

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const keyword = msg.text?.trim();
    if (!keyword) return bot.sendMessage(chatId, "أرسل كلمة للبحث 🔍 مثال: سكر");

    try {
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
            const clientRes = await axios.post(`${API_URL}/clients`, { telegram_id: chatId });
            const clientId = clientRes.data.id;
            const orderRes = await axios.post(`${API_URL}/orders/init`, { client_id: clientId });
            const orderId = orderRes.data.id;
            await axios.post(`${API_URL}/order_items`, { order_id: orderId, product_id: productId, quantity: 1 });

            await bot.sendMessage(chatId, `✅ تم إضافة المنتج إلى طلبك بنجاح.`);
            bot.answerCallbackQuery(callbackQuery.id);
        } catch (err) {
            console.error(err.response?.data || err.message);
            bot.sendMessage(chatId, "⚠️ حدث خطأ أثناء تسجيل الطلب، حاول لاحقًا.");
            bot.answerCallbackQuery(callbackQuery.id);
        }
    }
});

