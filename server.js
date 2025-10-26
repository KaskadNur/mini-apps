require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация бота
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не найден в переменных окружения');
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('✅ Бот инициализирован');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory хранилище (в продакшене заменить на MongoDB)
const users = new Map();
const battles = new Map();
const leaderboard = new Map();
let battleIdCounter = 1;

// Классы героев
const HERO_CLASSES = {
    warrior: { 
        name: '⚔️ Воин', 
        health: 120, 
        attack: 15, 
        defense: 10, 
        speed: 8,
        special: 'power_strike'
    },
    mage: { 
        name: '🔮 Маг', 
        health: 80, 
        attack: 25, 
        defense: 5, 
        speed: 12,
        special: 'fireball'
    },
    archer: { 
        name: '🏹 Лучник', 
        health: 100, 
        attack: 20, 
        defense: 7, 
        speed: 15,
        special: 'double_shot'
    }
};

// Создание нового пользователя
function createNewUser(userId, userData) {
    const user = {
        userId: userId,
        username: userData.first_name || `Player${userId}`,
        level: 1,
        experience: 0,
        coins: 100,
        stars: 0,
        energy: 10,
        maxEnergy: 10,
        arenaPoints: 1000,
        hero: {
            class: 'warrior',
            ...HERO_CLASSES.warrior,
            currentHealth: HERO_CLASSES.warrior.health
        },
        inventory: {
            tickets: 5,
            boosts: [],
            skins: ['default']
        },
        stats: {
            battles: 0,
            wins: 0,
            losses: 0,
            winStreak: 0,
            totalDamage: 0
        },
        joinDate: new Date().toISOString(),
        lastActive: new Date().toISOString()
    };
    
    users.set(userId, user);
    leaderboard.set(userId, user.arenaPoints);
    return user;
}

// API Routes
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'PixelArena API работает!',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        users: users.size,
        battles: battles.size,
        uptime: process.uptime()
    });
});

// API для получения данных пользователя
app.get('/api/user/:userId', (req, res) => {
    const userId = req.params.userId;
    const user = users.get(userId) || createNewUser(userId, { first_name: 'Игрок' });
    
    // Обновляем время последней активности
    user.lastActive = new Date().toISOString();
    users.set(userId, user);
    
    res.json(user);
});

// API для начала боя
app.post('/api/battle/start', (req, res) => {
    const { userId, opponentType = 'bot', difficulty = 'medium' } = req.body;
    
    const user = users.get(userId);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Проверяем энергию
    if (user.energy < 1) {
        return res.status(400).json({ error: 'Недостаточно энергии' });
    }
    
    // Создаем бой
    const battle = {
        id: battleIdCounter++,
        player1: userId,
        player2: opponentType === 'bot' ? 'bot' : null,
        difficulty: difficulty,
        status: 'active',
        rounds: [],
        currentRound: 1,
        player1HP: user.hero.currentHealth,
        player2HP: getBotHealth(difficulty),
        player1Energy: 3,
        player2Energy: 3,
        moves: [],
        createdAt: new Date().toISOString()
    };
    
    battles.set(battle.id, battle);
    
    // Вычитаем энергию
    user.energy -= 1;
    user.stats.battles += 1;
    users.set(userId, user);
    
    res.json({ 
        success: true, 
        battle: battle,
        user: user
    });
});

// API для выполнения хода
app.post('/api/battle/move', (req, res) => {
    const { battleId, userId, move } = req.body;
    
    const battle = battles.get(parseInt(battleId));
    if (!battle) {
        return res.status(404).json({ error: 'Бой не найден' });
    }
    
    if (battle.status !== 'active') {
        return res.status(400).json({ error: 'Бой уже завершен' });
    }
    
    // Сохраняем ход игрока
    battle.moves.push({
        round: battle.currentRound,
        player: userId,
        move: move,
        timestamp: new Date().toISOString()
    });
    
    // Ход бота
    const botMove = getBotMove(battle.difficulty, battle);
    battle.moves.push({
        round: battle.currentRound,
        player: 'bot',
        move: botMove,
        timestamp: new Date().toISOString()
    });
    
    // Обрабатываем раунд
    const roundResult = processRound(battle, move, botMove);
    battle.rounds.push(roundResult);
    
    // Проверяем конец боя
    if (battle.player1HP <= 0 || battle.player2HP <= 0 || battle.currentRound >= 3) {
        battle.status = 'finished';
        const rewards = calculateBattleRewards(battle, userId);
        updateUserAfterBattle(userId, battle, rewards);
    } else {
        battle.currentRound++;
    }
    
    battles.set(battle.id, battle);
    
    res.json({
        success: true,
        battle: battle,
        roundResult: roundResult
    });
});

