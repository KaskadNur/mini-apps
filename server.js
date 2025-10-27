
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация бота
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('✅ Бот инициализирован');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище
const users = new Map();
const battles = new Map();
const leaderboard = new Map();

// Базовые характеристики "Бродяги"
const BASE_STATS = {
    health: 604,
    minAttack: 50,
    maxAttack: 60,
    armor: 2.8,
    speed: 113,
    critChance: 0,
    dodge: 0
};

// Модификаторы классов
const CLASS_MODIFIERS = {
    wanderer: { 
        name: '🚶 Бродяга',
        health: 1.0,
        attack: 1.0,
        armor: 1.0,
        speed: 1.0,
        critChance: 0,
        dodge: 0
    },
    warrior: { 
        name: '⚔️ Воин',
        health: 1.08,
        attack: 1.03,
        armor: 1.05,
        speed: 1.04,
        critChance: 2,
        dodge: 3
    },
    mage: { 
        name: '🔮 Маг',
        health: 1.03,
        attack: 1.1,
        armor: 1.02,
        speed: 1.03,
        critChance: 5,
        dodge: 0
    },
    archer: { 
        name: '🏹 Лучник',
        health: 1.02,
        attack: 1.06,
        armor: 1.02,
        speed: 1.1,
        critChance: 0,
        dodge: 5
    }
};

// Прирост за уровень
const STATS_PER_LEVEL = {
    health: 2.6,
    attack: 2.7,
    armor: 0.3
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
            class: 'wanderer',
            ...calculateStats(1, 'wanderer'),
            hasClassChangeAvailable: false
        },
        stats: {
            pve: { battles: 0, wins: 0, losses: 0, winStreak: 0 },
            pvp: { battles: 0, wins: 0, losses: 0, winStreak: 0 }
        },
        inventory: {
            tickets: 5,
            boosts: [],
            skins: ['default']
        },
        joinDate: new Date().toISOString(),
        lastActive: new Date().toISOString()
    };
    
    users.set(userId, user);
    leaderboard.set(userId, user.arenaPoints);
    return user;
}

// Расчет характеристик
function calculateStats(level, heroClass) {
    const baseStats = { ...BASE_STATS };
    const modifier = CLASS_MODIFIERS[heroClass];
    
    // Прирост от уровня
    baseStats.health += STATS_PER_LEVEL.health * (level - 1);
    baseStats.minAttack += STATS_PER_LEVEL.attack * (level - 1);
    baseStats.maxAttack += STATS_PER_LEVEL.attack * (level - 1);
    baseStats.armor += STATS_PER_LEVEL.armor * (level - 1);
    
    // Прирост скорости (рандомный 0.7-1.68%)
    const speedIncrease = 0.7 + Math.random() * 0.98;
    baseStats.speed = Math.floor(baseStats.speed * (1 + speedIncrease/100));
    
    // Применяем модификаторы класса
    const stats = {
        health: Math.floor(baseStats.health * modifier.health),
        minAttack: Math.floor(baseStats.minAttack * modifier.attack),
        maxAttack: Math.floor(baseStats.maxAttack * modifier.attack),
        armor: Math.floor(baseStats.armor * modifier.armor * 100) / 100,
        speed: Math.floor(baseStats.speed * modifier.speed),
        critChance: modifier.critChance,
        dodge: modifier.dodge,
        attackSpeed: (1.5 * (100 / baseStats.speed)).toFixed(1)
    };
    
    return stats;
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
    
    user.lastActive = new Date().toISOString();
    users.set(userId, user);
    
    res.json(user);
});

// API для смены класса
app.post('/api/user/change-class', (req, res) => {
    const { userId, newClass } = req.body;
    
    const user = users.get(userId);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    if (!user.hero.hasClassChangeAvailable) {
        return res.status(400).json({ error: 'Смена класса недоступна' });
    }
    
    if (!CLASS_MODIFIERS[newClass]) {
        return res.status(400).json({ error: 'Неверный класс' });
    }
    
    // Обновляем класс и характеристики
    user.hero.class = newClass;
    user.hero.hasClassChangeAvailable = false;
    
    const newStats = calculateStats(user.level, newClass);
    Object.assign(user.hero, newStats);
    
    users.set(userId, user);
    
    res.json({
        success: true,
        user: user,
        message: `Класс успешно изменен на ${CLASS_MODIFIERS[newClass].name}`
    });
});

