const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Изменил на 3000, Render часто использует его

// Токен бота от @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '7591449691:AAGEsdfrNCgijjCgDwLPRaZ04rlU_UDxJys';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Хранилище для пользователей
const users = new Map();
const battles = new Map();
let battleIdCounter = 1;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Главная страница Web App
app.get('/', (req, res) => {
    console.log('GET / - Serving index.html');
    res.sendFile(path.join(__dirname, '
