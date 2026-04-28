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
const serverStartTime = Date.now();

// ── Telegram → App ──────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  supportChatId = msg.chat.id.toString();
  console.log('Support connected, chat ID:', supportChatId);
  bot.sendMessage(supportChatId,
    '✅ Вы подключены как поддержка.\n\nСообщения от пользователей будут приходить сюда. Отвечайте через Reply (кнопка ответить) на сообщение.'
  );
});

bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  if (!supportChatId) supportChatId = msg.chat.id.toString();

  await db.collection('messages').add({
    text: msg.text,
    isFromUser: false,
    replyToText: msg.reply_to_message?.text?.replace(/^💬 \*Пользователь:\*\n/, '') || null,
    createdAt: Date.now()
  });
  console.log('Support → App:', msg.text);
});

// ── App → Telegram ──────────────────────────────────────────────
// Слушаем ВСЕ новые документы — фильтруем в JS, без составного индекса
db.collection('messages').onSnapshot(snapshot => {
  snapshot.docChanges().forEach(change => {
    if (change.type !== 'added') return;
    const data = change.doc.data();

    // только сообщения от пользователя, только новые (после старта сервера)
    if (!data.isFromUser) return;
    if (!data.createdAt || data.createdAt < serverStartTime) return;

    if (!supportChatId) {
      console.log('Нет supportChatId — поддержка должна написать /start боту');
      return;
    }

    let text = `💬 *Пользователь:*\n${data.text}`;
    if (data.replyToText) {
      text = `↩️ _В ответ на:_ "${data.replyToText}"\n\n` + text;
    }

    bot.sendMessage(supportChatId, text, { parse_mode: 'Markdown' });
    console.log('App → Telegram:', data.text);
  });
});

// ── Health check ────────────────────────────────────────────────
const app = express();
app.get('/', (_, res) => res.send('BankApp support server is running ✅'));
app.listen(process.env.PORT || 3000, () =>
  console.log('Server started, port', process.env.PORT || 3000)
);
