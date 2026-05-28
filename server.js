const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'dorm508-secret-key-2026';

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 数据库初始化
const db = new Database(path.join(__dirname, 'dorm508.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

// ==================== 认证 API ====================

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 2 || password.length < 6) {
        return res.status(400).json({ ok: false, error: '用户名至少2位，密码至少6位' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
        return res.status(409).json({ ok: false, error: '用户名已存在' });
    }
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
    const token = jwt.sign({ id: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, user: { id: result.lastInsertRowid, username } });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ ok: false, error: '请输入用户名和密码' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ ok: false, error: '用户名或密码错误' });
    }
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, user: { id: user.id, username: user.username } });
});

app.get('/api/me', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ ok: false, error: '未登录' });
    }
    try {
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(decoded.id);
        if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
        res.json({ ok: true, user });
    } catch {
        res.status(401).json({ ok: false, error: '登录已过期' });
    }
});

// ==================== 留言板 API ====================

// 获取所有留言
app.get('/api/messages', (_req, res) => {
    const messages = db.prepare('SELECT id, username, content, created_at FROM messages ORDER BY id DESC').all();
    res.json({ ok: true, messages });
});

// 发表留言（需登录）
app.post('/api/messages', (req, res) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ ok: false, error: '请先登录再留言' });
    }
    let userId;
    try {
        const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
        userId = decoded.id;
    } catch {
        return res.status(401).json({ ok: false, error: '登录已过期' });
    }
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });

    const { content } = req.body;
    if (!content || !content.trim()) {
        return res.status(400).json({ ok: false, error: '留言内容不能为空' });
    }
    const result = db.prepare('INSERT INTO messages (username, content) VALUES (?, ?)').run(user.username, content.trim());
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
    res.json({ ok: true, message: msg });
});

app.listen(PORT, () => {
    console.log(`🚪 508宿舍后端已启动: http://localhost:${PORT}`);
    console.log('   POST /api/register   — 注册');
    console.log('   POST /api/login      — 登录');
    console.log('   GET  /api/me         — 当前用户');
    console.log('   GET  /api/messages   — 留言列表');
    console.log('   POST /api/messages   — 发表留言');
});