// API для завершения боя
app.post('/api/battle/finish', (req, res) => {
    const { battleId, userId } = req.body;
    
    const battle = battles.get(parseInt(battleId));
    if (!battle) {
        return res.status(404).json({ error: 'Бой не найден' });
    }
    
    const user = users.get(userId);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Если бой еще активен, принудительно завершаем
    if (battle.status === 'active') {
        battle.status = 'finished';
        battle.player2HP = 0; // Автоматическая победа
    }
    
    const rewards = calculateBattleRewards(battle, userId);
    updateUserAfterBattle(userId, battle, rewards);
    
    battles.set(battle.id, battle);
    
    res.json({
        success: true,
        battle: battle,
        rewards: rewards,
        user: user
    });
});

// API для магазина
app.post('/api/shop/purchase', (req, res) => {
    const { userId, itemId, currency = 'coins' } = req.body;
    
    const user = users.get(userId);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const shopItem = SHOP_ITEMS[itemId];
    if (!shopItem) {
        return res.status(404).json({ error: 'Товар не найден' });
    }
    
    const price = shopItem.price[currency];
    if (!price) {
        return res.status(400).json({ error: 'Неверная валюта' });
    }
    
    if (user[currency] < price) {
        return res.status(400).json({ error: `Недостаточно ${currency === 'coins' ? 'монет' : 'Stars'}` });
    }
    
    // Списание средств и выдача предмета
    user[currency] -= price;
    
    if (shopItem.type === 'ticket') {
        user.inventory.tickets += shopItem.quantity;
    } else if (shopItem.type === 'boost') {
        user.inventory.boosts.push(shopItem.id);
    } else if (shopItem.type === 'skin') {
        user.inventory.skins.push(shopItem.id);
    }
    
    users.set(userId, user);
    
    res.json({
        success: true,
        item: shopItem,
        user: user
    });
});

// API для рейтинга
app.get('/api/leaderboard', (req, res) => {
    const topPlayers = Array.from(users.values())
        .sort((a, b) => b.arenaPoints - a.arenaPoints)
        .slice(0, 100)
        .map((user, index) => ({
            rank: index + 1,
            username: user.username,
            level: user.level,
            arenaPoints: user.arenaPoints,
            wins: user.stats.wins,
            heroClass: user.hero.class
        }));
    
    res.json({ leaderboard: topPlayers });
});

// Вспомогательные функции
function getBotHealth(difficulty) {
    const health = {
        easy: 80,
        medium: 100,
        hard: 120
    };
    return health[difficulty] || 100;
}

function getBotMove(difficulty, battle) {
    const moves = ['attack', 'defend', 'special'];
    
    // Простая ИИ для бота
    if (battle.player2HP < 30 && Math.random() > 0.7) {
        return 'defend'; // Защита при низком HP
    }
    
    if (battle.player2Energy > 0 && Math.random() > 0.5) {
        return 'special'; // Использование спецприема
    }
    
    return moves[Math.floor(Math.random() * moves.length)];
}

function processRound(battle, playerMove, botMove) {
    const user = users.get(battle.player1);
    const roundResult = {
        round: battle.currentRound,
        playerMove: playerMove,
        botMove: botMove,
        playerDamage: 0,
        botDamage: 0,
        playerEnergyUsed: 0,
        botEnergyUsed: 0
    };
    
    // Расчет урона игрока
    if (playerMove === 'attack') {
        roundResult.playerDamage = calculateDamage(user.hero.attack, botMove === 'defend');
    } else if (playerMove === 'special' && battle.player1Energy > 0) {
        roundResult.playerDamage = calculateDamage(user.hero.attack * 1.5, botMove === 'defend');
        roundResult.playerEnergyUsed = 1;
        battle.player1Energy--;
    }
    
    // Расчет урона бота
    if (botMove === 'attack') {
        roundResult.botDamage = calculateDamage(15, playerMove === 'defend');
    } else if (botMove === 'special' && battle.player2Energy > 0) {
        roundResult.botDamage = calculateDamage(20, playerMove === 'defend');
        roundResult.botEnergyUsed = 1;
        battle.player2Energy--;
    }
    
    // Применение урона
    battle.player1HP = Math.max(0, battle.player1HP - roundResult.botDamage);
    battle.player2HP = Math.max(0, battle.player2HP - roundResult.playerDamage);
    
    // Обновление статистики урона
    if (user) {
        user.stats.totalDamage += roundResult.playerDamage;
        users.set(battle.player1, user);
    }
    
    return roundResult;
}

