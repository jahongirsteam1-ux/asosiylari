/**
 * TechStore — Firebase + Kanal integratsiyali To'lov Bot
 * =======================================================
 * @tech_uzbot — bu bot
 * @humocardbot — karta xabarnoma boti (kanalga admin)
 *
 * Logika:
 * 1. Foydalanuvchi to'laydi → @humocardbot kanalga xabar yuboradi
 * 2. Bu bot kanaldan o'qiydi → Firebase pending_suffixes dan summa topadi
 * 3. orders/{id}/status = 'confirmed' yozadi
 * 4. Web app (index.html) real-time kuzatib ko'radi → avtotasdiqlaydi
 * 5. Foydalanuvchiga xabar yuboriladi
 */

require('dotenv').config();
const TelegramBot        = require('node-telegram-bot-api');
const admin              = require('firebase-admin');

// ─── CONFIG ───────────────────────────────────────────────
const BOT_TOKEN          = process.env.BOT_TOKEN;
const CHANNEL_ID         = process.env.CHANNEL_ID;        // "-100XXXXXXXXX"
const FIREBASE_DB_URL    = process.env.FIREBASE_DB_URL;   // "https://xxx-default-rtdb.firebaseio.com"
const FIREBASE_SA        = process.env.FIREBASE_SA;       // service account JSON string
// ----------------------------------------------------------

// Firebase Admin init
const serviceAccount = JSON.parse(FIREBASE_SA || '{}');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: FIREBASE_DB_URL
});
const db = admin.database();

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 TechStore bot ishga tushdi');

// ─── SUMMANI AJRATIB OLISH ─────────────────────────────────
function extractAmount(text) {
  const patterns = [
    /(\d[\d\s]+)\s*so[''`]?m/gi,
    /[+]?\s*(\d[\d\s,]+)\s*(?:UZS|Sum)/gi,
    /(?:summa|o'tkazma|o'tkazildi|received)[:\s]+(\d[\d\s]+)/gi,
    /\b(\d{5,10})\b/g,
  ];
  for(const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if(m) {
      const n = parseInt(m[1].replace(/[\s,]/g,''));
      if(n >= 10000 && n <= 50000000) return n;
    }
  }
  return null;
}

// ─── KANAL XABARINI KUZATISH ──────────────────────────────
bot.on('channel_post', async msg => {
  if(String(msg.chat.id) !== String(CHANNEL_ID)) return;

  const text = msg.text || msg.caption || '';
  const amount = extractAmount(text);
  if(!amount) { console.log('Summa topilmadi:', text.substring(0,60)); return; }

  console.log(`💰 Kanal xabari: ${amount} so'm`);

  // Firebase dan pending suffikslarni ol
  const snap = await db.ref('settings/pending_suffixes').once('value');
  const pending = snap.val() || {};

  // Har bir pending buyurtmaning (basePrice + suffix) = amount ekanligini tekshir
  // Lekin bizda faqat suffix bor, basePrice yo'q
  // Shuning uchun orders/ dan o'qib, total = amount bo'lgan buyurtmani topamiz
  const ordersSnap = await db.ref('orders').orderByChild('total').equalTo(amount).once('value');
  const ordersData = ordersSnap.val();

  if(!ordersData) {
    console.log(`❌ ${amount} summa uchun buyurtma topilmadi`);
    return;
  }

  // Birinchi 'pending' statusli buyurtmani olish
  const [orderKey, order] = Object.entries(ordersData).find(([, v]) => v.status === 'pending') || [];
  if(!orderKey) { console.log('Pending buyurtma yo\'q'); return; }

  console.log(`✅ Buyurtma topildi: #${orderKey} — ${order.userName}`);

  // Status ni yangilash — web app real-time ko'radi
  await db.ref(`orders/${orderKey}/status`).set('confirmed');

  // Pending suffiksni o'chirish
  if(order.suffix) await db.ref(`settings/pending_suffixes/${order.suffix}`).remove();

  // Foydalanuvchiga xabar
  if(order.userId && BOT_TOKEN) {
    try {
      await bot.sendMessage(order.userId,
        `✅ <b>To'lovingiz tasdiqlandi!</b>\n\n` +
        `📦 Buyurtma: <b>#${orderKey}</b>\n` +
        `💰 Summa: <b>${amount.toLocaleString()} so'm</b>\n` +
        `🛍 ${order.products || ''}\n\n` +
        `🚀 Admin siz bilan tez orada bog'lanadi va mahsulot yetkaziladi!\n` +
        `<i>TechStore — Ishonchli xarid</i>`,
        { parse_mode: 'HTML' }
      );
      console.log(`📤 Foydalanuvchi ${order.userId} ga xabar yuborildi`);
    } catch(e) { console.error('Xabar yuborishda xato:', e.message); }
  }
});

// /start
bot.onText(/\/start/, msg => {
  bot.sendMessage(msg.chat.id,
    `👋 <b>TechStore</b> botiga xush kelibsiz!\n\n` +
    `🛍 Do'konimizga tashrif buyuring va buyurtma bering.\n` +
    `💳 To'lov amalga oshganda <b>avtomatik tasdiqlanadi!</b>`,
    { parse_mode: 'HTML' }
  );
});

bot.on('polling_error', e => console.error('Polling xato:', e.message));
process.on('uncaughtException', e => console.error('Xato:', e));
