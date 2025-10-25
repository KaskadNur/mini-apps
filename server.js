const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Токен бота от @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '7591449691:AAGEsdfrNCgijjCgDwLPRaZ04rlU_UDxJys';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Хранилище для пользователей (в продакшене используйте БД)
const users = new Map();

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Главная страница Web App
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API для пользователя
app.get('/api/user/:userId', (req, res) => {
    const userId = req.params.userId;
    const userData = users.get(userId) || createNewUser(userId);
    res.json(userData);
});

// API для обновления баланса
app.post('/api/user/:userId/update-balance', (req, res) => {
    const userId = req.params.userId;
    const { balance, earned } = req.body;
    
    let userData = users.get(userId);
    if (!userData) {
        userData = createNewUser(userId);
    }
    
    if (balance !== undefined) userData.balance = balance;
    if (earned !== undefined) userData.totalEarned = earned;
    
    users.set(userId, userData);
    res.json(userData);
});

// API для реферальной системы
app.post('/api/user/:userId/add-referral', (req, res) => {
    const userId = req.params.userId;
    const referralId = req.body.referralId;
    
    let userData = users.get(userId);
    if (!userData) {
        userData = createNewUser(userId);
    }
    
    if (!userData.referrals.includes(referralId)) {
        userData.referrals.push(referralId);
    }
    
    users.set(userId, userData);
    res.json(userData);
});

function createNewUser(userId) {
    const userData = {
        userId: userId,
        balance: 0,
        totalEarned: 0,
        referrals: [],
        joinDate: new Date().toISOString(),
        referralCode: generateReferralCode()
    };
    users.set(userId, userData);
    return userData;
}

function generateReferralCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Обработчик команды /start с реферальными ссылками
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const referralCode = match[1]; // Реферальный код из ссылки
    const webAppUrl = 'https://telegram-hello-app.onrender.com';
    
    const keyboard = {
        inline_keyboard: [[
            {
                text: '🚀 Открыть приложение',
                web_app: { url: webAppUrl }
            }
        ]]
    };
    
    let message = '🎉 Добро пожаловать в EarnApp! Нажмите кнопку ниже чтобы открыть:';
    
    // Если есть реферальный код, обрабатываем его
    if (referralCode) {
        message += `\n\n👥 Вы пришли по приглашению друга!`;
        // Здесь можно сохранить реферальную связь
    }
    
    bot.sendMessage(chatId, message, {
        reply_markup: keyboard
    });
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Web App доступен: https://telegram-hello-app.onrender.com`);
});
