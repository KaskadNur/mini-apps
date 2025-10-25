const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Токен бота от @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '7591449691:AAGEsdfrNCgijjCgDwLPRaZ04rlU_UDxJys';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Главная страница Web App
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check для Render
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    // URL вашего приложения на Render
    const webAppUrl = 'https://telegram-hello-app.onrender.com';
    
    const keyboard = {
        inline_keyboard: [[
            {
                text: '📱 Открыть приложение',
                web_app: { url: webAppUrl }
            }
        ]]
    };
    
    bot.sendMessage(chatId, '🎉 Добро пожаловать в мое приложение! Нажмите кнопку ниже чтобы открыть:', {
        reply_markup: keyboard
    });
});

// Обработчик данных из Web App
bot.on('message', (msg) => {
    if (msg.web_app_data) {
        try {
            const data = JSON.parse(msg.web_app_data.data);
            console.log('Данные из Web App:', data);
            
            bot.sendMessage(msg.chat.id, `✅ Привет! Кнопка была нажата ${data.count || 1} раз`);
        } catch (error) {
            console.error('Ошибка парсинга данных:', error);
        }
    }
});

// Обработка ошибок бота
bot.on('error', (error) => {
    console.log('Ошибка бота:', error);
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Web App доступен: https://telegram-hello-app.onrender.com`);
});
