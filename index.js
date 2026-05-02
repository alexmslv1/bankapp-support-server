require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// Firebase init
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
let supportChatId = process.env.SUPPORT_CHAT_ID || null;

// IDs уже пересланных сообщений — чтобы не дублировать при рестарте
const forwarded = new Set();

// ── Telegram → App ──────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  supportChatId = msg.chat.id.toString();
  console.log('Support connected:', supportChatId);
  bot.sendMessage(supportChatId,
    '✅ Вы подключены как поддержка.\nСообщения от пользователей будут приходить сюда. Отвечайте через Reply.'
  );
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (!supportChatId) supportChatId = msg.chat.id.toString();

  let replyToText = null;
  if (msg.reply_to_message?.text) {
    replyToText = msg.reply_to_message.text.replace(/^💬 Пользователь:\n/, '');
  }

  await db.collection('messages').add({
    text: msg.text,
    isFromUser: false,
    replyToText: replyToText,
    createdAt: Date.now()
  });
  console.log('Telegram → App:', msg.text);
});

// ── App → Telegram ──────────────────────────────────────────────
// Без where-фильтров — никаких индексов не нужно, фильтруем в JS
db.collection('messages')
  .orderBy('createdAt', 'desc')
  .limit(50)
  .onSnapshot(snapshot => {
    snapshot.docChanges().forEach(async change => {
      if (change.type !== 'added') return;

      const docId = change.doc.id;
      const data  = change.doc.data();

      // Только сообщения от пользователя, которые ещё не пересылали
      if (!data.isFromUser)       return;
      if (forwarded.has(docId))   return;
      forwarded.add(docId);

      // Пропускаем старые сообщения (старше 30 секунд)
      if (data.createdAt && Date.now() - data.createdAt > 30_000) return;

      console.log('New user message:', data.text);

      if (!supportChatId) {
        console.log('No supportChatId — support must send /start to the bot');
        return;
      }

      let text = `💬 Пользователь:\n${data.text}`;
      if (data.replyToText) text = `↩️ В ответ на: "${data.replyToText}"\n\n` + text;

      await bot.sendMessage(supportChatId, text);
      console.log('Forwarded to Telegram ✅');
    });
  });

// ── Express + self-ping ─────────────────────────────────────────
const app = express();
app.get('/', (_, res) => res.send('BankApp support server ✅'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));

const RENDER_URL = process.env.RENDER_URL;
if (RENDER_URL) {
  setInterval(() => {
    require('https').get(RENDER_URL, () => console.log('Self-ping ✅'))
      .on('error', e => console.log('Ping error:', e.message));
  }, 14 * 60 * 1000);
}
