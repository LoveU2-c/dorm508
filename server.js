const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'dorm508-secret-key-2026';
const DB_PATH = path.join(__dirname, 'dorm508.db');

let db;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==================== 数据库初始化 ====================
async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  saveDB();
  console.log('数据库初始化完成');
}

function saveDB() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// sql.js 查询辅助函数
function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  const result = db.exec('SELECT last_insert_rowid()');
  const lastId = result[0].values[0][0];
  saveDB();
  return { lastInsertRowid: lastId };
}

// ==================== 认证 API ====================
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 2 || password.length < 6) {
        return res.status(400).json({ ok: false, error: '用户名至少2位，密码至少6位' });
    }
    const existing = queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) {
        return res.status(409).json({ ok: false, error: '用户名已存在' });
    }
    const hash = bcrypt.hashSync(password, 10);
    const result = dbRun('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash]);
    const token = jwt.sign({ id: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, user: { id: result.lastInsertRowid, username } });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ ok: false, error: '请输入用户名和密码' });
    }
    const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
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
        const user = queryOne('SELECT id, username, created_at FROM users WHERE id = ?', [decoded.id]);
        if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
        res.json({ ok: true, user });
    } catch {
        res.status(401).json({ ok: false, error: '登录已过期' });
    }
});

// ==================== 留言板 API ====================
app.get('/api/messages', (_req, res) => {
    const messages = queryAll('SELECT id, username, content, created_at FROM messages ORDER BY id DESC');
    res.json({ ok: true, messages });
});

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
    const user = queryOne('SELECT username FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });

    const { content } = req.body;
    if (!content || !content.trim()) {
        return res.status(400).json({ ok: false, error: '留言内容不能为空' });
    }
    dbRun('INSERT INTO messages (username, content) VALUES (?, ?)', [user.username, content.trim()]);
    const lastId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    const msg = queryOne('SELECT * FROM messages WHERE id = ?', [lastId]);
    res.json({ ok: true, message: msg });
});

// ==================== 健康检查 ====================
app.get('/health', (_req, res) => res.status(200).send('OK'));

// ==================== 启动 ====================
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚪 508宿舍后端已启动: http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
});
