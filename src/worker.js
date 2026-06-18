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

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ==================== 健康检查 ====================
app.get('/health', (c) => c.text('OK'));

// ==================== 认证 API ====================
app.post('/api/register', async (c) => {
  const body = await c.req.json();
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (username.length < 2 || username.length > 30) {
    return c.json({ ok: false, error: '用户名需为2到30位' }, 400);
  }
  if (username.includes('@')) {
    return c.json({ ok: false, error: '用户名不能包含@符号' }, 400);
  }
  if (!isValidEmail(email)) {
    return c.json({ ok: false, error: '请输入有效的邮箱地址' }, 400);
  }
  if (password.length < 6 || password.length > 128) {
    return c.json({ ok: false, error: '密码需为6到128位' }, 400);
  }

  const existingUsername = await c.env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(username).first();
  if (existingUsername) {
    return c.json({ ok: false, error: '用户名已存在' }, 409);
  }

  const existingEmail = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? OR username = ?'
  ).bind(email, email).first();
  if (existingEmail) {
    return c.json({ ok: false, error: '该邮箱已注册' }, 409);
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = await c.env.DB.prepare(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
  ).bind(username, email, hash).run();
  const id = result.meta.last_row_id;
  const token = jwt.sign({ id }, getJwtSecret(c), { expiresIn: '7d' });

  return c.json({ ok: true, token, user: { id, username, email } });
});

app.post('/api/login', async (c) => {
  const body = await c.req.json();
  // username 字段作为兼容旧版前端的后备值。
  const identifier = typeof body.identifier === 'string'
    ? body.identifier.trim()
    : (typeof body.username === 'string' ? body.username.trim() : '');
  const password = typeof body.password === 'string' ? body.password : '';

  if (!identifier || !password) {
    return c.json({ ok: false, error: '请输入用户名或邮箱和密码' }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ? OR email = ?'
  ).bind(identifier, identifier.toLowerCase()).first();
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return c.json({ ok: false, error: '用户名、邮箱或密码错误' }, 401);
  }

  const token = jwt.sign({ id: user.id }, getJwtSecret(c), { expiresIn: '7d' });
  return c.json({
    ok: true,
    token,
    user: { id: user.id, username: user.username, email: user.email || null }
  });
});

app.get('/api/me', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ ok: false, error: '未登录' }, 401);
  }

  try {
    const decoded = jwt.verify(auth.slice(7), getJwtSecret(c));
    const user = await c.env.DB.prepare(
      'SELECT id, username, email, created_at FROM users WHERE id = ?'
    ).bind(decoded.id).first();
    if (!user) {
      return c.json({ ok: false, error: '用户不存在' }, 404);
    }
    return c.json({ ok: true, user });
  } catch {
    return c.json({ ok: false, error: '登录已过期' }, 401);
  }
});

// ==================== 留言板 API ====================
app.get('/api/messages', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, user_id, username, content, created_at FROM messages ORDER BY id DESC'
  ).all();
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

  const user = await c.env.DB.prepare(
    'SELECT username FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!user) {
    return c.json({ ok: false, error: '用户不存在' }, 404);
  }

  const { content } = await c.req.json();
  if (!content || !content.trim()) {
    return c.json({ ok: false, error: '留言内容不能为空' }, 400);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)'
  ).bind(userId, user.username, content.trim()).run();
  const message = await c.env.DB.prepare(
    'SELECT * FROM messages WHERE id = ?'
  ).bind(result.meta.last_row_id).first();

  return c.json({ ok: true, message });
});

app.delete('/api/messages/:id', async (c) => {
  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return c.json({ ok: false, error: '请先登录' }, 401);
  }

  let userId;
  try {
    const decoded = jwt.verify(auth.slice(7), getJwtSecret(c));
    userId = decoded.id;
  } catch {
    return c.json({ ok: false, error: '登录已过期' }, 401);
  }

  const messageId = Number(c.req.param('id'));
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return c.json({ ok: false, error: '留言不存在' }, 404);
  }

  const message = await c.env.DB.prepare(
    'SELECT user_id FROM messages WHERE id = ?'
  ).bind(messageId).first();
  if (!message) {
    return c.json({ ok: false, error: '留言不存在' }, 404);
  }
  if (Number(message.user_id) !== Number(userId)) {
    return c.json({ ok: false, error: '只能删除自己的留言' }, 403);
  }

  await c.env.DB.prepare(
    'DELETE FROM messages WHERE id = ? AND user_id = ?'
  ).bind(messageId, userId).run();
  return c.json({ ok: true });
});

// ==================== 静态文件 ====================
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