function calculateDamage(attack, isDefending) {
    const baseDamage = attack;
    const defenseMultiplier = isDefending ? 0.3 : 1.0;
    const randomFactor = 0.8 + Math.random() * 0.4; // 0.8 - 1.2
    
    return Math.max(1, Math.floor(baseDamage * defenseMultiplier * randomFactor));
}

function calculateBattleRewards(battle, userId) {
    const isWin = battle.player2HP <= 0;
    const user = users.get(userId);
    
    const baseCoins = isWin ? 50 : 20;
    const baseExp = isWin ? 25 : 10;
    const baseArenaPoints = isWin ? 15 : 5;
    
    // Бонусы за уровень сложности
    const difficultyBonus = {
        easy: 0.7,
        medium: 1.0,
        hard: 1.5
    };
    
    const multiplier = difficultyBonus[battle.difficulty] || 1.0;
    
    return {
        coins: Math.floor(baseCoins * multiplier),
        experience: Math.floor(baseExp * multiplier),
        arenaPoints: Math.floor(baseArenaPoints * multiplier),
        win: isWin
    };
}

function updateUserAfterBattle(userId, battle, rewards) {
    const user = users.get(userId);
    if (!user) return;
    
    user.coins += rewards.coins;
    user.experience += rewards.experience;
    user.arenaPoints += rewards.arenaPoints;
    
    if (rewards.win) {
        user.stats.wins += 1;
        user.stats.winStreak += 1;
    } else {
        user.stats.losses += 1;
        user.stats.winStreak = 0;
    }
    
    // Проверка повышения уровня
    const expNeeded = user.level * 100;
    if (user.experience >= expNeeded) {
        user.level += 1;
        user.experience = 0;
        user.coins += user.level * 50;
        // Улучшение характеристик героя при повышении уровня
        user.hero.health += 10;
        user.hero.attack += 2;
        user.hero.defense += 1;
    }
    
    // Восстановление энергии (1 каждые 30 минут)
    const now = new Date();
    const lastActive = new Date(user.lastActive);
    const hoursPassed = (now - lastActive) / (1000 * 60 * 60);
    user.energy = Math.min(user.maxEnergy, user.energy + Math.floor(hoursPassed * 2));
    
    user.lastActive = now.toISOString();
    users.set(userId, user);
    leaderboard.set(userId, user.arenaPoints);
}

// Товары в магазине
const SHOP_ITEMS = {
    ticket_pack: {
        id: 'ticket_pack',
        name: '🎫 Набор билетов',
        type: 'ticket',
        quantity: 5,
        price: { stars: 10, coins: 200 },
        description: '5 билетов для участия в боях'
    },
    energy_refill: {
        id: 'energy_refill',
        name: '⚡ Восстановление энергии',
        type: 'boost',
        price: { stars: 5, coins: 100 },
        description: 'Мгновенное восстановление всей энергии'
    },
    attack_boost: {
        id: 'attack_boost',
        name: '💪 Усиление атаки',
        type: 'boost',
        price: { coins: 150 },
        description: '+20% к атаке на 3 боя'
    },
    warrior_skin: {
        id: 'warrior_skin',
        name: '🛡️ Золотой воин',
        type: 'skin',
        price: { stars: 50 },
        description: 'Эксклюзивный скин для воина'
    }
};