// API для начала боя
app.post('/api/battle/start', (req, res) => {
    const { userId, battleType = 'pve', difficulty = 'medium' } = req.body;
    
    const user = users.get(userId);
    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    if (user.energy < 1) {
        return res.status(400).json({ error: 'Недостаточно энергии' });
    }
    
    // Создаем бой
    const battle = {
        id: Date.now(),
        playerId: userId,
        battleType: battleType,
        difficulty: difficulty,
        status: 'active',
        rounds: [],
        currentRound: 1,
        playerHP: user.hero.health,
        enemyHP: getEnemyHealth(difficulty, user.level),
        createdAt: new Date().toISOString()
    };
    
    // Автоматический бой
    const battleResult = processAutoBattle(battle, user);
    battle.result = battleResult;
    battle.status = 'finished';
    
    // Обновляем статистику пользователя
    updateUserAfterBattle(userId, battleType, battleResult.win);
    
    // Начисляем награды
    const rewards = calculateBattleRewards(battleResult.win, difficulty, user.level);
    user.coins += rewards.coins;
    user.experience += rewards.experience;
    user.arenaPoints += rewards.arenaPoints;
    
    // Проверяем уровень
    const leveledUp = checkLevelUp(user);
    if (leveledUp && user.level === 3 && !user.hero.hasClassChangeAvailable) {
        user.hero.hasClassChangeAvailable = true;
        // Отправляем уведомление в Telegram
        bot.sendMessage(userId, 
            `🎉 Поздравляем! Вы достигли 3 уровня!\n` +
            `Теперь вы можете сменить класс в профиле игры.`
        ).catch(console.error);
    }
    
    user.energy -= 1;
    users.set(userId, user);
    
    res.json({
        success: true,
        battle: battle,
        result: battleResult,
        rewards: rewards,
        user: user,
        leveledUp: leveledUp
    });
});

// Автоматический бой
function processAutoBattle(battle, user) {
    const rounds = [];
    let playerHP = battle.playerHP;
    let enemyHP = battle.enemyHP;
    
    for (let round = 1; round <= 5; round++) {
        if (playerHP <= 0 || enemyHP <= 0) break;
        
        // Ход игрока
        const playerDamage = calculateAutoDamage(user.hero, 'player');
        enemyHP = Math.max(0, enemyHP - playerDamage);
        
        // Ход врага
        let enemyDamage = 0;
        if (enemyHP > 0) {
            enemyDamage = calculateAutoDamage(null, 'enemy', battle.difficulty);
            playerHP = Math.max(0, playerHP - enemyDamage);
        }
        
        rounds.push({
            round: round,
            playerDamage: playerDamage,
            enemyDamage: enemyDamage,
            playerHP: playerHP,
            enemyHP: enemyHP
        });
    }
    
    const win = enemyHP <= 0;
    return { win, rounds, finalPlayerHP: playerHP, finalEnemyHP: enemyHP };
}

function calculateAutoDamage(hero, attacker, difficulty = 'medium') {
    if (attacker === 'player') {
        const baseDamage = Math.random() * (hero.maxAttack - hero.minAttack) + hero.minAttack;
        const crit = Math.random() * 100 < hero.critChance ? 1.5 : 1.0;
        const dodge = Math.random() * 100 < hero.dodge ? 0 : 1;
        return Math.floor(baseDamage * crit * dodge);
    } else {
        // Урон врага
        const difficultyMultiplier = { easy: 0.7, medium: 1.0, hard: 1.3 };
        const baseDamage = 40 * difficultyMultiplier[difficulty];
        return Math.floor(baseDamage + Math.random() * 20);
    }
}

function getEnemyHealth(difficulty, playerLevel) {
    const baseHealth = { easy: 400, medium: 600, hard: 800 };
    return baseHealth[difficulty] * (1 + (playerLevel - 1) * 0.1);
}

function updateUserAfterBattle(userId, battleType, win) {
    const user = users.get(userId);
    if (!user) return;
    
    const stats = user.stats[battleType];
    stats.battles += 1;
    
    if (win) {
        stats.wins += 1;
        stats.winStreak += 1;
    } else {
        stats.losses += 1;
        stats.winStreak = 0;
    }
}

function calculateBattleRewards(win, difficulty, level) {
    const baseCoins = win ? 50 : 20;
    const baseExp = win ? 25 : 10;
    const baseArenaPoints = win ? 15 : 5;
    
    const difficultyBonus = { easy: 0.7, medium: 1.0, hard: 1.5 };
    const multiplier = difficultyBonus[difficulty] || 1.0;
    const levelBonus = 1 + (level - 1) * 0.1;
    
    return {
        coins: Math.floor(baseCoins * multiplier * levelBonus),
        experience: Math.floor(baseExp * multiplier * levelBonus),
        arenaPoints: Math.floor(baseArenaPoints * multiplier * levelBonus)
    };
}

