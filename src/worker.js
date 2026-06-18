import { Hono } from 'hono';
import { cors } from 'hono/cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = new Hono();

app.use('*', cors());

function getJwtSecret(c) {
  if (!c.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }
  return c.env.JWT_SECRET;
}

// ==================== 健康检查 ====================
app.get('/health', (c) => c.text('OK'));

// ==================== 认证 API ====================
app.post('/api/register', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password || username.length < 2 || password.length < 6) {
    return c.json({ ok: false, error: '用户名至少2位，密码至少6位' }, 400);
  }
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existing) {
    return c.json({ ok: false, error: '用户名已存在' }, 409);
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = await c.env.DB.prepare('INSERT INTO users (username, password) VALUES (?, ?)').bind(username, hash).run();
  const id = result.meta.last_row_id;
  const token = jwt.sign({ id }, getJwtSecret(c), { expiresIn: '7d' });
  return c.json({ ok: true, token, user: { id, username } });
});

app.post('/api/login', async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) {
    return c.json({ ok: false, error: '请输入用户名和密码' }, 400);
  }
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return c.json({ ok: false, error: '用户名或密码错误' }, 401);
  }
  const token = jwt.sign({ id: user.id }, getJwtSecret(c), { expiresIn: '7d' });
  return c.json({ ok: true, token, user: { id: user.id, username: user.username } });
});

app.get('/api/me', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ ok: false, error: '未登录' }, 401);
  }
  try {
    const decoded = jwt.verify(auth.slice(7), getJwtSecret(c));
    const user = await c.env.DB.prepare('SELECT id, username, created_at FROM users WHERE id = ?').bind(decoded.id).first();
    if (!user) return c.json({ ok: false, error: '用户不存在' }, 404);
    return c.json({ ok: true, user });
  } catch {
    return c.json({ ok: false, error: '登录已过期' }, 401);
  }
});

// ==================== 留言板 API ====================
app.get('/api/messages', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, username, content, created_at FROM messages ORDER BY id DESC').all();
  return c.json({ ok: true, messages: results });
});

app.post('/api/messages', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ ok: false, error: '请先登录再留言' }, 401);
  }
  let userId;
  try {
    const decoded = jwt.verify(auth.slice(7), getJwtSecret(c));
    userId = decoded.id;
  } catch {
    return c.json({ ok: false, error: '登录已过期' }, 401);
  }
  const user = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first();
  if (!user) return c.json({ ok: false, error: '用户不存在' }, 404);

  const { content } = await c.req.json();
  if (!content || !content.trim()) {
    return c.json({ ok: false, error: '留言内容不能为空' }, 400);
  }
  const result = await c.env.DB.prepare('INSERT INTO messages (username, content) VALUES (?, ?)').bind(user.username, content.trim()).run();
  const msg = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(result.meta.last_row_id).first();
  return c.json({ ok: true, message: msg });
});

// ==================== 静态文件（回退到 index.html） ====================
app.get('/*', async (c) => {
  const path = new URL(c.req.url).pathname;
  const blockedPaths = [
    '/.assetsignore',
    '/.gitignore',
    '/package.json',
    '/package-lock.json',
    '/railway.json',
    '/server.js',
    '/wrangler.toml',
  ];
  const blockedPrefixes = ['/.git/', '/.wrangler/', '/migrations/', '/src/'];

  if (blockedPaths.includes(path) || blockedPrefixes.some((prefix) => path.startsWith(prefix))) {
    return c.notFound();
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
