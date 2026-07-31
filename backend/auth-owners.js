const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const ACCOUNTS = [
  { id: 'admin',  name: 'Администратор',   role: 'admin', password: 'admin' },
  { id: 'user1',  name: 'Пользователь 1',  role: 'user',  password: 'user1' },
  { id: 'user2',  name: 'Пользователь 2',  role: 'user',  password: 'user2' },
  { id: 'user3',  name: 'Пользователь 3',  role: 'user',  password: 'user3' },
  { id: 'user4',  name: 'Пользователь 4',  role: 'user',  password: 'user4' },
  { id: 'user5',  name: 'Пользователь 5',  role: 'user',  password: 'user5' },
  { id: 'user6',  name: 'Пользователь 6',  role: 'user',  password: 'user6' },
  { id: 'user7',  name: 'Пользователь 7',  role: 'user',  password: 'user7' },
  { id: 'user8',  name: 'Пользователь 8',  role: 'user',  password: 'user8' },
  { id: 'user9',  name: 'Пользователь 9',  role: 'user',  password: 'user9' },
  { id: 'user10', name: 'Пользователь 10', role: 'user',  password: 'user10' },
];

const store = { owners: {}, tokens: {} };

function userByToken(token) {
  if (!token) return null;
  const userId = store.tokens[token];
  if (!userId) return null;
  return ACCOUNTS.find(a => a.id === userId) || null;
}

function publicUsers() {
  const map = {};
  ACCOUNTS.forEach(a => { map[a.id] = { name: a.name, role: a.role }; });
  return map;
}

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  const acc = ACCOUNTS.find(a => a.password === password);
  if (!acc) return res.json({ success: false, error: 'Неверный пароль' });
  const token = crypto.randomBytes(24).toString('hex');
  store.tokens[token] = acc.id;
  res.json({ success: true, token, user: { id: acc.id, name: acc.name, role: acc.role } });
});

router.post('/logout', (req, res) => {
  const { token } = req.body || {};
  if (token && store.tokens[token]) { delete store.tokens[token]; }
  res.json({ success: true });
});

router.get('/me', (req, res) => {
  const user = userByToken(req.query.token);
  if (!user) return res.json({ success: false });
  res.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
});

router.get('/owners', (req, res) => {
  res.json({ success: true, owners: store.owners, users: publicUsers() });
});

router.post('/set-owner', (req, res) => {
  const { token, receiptId } = req.body || {};
  const user = userByToken(token);
  if (!user) return res.status(401).json({ success: false, error: 'Не авторизован' });
  if (receiptId === undefined || receiptId === null) {
    return res.json({ success: false, error: 'Не указан receiptId' });
  }
  store.owners[String(receiptId)] = user.id;
  res.json({ success: true });
});

function extractToken(req) {
  const h = req.headers && req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  if (req.body && req.body.token) return req.body.token;
  if (req.query && req.query.token) return req.query.token;
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ success: false, error: 'Требуется авторизация' });
  const user = userByToken(token);
  if (!user) return res.status(401).json({ success: false, error: 'Требуется авторизация' });
  req.userId = user.id;
  req.userRole = user.role;
  req.userName = user.name;
  req.user = { id: user.id, name: user.name, role: user.role };
  next();
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ success: false, error: 'Требуется роль администратора' });
  }
  next();
}

function setOwner(receiptId, userId) {
  store.owners[String(receiptId)] = userId;
}

function filterOwned(arr, userId) {
  return Array.isArray(arr) ? arr.filter(r => store.owners[String(r.id)] === userId) : arr;
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.setOwner = setOwner;
module.exports.filterOwned = filterOwned;
module.exports.userByToken = userByToken;
