require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

// Firebase init
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// Telegram chat ID of support (filled after first /start)
let supportChatId = process.env.SUPPORT_CHAT_ID || null;

// ── Telegram → App ──────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  supportChatId = msg.chat.id.toString();
  console.log('Support chat ID:', supportChatId);
  bot.sendMessage(supportChatId,
    '✅ Вы подключены как поддержка.\n\nВсе сообщения от пользователей будут приходить сюда. Просто отвечайте на них.'
  );
});

// Support replies in Telegram → save to Firestore → app gets update
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;

  const chatId = msg.chat.id.toString();
  if (!supportChatId) supportChatId = chatId;

  let replyToText = null;
  if (msg.reply_to_message?.text) {
    replyToText = msg.reply_to_message.text;
  }

  await db.collection('messages').add({
    text: msg.text,
    isFromUser: false,
    replyToText: replyToText,
    date: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: Date.now()
  });

  console.log('Support message saved:', msg.text);
});

// ── App → Telegram ──────────────────────────────────────────────
// Listen for new user messages in Firestore and forward to Telegram
db.collection('messages')
  .where('isFromUser', '==', true)
  .orderBy('createdAt', 'desc')
  .limit(1)
  .onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const data = change.doc.data();
        // Skip old messages on startup
        if (!data.createdAt || Date.now() - data.createdAt > 5000) return;

        if (!supportChatId) {
          console.log('No support chat ID yet. Support must /start the bot first.');
          return;
        }

        let text = `💬 *Пользователь:*\n${data.text}`;
        if (data.replyToText) {
          text = `↩️ _Ответ на:_ "${data.replyToText}"\n\n` + text;
        }

        bot.sendMessage(supportChatId, text, { parse_mode: 'Markdown' });
      }
    });
  });

// ── Express health check ────────────────────────────────────────
const app = express();
app.get('/', (req, res) => res.send('BankApp support server is running'));
app.listen(process.env.PORT || 3000, () => {
  console.log('Server started on port', process.env.PORT || 3000);
});
