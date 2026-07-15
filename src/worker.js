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

function getBearerToken(c) {
  const auth = c.req.header('Authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : '';
}

function verifyToken(c) {
  const token = getBearerToken(c);
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret(c));
  } catch {
    return null;
  }
}

function verifyAdminToken(c) {
  const decoded = verifyToken(c);
  return decoded?.admin === true ? decoded : null;
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

// ==================== 管理员 API ====================
app.post('/api/admin/login', async (c) => {
  const decoded = verifyToken(c);
  if (!decoded) {
    return c.json({ ok: false, error: '请先登录普通账号' }, 401);
  }

  const user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE id = ?'
  ).bind(decoded.id).first();
  if (!user) {
    return c.json({ ok: false, error: '用户不存在' }, 404);
  }
  if (!c.env.ADMIN_PASSWORD) {
    return c.json({ ok: false, error: '管理员功能尚未配置' }, 503);
  }

  const body = await c.req.json();
  const password = typeof body.password === 'string' ? body.password : '';
  if (password !== c.env.ADMIN_PASSWORD) {
    return c.json({ ok: false, error: '管理员密码错误' }, 403);
  }

  const adminToken = jwt.sign(
    { id: user.id, admin: true },
    getJwtSecret(c),
    { expiresIn: '8h' }
  );
  return c.json({ ok: true, adminToken });
});

app.get('/api/admin/me', async (c) => {
  if (!verifyAdminToken(c)) {
    return c.json({ ok: false, error: '管理员登录已过期' }, 401);
  }
  return c.json({ ok: true });
});

app.get('/api/admin/users', async (c) => {
  if (!verifyAdminToken(c)) {
    return c.json({ ok: false, error: '需要管理员权限' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
      users.id,
      users.username,
      users.email,
      users.created_at,
      COUNT(DISTINCT messages.id) AS message_count,
      COUNT(DISTINCT photos.id) AS photo_count
    FROM users
    LEFT JOIN messages ON messages.user_id = users.id
    LEFT JOIN photos ON photos.user_id = users.id
    GROUP BY users.id
    ORDER BY users.id DESC`
  ).all();

  return c.json({
    ok: true,
    users: results.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email || null,
      created_at: user.created_at,
      message_count: Number(user.message_count || 0),
      photo_count: Number(user.photo_count || 0),
    })),
  });
});

app.delete('/api/admin/users/:id', async (c) => {
  const admin = verifyAdminToken(c);
  if (!admin) {
    return c.json({ ok: false, error: '需要管理员权限' }, 403);
  }

  const userId = Number(c.req.param('id'));
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.json({ ok: false, error: '用户不存在' }, 404);
  }
  if (Number(admin.id) === userId) {
    return c.json({ ok: false, error: '不能删除当前管理员账号' }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!user) {
    return c.json({ ok: false, error: '用户不存在' }, 404);
  }

  await c.env.DB.prepare(
    'DELETE FROM messages WHERE user_id = ?'
  ).bind(userId).run();
  await c.env.DB.prepare(
    'DELETE FROM photos WHERE user_id = ?'
  ).bind(userId).run();
  await c.env.DB.prepare(
    'DELETE FROM users WHERE id = ?'
  ).bind(userId).run();

  return c.json({ ok: true });
});

// ==================== 照片墙 API ====================
app.get('/api/photos', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, filename, mime_type, created_at FROM photos ORDER BY id DESC'
  ).all();
  return c.json({
    ok: true,
    photos: results.map((photo) => ({
      ...photo,
      url: `/api/photos/${photo.id}/image`,
    })),
  });
});

app.get('/api/photos/:id/image', async (c) => {
  const photoId = Number(c.req.param('id'));
  if (!Number.isInteger(photoId) || photoId <= 0) {
    return c.notFound();
  }

  const photo = await c.env.DB.prepare(
    'SELECT mime_type, image_data FROM photos WHERE id = ?'
  ).bind(photoId).first();
  if (!photo) {
    return c.notFound();
  }

  return new Response(photo.image_data, {
    headers: {
      'Content-Type': photo.mime_type,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

app.post('/api/photos', async (c) => {
  const decoded = verifyAdminToken(c);
  if (!decoded) {
    return c.json({ ok: false, error: '需要管理员权限' }, 403);
  }

  const form = await c.req.formData();
  const file = form.get('photo');
  if (!(file instanceof File)) {
    return c.json({ ok: false, error: '请选择照片' }, 400);
  }

  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowedTypes.has(file.type)) {
    return c.json({ ok: false, error: '仅支持 JPG、PNG 或 WebP 图片' }, 400);
  }
  if (file.size <= 0 || file.size > 1_500_000) {
    return c.json({ ok: false, error: '图片压缩后需小于 1.5MB' }, 400);
  }

  const imageData = await file.arrayBuffer();
  const filename = file.name.slice(0, 120) || 'photo.jpg';
  const result = await c.env.DB.prepare(
    'INSERT INTO photos (user_id, filename, mime_type, image_data) VALUES (?, ?, ?, ?)'
  ).bind(decoded.id, filename, file.type, imageData).run();
  const id = Number(result.meta.last_row_id);

  return c.json({
    ok: true,
    photo: { id, filename, mime_type: file.type, url: `/api/photos/${id}/image` },
  });
});

app.delete('/api/photos/:id', async (c) => {
  if (!verifyAdminToken(c)) {
    return c.json({ ok: false, error: '需要管理员权限' }, 403);
  }

  const photoId = Number(c.req.param('id'));
  if (!Number.isInteger(photoId) || photoId <= 0) {
    return c.json({ ok: false, error: '照片不存在' }, 404);
  }

  const photo = await c.env.DB.prepare(
    'SELECT id FROM photos WHERE id = ?'
  ).bind(photoId).first();
  if (!photo) {
    return c.json({ ok: false, error: '照片不存在' }, 404);
  }

  await c.env.DB.prepare(
    'DELETE FROM photos WHERE id = ?'
  ).bind(photoId).run();
  return c.json({ ok: true });
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
app.get('/admin', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/admin.html';
  return c.env.ASSETS.fetch(new Request(url, c.req.raw));
});

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