function checkLevelUp(user) {
    const expNeeded = user.level * 100;
    if (user.experience >= expNeeded) {
        user.level += 1;
        user.experience = 0;
        
        // Пересчитываем характеристики с новым уровнем
        const newStats = calculateStats(user.level, user.hero.class);
        Object.assign(user.hero, newStats);
        
        return true;
    }
    return false;
}

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
    if (user[currency] < price) {
        return res.status(400).json({ error: `Недостаточно ${currency === 'coins' ? 'монет' : 'Stars'}` });
    }
    
    user[currency] -= price;
    
    if (shopItem.type === 'ticket') {
        user.inventory.tickets += shopItem.quantity;
    } else if (shopItem.type === 'boost') {
        user.inventory.boosts.push(shopItem.id);
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
            heroClass: user.hero.class,
            className: CLASS_MODIFIERS[user.hero.class].name
        }));
    
    res.json({ leaderboard: topPlayers });
});

// Товары в магазине
const SHOP_ITEMS = {
    ticket_pack: {
        id: 'ticket_pack',
        name: '🎫 Набор билетов',
        type: 'ticket',
        quantity: 5,
        price: { stars: 10, coins: 200 }
    },
    energy_refill: {
        id: 'energy_refill',
        name: '⚡ Восстановление энергии',
        type: 'boost',
        price: { stars: 5, coins: 100 }
    },
    attack_boost: {
        id: 'attack_boost',
        name: '💪 Усиление атаки',
        type: 'boost',
        price: { coins: 150 }
    }
};

// Команды бота
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    const user = users.get(userId) || createNewUser(userId, msg.from);
    
    const welcomeMessage = `🎮 *Добро пожаловать в PixelArena!*

⚔️ *Новая система классов и характеристик!*

• 🚶 Начни как *Бродяга*
• ⭐ На 3 уровне откроется смена класса
• ⚔️ Выбери: *Воин*, *Маг* или *Лучник*
• 📊 Уникальные характеристики для каждого класса
• 🤖 *Автоматические бои* - наблюдай за сражением!

*Начни свое приключение!*`;

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: '🎮 Открыть PixelArena',
                    web_app: { url: process.env.WEB_APP_URL }
                }
            ],
            [
                {
                    text: '📊 Статистика',
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
    
    const statsMessage = `📊 *Твоя статистика*

👤 *${user.username}*
⭐ *Уровень:* ${user.level}
🎯 *Опыт:* ${user.experience}/${user.level * 100}
🏅 *Класс:* ${CLASS_MODIFIERS[user.hero.class].name}

*PVE:*
• 🏆 Побед: ${user.stats.pve.wins}
• 💀 Поражений: ${user.stats.pve.losses}
• 🔥 Серия: ${user.stats.pve.winStreak}

*PVP:*
• 🏆 Побед: ${user.stats.pvp.wins}
• 💀 Поражений: ${user.stats.pvp.losses}
• 🔥 Серия: ${user.stats.pvp.winStreak}

💰 *Ресурсы:*
• 🪙 Монеты: ${user.coins}
• ⭐ Stars: ${user.stars}
• ⚡ Энергия: ${user.energy}/${user.maxEnergy}`;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data;

    if (data === 'stats') {
        bot.answerCallbackQuery(callbackQuery.id);
        // Статистика уже обрабатывается в /stats
    } else if (data === 'leaderboard') {
        bot.answerCallbackQuery(callbackQuery.id);
        showLeaderboard(message.chat.id);
    }
});

function showLeaderboard(chatId) {
    const topPlayers = Array.from(users.values())
        .sort((a, b) => b.arenaPoints - a.arenaPoints)
        .slice(0, 10);
    
    let leaderboardMessage = `🏆 *Топ-10 игроков PixelArena*\n\n`;
    
    topPlayers.forEach((player, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔸';
        leaderboardMessage += `${medal} *${index + 1}.* ${player.username}\n`;
        leaderboardMessage += `   ⭐ Ур. ${player.level} │ ${CLASS_MODIFIERS[player.hero.class].name} │ 🏅 ${player.arenaPoints}\n\n`;
    });
    
    bot.sendMessage(chatId, leaderboardMessage, { 
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[
                { text: '🎮 Играть', web_app: { url: process.env.WEB_APP_URL } }
            ]]
        }
    });
}

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 PixelArena сервер запущен на порту ${PORT}`);
    console.log(`📊 Всего пользователей: ${users.size}`);
    
    // Демо-пользователи
    createDemoUsers();
});

function createDemoUsers() {
    const demoUsers = [
        { id: '1001', name: 'DragonSlayer', level: 25, points: 2450, class: 'warrior' },
        { id: '1002', name: 'ShadowNinja', level: 23, points: 2310, class: 'mage' },
        { id: '1003', name: 'MageMaster', level: 22, points: 2285, class: 'archer' }
    ];
    
    demoUsers.forEach(demo => {
        if (!users.has(demo.id)) {
            const user = createNewUser(demo.id, { first_name: demo.name });
            user.level = demo.level;
            user.arenaPoints = demo.points;
            user.hero.class = demo.class;
            user.stats.pve.wins = Math.floor(demo.points / 15);
            user.stats.pvp.wins = Math.floor(demo.points / 20);
            users.set(demo.id, user);
        }
    });
}
