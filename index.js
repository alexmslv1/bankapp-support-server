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

// ── Telegram → App ──────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  supportChatId = msg.chat.id.toString();
  console.log('Support connected:', supportChatId);
  bot.sendMessage(supportChatId,
    '✅ Вы подключены как поддержка.\n\nСообщения от пользователей будут приходить сюда. Отвечайте через кнопку Reply.'
  );
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (!supportChatId) supportChatId = msg.chat.id.toString();

  // Clean up forwarded prefix if support replies to a forwarded message
  let replyToText = null;
  if (msg.reply_to_message?.text) {
    replyToText = msg.reply_to_message.text
      .replace(/^💬 \*Пользователь:\*\n/, '')
      .replace(/^💬 Пользователь:\n/, '');
  }

  await db.collection('messages').add({
    text: msg.text,
    isFromUser: false,
    replyToText: replyToText,
    createdAt: Date.now(),
    forwarded: true
  });
  console.log('Telegram → App:', msg.text);
});

// ── App → Telegram ──────────────────────────────────────────────
// Слушаем только сообщения от пользователя которые ещё не переслали
db.collection('messages')
  .where('isFromUser', '==', true)
  .where('forwarded', '==', false)
  .onSnapshot(async snapshot => {
    for (const change of snapshot.docChanges()) {
      if (change.type !== 'added') continue;

      const data = change.doc.data();
      console.log('New user message:', data.text);

      // Сразу помечаем как пересланное чтобы не отправить дважды
      await change.doc.ref.update({ forwarded: true });

      if (!supportChatId) {
        console.log('No supportChatId — support must /start the bot');
        continue;
      }

      let text = `💬 Пользователь:\n${data.text}`;
      if (data.replyToText) {
        text = `↩️ В ответ на: "${data.replyToText}"\n\n` + text;
      }

      await bot.sendMessage(supportChatId, text);
      console.log('App → Telegram: forwarded ✅');
    }
  });

// ── Express ─────────────────────────────────────────────────────
const app = express();
app.get('/', (_, res) => res.send('BankApp support server ✅'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));

// Пинг себя каждые 14 минут чтобы Render не засыпал
const RENDER_URL = process.env.RENDER_URL;
if (RENDER_URL) {
  setInterval(() => {
    require('https').get(RENDER_URL, () => console.log('Self-ping ✅'))
      .on('error', e => console.log('Ping error:', e.message));
  }, 14 * 60 * 1000);
}
