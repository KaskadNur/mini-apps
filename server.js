const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Токен бота от @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '7591449691:AAGEsdfrNCgijjCgDwLPRaZ04rlU_UDxJys';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Хранилище для пользователей (в продакшене используйте MongoDB)
const users = new Map();
const battles = new Map();
let battleIdCounter = 1;

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

// API для обновления пользователя
app.post('/api/user/:userId/update', (req, res) => {
    const userId = req.params.userId;
    const updates = req.body;
    
    let userData = users.get(userId);
    if (!userData) {
        userData = createNewUser(userId);
    }
    
    // Обновляем данные пользователя
    Object.assign(userData, updates);
    users.set(userId, userData);
    
    res.json(userData);
});

// API для начала боя
app.post('/api/battle/start', (req, res) => {
    const { userId, opponentType = 'bot' } = req.body;
    
    const userData = users.get(userId);
    if (!userData) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Проверяем энергию
    if (userData.energy < 1) {
        return res.status(400).json({ error: 'Not enough energy' });
    }
    
    // Создаем бой
    const battle = {
        id: battleIdCounter++,
        player1: userId,
        player2: opponentType === 'bot' ? 'bot' : null,
        status: 'active',
        rounds: [],
        currentRound: 1,
        player1HP: 100,
        player2HP: 100,
        player1Energy: 3,
        player2Energy: 3,
        createdAt: new Date().toISOString()
    };
    
    battles.set(battle.id, battle);
    
    // Вычитаем энергию
    userData.energy -= 1;
    users.set(userId, userData);
    
    res.json({ battle, user: userData });
});

// API для хода в бою
app.post('/api/battle/move', (req, res) => {
    const { battleId, userId, move } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle) {
        return res.status(404).json({ error: 'Battle not found' });
    }
    
    // Записываем ход игрока
    if (!battle.rounds[battle.currentRound - 1]) {
        battle.rounds[battle.currentRound - 1] = {};
    }
    battle.rounds[battle.currentRound - 1].player1 = move;
    
    // Ход бота (если это бот)
    if (battle.player2 === 'bot') {
        const botMoves = ['attack', 'defend', 'special'];
        const botMove = botMoves[Math.floor(Math.random() * botMoves.length)];
        battle.rounds[battle.currentRound - 1].player2 = botMove;
        
        // Вычисляем результат раунда
        processRound(battle);
    }
    
    battles.set(battleId, battle);
    res.json({ battle });
});

// API для завершения боя
app.post('/api/battle/finish', (req, res) => {
    const { battleId, userId } = req.body;
    
    const battle = battles.get(battleId);
    if (!battle) {
        return res.status(404).json({ error: 'Battle not found' });
    }
    
    const userData = users.get(userId);
    if (!userData) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Начисляем награды
    const isWin = battle.player1HP > 0 && battle.player2HP <= 0;
    const rewards = calculateRewards(battle, isWin);
    
    userData.coins += rewards.coins;
    userData.experience += rewards.experience;
    userData.arenaPoints += rewards.arenaPoints;
    
    // Проверяем уровень
    checkLevelUp(userData);
    
    battle.status = 'finished';
    battle.rewards = rewards;
    battle.winner = isWin ? userId : 'bot';
    
    users.set(userId, userData);
    battles.set(battleId, battle);
    
    res.json({ battle, user: userData, rewards });
});

function createNewUser(userId) {
    const userData = {
        userId: userId,
        username: `Player${Math.random().toString(36).substring(2, 6)}`,
        level: 1,
        experience: 0,
        coins: 100,
        stars: 0,
        energy: 10,
        maxEnergy: 10,
        arenaPoints: 0,
        hero: {
            class: 'warrior',
            health: 100,
            attack: 10,
            defense: 5,
            speed: 8,
            skills: ['basic_attack']
        },
        inventory: {
            tickets: 3,
            boosts: [],
            skins: ['default']
        },
        stats: {
            battles: 0,
            wins: 0,
            losses: 0,
            winStreak: 0
        },
        joinDate: new Date().toISOString()
    };
    users.set(userId, userData);
    return userData;
}

function processRound(battle) {
    const round = battle.rounds[battle.currentRound - 1];
    const playerMove = round.player1;
    const botMove = round.player2;
    
    // Логика боя
    let playerDamage = 0;
    let botDamage = 0;
    
    // Игрок атакует
    if (playerMove === 'attack') {
        if (botMove !== 'defend') {
            botDamage = 20 + Math.floor(Math.random() * 10);
        } else {
            botDamage = 5 + Math.floor(Math.random() * 5); // Уменьшенный урон при защите
        }
    } else if (playerMove === 'special' && battle.player1Energy > 0) {
        if (botMove !== 'defend') {
            botDamage = 35 + Math.floor(Math.random() * 15);
        } else {
            botDamage = 10 + Math.floor(Math.random() * 5);
        }
        battle.player1Energy--;
    }
    
    // Бот атакует
    if (botMove === 'attack') {
        if (playerMove !== 'defend') {
            playerDamage = 15 + Math.floor(Math.random() * 8);
        } else {
            playerDamage = 4 + Math.floor(Math.random() * 4);
        }
    } else if (botMove === 'special' && battle.player2Energy > 0) {
        if (playerMove !== 'defend') {
            playerDamage = 30 + Math.floor(Math.random() * 12);
        } else {
            playerDamage = 8 + Math.floor(Math.random() * 4);
        }
        battle.player2Energy--;
    }
    
    // Применяем урон
    battle.player1HP = Math.max(0, battle.player1HP - playerDamage);
    battle.player2HP = Math.max(0, battle.player2HP - botDamage);
    
    round.playerDamage = playerDamage;
    round.botDamage = botDamage;
    
    // Переходим к следующему раунду или завершаем бой
    if (battle.currentRound < 3 && battle.player1HP > 0 && battle.player2HP > 0) {
        battle.currentRound++;
    } else {
        battle.status = 'finished';
    }
}

function calculateRewards(battle, isWin) {
    const baseCoins = isWin ? 50 : 20;
    const baseExp = isWin ? 25 : 10;
    const baseArenaPoints = isWin ? 10 : 5;
    
    return {
        coins: baseCoins + Math.floor(battle.player1HP / 10),
        experience: baseExp,
        arenaPoints: baseArenaPoints
    };
}

function checkLevelUp(userData) {
    const expNeeded = userData.level * 100;
    if (userData.experience >= expNeeded) {
        userData.level++;
        userData.experience -= expNeeded;
        userData.coins += userData.level * 50;
        return true;
    }
    return false;
}

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const webAppUrl = 'https://telegram-hello-app.onrender.com';
    
    const keyboard = {
        inline_keyboard: [[
            {
                text: '⚔️ Открыть PixelArena',
                web_app: { url: webAppUrl }
            }
        ]]
    };
    
    bot.sendMessage(chatId, '🎮 Добро пожаловать в PixelArena! Готовься к эпическим битвам!', {
        reply_markup: keyboard
    });
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер PixelArena запущен на порту ${PORT}`);
    console.log(`🌐 Web App доступен: https://telegram-hello-app.onrender.com`);
});
