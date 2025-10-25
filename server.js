const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Токен бота от @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '7591449691:AAGEsdfrNCgijjCgDwLPRaZ04rlU_UDxJys';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Хранилище для пользователей и маркета (в продакшене используйте БД)
const users = new Map();
const marketItems = new Map();
let itemIdCounter = 1000;

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

// API для получения предметов маркета
app.get('/api/market/items', (req, res) => {
    const items = Array.from(marketItems.values())
        .filter(item => !item.sold)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50); // Ограничиваем количество возвращаемых предметов
    
    res.json(items);
});

// API для выставления предмета на маркет
app.post('/api/market/sell', (req, res) => {
    const { userId, item, price } = req.body;
    
    let userData = users.get(userId);
    if (!userData) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    // Проверяем, есть ли предмет у пользователя
    const itemIndex = userData.inventory.findIndex(invItem => invItem.id === item.id);
    if (itemIndex === -1) {
        return res.status(400).json({ error: 'Item not found in inventory' });
    }
    
    // Удаляем предмет из инвентаря
    const [removedItem] = userData.inventory.splice(itemIndex, 1);
    
    // Добавляем предмет на маркет
    const marketItem = {
        id: itemIdCounter++,
        item: removedItem,
        sellerId: userId,
        sellerName: userData.username || `User${userId}`,
        price: parseInt(price),
        createdAt: new Date().toISOString(),
        sold: false
    };
    
    marketItems.set(marketItem.id, marketItem);
    users.set(userId, userData);
    
    res.json({ success: true, marketItem });
});

// API для покупки предмета
app.post('/api/market/buy', (req, res) => {
    const { userId, itemId } = req.body;
    
    const marketItem = marketItems.get(parseInt(itemId));
    if (!marketItem || marketItem.sold) {
        return res.status(404).json({ error: 'Item not found or already sold' });
    }
    
    let buyerData = users.get(userId);
    let sellerData = users.get(marketItem.sellerId);
    
    if (!buyerData || !sellerData) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    if (buyerData.balance < marketItem.price) {
        return res.status(400).json({ error: 'Insufficient balance' });
    }
    
    // Вычисляем комиссию (5%)
    const commission = Math.floor(marketItem.price * 0.05);
    const sellerEarnings = marketItem.price - commission;
    
    // Переводим средства
    buyerData.balance -= marketItem.price;
    sellerData.balance += sellerEarnings;
    
    // Передаем предмет
    buyerData.inventory.push(marketItem.item);
    
    // Помечаем предмет как проданный
    marketItem.sold = true;
    marketItem.buyerId = userId;
    marketItem.soldAt = new Date().toISOString();
    
    // Сохраняем изменения
    users.set(userId, buyerData);
    users.set(marketItem.sellerId, sellerData);
    marketItems.set(marketItem.id, marketItem);
    
    res.json({ 
        success: true, 
        item: marketItem.item,
        price: marketItem.price,
        commission: commission
    });
});

// API для быстрой продажи
app.post('/api/market/quick-sell', (req, res) => {
    const { userId, itemId } = req.body;
    
    let userData = users.get(userId);
    if (!userData) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const itemIndex = userData.inventory.findIndex(item => item.id === itemId);
    if (itemIndex === -1) {
        return res.status(400).json({ error: 'Item not found in inventory' });
    }
    
    const item = userData.inventory[itemIndex];
    const quickSellPrice = Math.floor(item.basePrice * 0.8); // 80% от базовой цены
    
    // Удаляем предмет и добавляем деньги
    userData.inventory.splice(itemIndex, 1);
    userData.balance += quickSellPrice;
    
    users.set(userId, userData);
    
    res.json({ 
        success: true, 
        price: quickSellPrice,
        balance: userData.balance
    });
});

function createNewUser(userId) {
    const userData = {
        userId: userId,
        balance: 100, // Начальный баланс
        totalEarned: 0,
        referrals: [],
        joinDate: new Date().toISOString(),
        referralCode: generateReferralCode(),
        inventory: [
            { 
                id: 1, 
                type: 'sticker', 
                name: 'Стикерпак Premium', 
                rarity: 'rare', 
                image: '🎨', 
                basePrice: 50 
            },
            { 
                id: 2, 
                type: 'boost', 
                name: 'Буст x2', 
                rarity: 'uncommon', 
                image: '💎', 
                basePrice: 30 
            }
        ]
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
    const referralCode = match[1];
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
    
    if (referralCode) {
        message += `\n\n👥 Вы пришли по приглашению друга!`;
        // Здесь можно обработать реферальный код
    }
    
    bot.sendMessage(chatId, message, {
        reply_markup: keyboard
    });
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Web App доступен: https://telegram-hello-app.onrender.com`);
    
    // Создаем несколько тестовых предметов на маркете
    initializeTestMarketItems();
});

function initializeTestMarketItems() {
    const testItems = [
        {
            id: itemIdCounter++,
            item: { 
                id: 1001, 
                type: 'sticker', 
                name: 'Стикерпак "Galaxy"', 
                rarity: 'epic', 
                image: '🌌', 
                basePrice: 80 
            },
            sellerId: 'test_user_1',
            sellerName: 'GalaxyTrader',
            price: 75,
            createdAt: new Date().toISOString(),
            sold: false
        },
        {
            id: itemIdCounter++,
            item: { 
                id: 1002, 
                type: 'avatar', 
                name: 'Анимационная рамка', 
                rarity: 'rare', 
                image: '✨', 
                basePrice: 120 
            },
            sellerId: 'test_user_2',
            sellerName: 'FrameMaster',
            price: 110,
            createdAt: new Date().toISOString(),
            sold: false
        },
        {
            id: itemIdCounter++,
            item: { 
                id: 1003, 
                type: 'boost', 
                name: 'Буст x3 на 48ч', 
                rarity: 'legendary', 
                image: '🚀', 
                basePrice: 150 
            },
            sellerId: 'test_user_3',
            sellerName: 'BoostSeller',
            price: 140,
            createdAt: new Date().toISOString(),
            sold: false
        }
    ];
    
    testItems.forEach(item => {
        marketItems.set(item.id, item);
    });
    
    console.log('✅ Тестовые предметы добавлены на маркет');
}