// Обработчики команд бота
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    // Создаем или получаем пользователя
    const user = users.get(userId) || createNewUser(userId, msg.from);
    
    const welcomeMessage = `🎮 *Добро пожаловать в PixelArena!*

⚔️ *PixelArena* - это эпическая PvP арена в Telegram!

*Что тебя ждет:*
• 🎯 Динамичные пошаговые бои
• 🏆 Рейтинговая система и сезоны  
• 🛍️ Магазин с крутыми предметами
• 📈 Прокачка героя и улучшения
• 👥 Битвы с друзьями и игроками

*Начни играть прямо сейчас!*`;

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: '🎮 Открыть игру',
                    web_app: { url: `${process.env.WEB_APP_URL || 'https://your-app.onrender.com'}` }
                }
            ],
            [
                {
                    text: '📊 Моя статистика',
                    callback_data: 'stats'
                },
                {
                    text: '🏆 Рейтинг',
                    callback_data: 'leaderboard'
                }
            ]
        ]
    };

    bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    const user = users.get(userId);
    if (!user) {
        bot.sendMessage(chatId, '❌ Сначала начни игру через /start');
        return;
    }
    
    const statsMessage = `📊 *Твоя статистика в PixelArena*

👤 *Игрок:* ${user.username}
⭐ *Уровень:* ${user.level}
🎯 *Опыт:* ${user.experience}/${user.level * 100}

⚔️ *Герой:* ${HERO_CLASSES[user.hero.class].name}
❤️ *Здоровье:* ${user.hero.health}
💪 *Атака:* ${user.hero.attack}
🛡️ *Защита:* ${user.hero.defense}

📈 *Статистика боев:*
• 🏆 Побед: ${user.stats.wins}
• 💀 Поражений: ${user.stats.losses}
• 🔥 Серия побед: ${user.stats.winStreak}
• 💥 Всего урона: ${user.stats.totalDamage}

💰 *Ресурсы:*
• 🪙 Монеты: ${user.coins}
• ⭐ Stars: ${user.stars}
• ⚡ Энергия: ${user.energy}/${user.maxEnergy}
• 🎫 Билеты: ${user.inventory.tickets}`;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const userId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;

    if (data === 'stats') {
        bot.answerCallbackQuery(callbackQuery.id);
        const user = users.get(userId);
        
        if (user) {
            const statsMessage = `🏆 *Твои достижения*

⭐ Уровень ${user.level}
🏅 Очков арены: ${user.arenaPoints}
📊 Место в рейтинге: #${Array.from(leaderboard.values()).sort((a, b) => b - a).indexOf(user.arenaPoints) + 1}

*Продолжай в том же духе!* ⚔️`;
            
            bot.sendMessage(message.chat.id, statsMessage, { parse_mode: 'Markdown' });
        }
    } else if (data === 'leaderboard') {
        bot.answerCallbackQuery(callbackQuery.id);
        showLeaderboard(message.chat.id);
    }
});

function showLeaderboard(chatId) {
    const topPlayers = Array.from(users.values())
        .sort((a, b) => b.arenaPoints - a.arenaPoints)
        .slice(0, 10);
    
    let leaderboardMessage = `🏆 *Топ-10 игроков PixelArena*\\n\\n`;
    
    topPlayers.forEach((player, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
        leaderboardMessage += `${medal} *${index + 1}\\.* ${player.username}\\n`;
        leaderboardMessage += `   ⭐ Ур\\. ${player.level} │ 🏅 ${player.arenaPoints} │ ${HERO_CLASSES[player.hero.class].name}\\n\\n`;
    });
    
    bot.sendMessage(chatId, leaderboardMessage, { 
        parse_mode: 'MarkdownV2',
        reply_markup: {
            inline_keyboard: [[
                { text: '🎮 Играть', web_app: { url: process.env.WEB_APP_URL || 'https://your-app.onrender.com' } }
            ]]
        }
    });
}

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PixelArena сервер запущен на порту ${PORT}`);
    console.log(`📊 Всего пользователей: ${users.size}`);
    console.log(`🤖 Бот готов к работе!`);
    
    // Добавляем тестовых пользователей для демонстрации
    createDemoUsers();
});

function createDemoUsers() {
    const demoUsers = [
        { id: '1001', name: 'DragonSlayer', level: 25, points: 2450, class: 'warrior' },
        { id: '1002', name: 'ShadowNinja', level: 23, points: 2310, class: 'mage' },
        { id: '1003', name: 'MageMaster', level: 22, points: 2285, class: 'mage' },
        { id: '1004', name: 'ArenaChamp', level: 21, points: 2150, class: 'archer' },
        { id: '1005', name: 'PixelWarrior', level: 20, points: 1980, class: 'warrior' }
    ];
    
    demoUsers.forEach(demo => {
        if (!users.has(demo.id)) {
            const user = createNewUser(demo.id, { first_name: demo.name });
            user.level = demo.level;
            user.arenaPoints = demo.points;
            user.hero.class = demo.class;
            user.stats.wins = Math.floor(demo.points / 20);
            user.stats.losses = Math.floor(user.stats.wins * 0.3);
            users.set(demo.id, user);
            leaderboard.set(demo.id, demo.points);
        }
    });
    
    console.log(`👥 Создано ${demoUsers.length} демо-пользователей`);
}
