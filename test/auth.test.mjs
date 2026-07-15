import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

async function loadWorker() {
  let source = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  for (const specifier of ['hono', 'hono/cors', 'bcryptjs', 'jsonwebtoken']) {
    source = source.replace(
      `from '${specifier}'`,
      `from '${import.meta.resolve(specifier)}'`
    );
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return (await import(url)).default;
}

class D1DatabaseMock {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    const statement = this.db.prepare(sql);
    let values = [];
    return {
      bind(...params) {
        values = params;
        return this;
      },
      async first() {
        return statement.get(...values) ?? null;
      },
      async all() {
        return { results: statement.all(...values) };
      },
      async run() {
        const result = statement.run(...values);
        return { meta: { last_row_id: Number(result.lastInsertRowid) } };
      },
    };
  }
}

const app = await loadWorker();

async function createEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  db.exec(await readFile(new URL('../migrations/0002_add_user_email.sql', import.meta.url), 'utf8'));
  db.exec(await readFile(new URL('../migrations/0003_add_message_owner.sql', import.meta.url), 'utf8'));
  db.exec(await readFile(new URL('../migrations/0004_add_photos.sql', import.meta.url), 'utf8'));
  return {
    db,
    env: {
      DB: new D1DatabaseMock(db),
      JWT_SECRET: 'test-secret',
      ADMIN_PASSWORD: 'test-admin-password',
      ASSETS: { fetch: () => new Response('not found', { status: 404 }) },
    },
  };
}

function post(path, body, env) {
  return app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

function authenticatedRequest(path, method, token, env, body) {
  const headers = { 'Authorization': `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
}

test('registers with a normalized unique email and logs in both ways', async () => {
  const { db, env } = await createEnv();

  const registerResponse = await post('/api/register', {
    username: 'tester',
    email: ' Test@Example.COM ',
    password: 'secret123',
  }, env);
  assert.equal(registerResponse.status, 200);
  const registration = await registerResponse.json();
  assert.equal(registration.user.email, 'test@example.com');

  const emailLogin = await post('/api/login', {
    identifier: 'TEST@EXAMPLE.COM',
    password: 'secret123',
  }, env);
  assert.equal(emailLogin.status, 200);

  const usernameLogin = await post('/api/login', {
    identifier: 'tester',
    password: 'secret123',
  }, env);
  assert.equal(usernameLogin.status, 200);

  const duplicateResponse = await post('/api/register', {
    username: 'tester2',
    email: 'test@example.com',
    password: 'secret123',
  }, env);
  assert.equal(duplicateResponse.status, 409);

  db.close();
});

test('keeps legacy users able to log in by username', async () => {
  const { db, env } = await createEnv();
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(
    'legacy',
    bcrypt.hashSync('secret123', 10)
  );

  const response = await post('/api/login', {
    identifier: 'legacy',
    password: 'secret123',
  }, env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.user.email, null);

  db.close();
});

test('rejects invalid email addresses and ambiguous usernames', async () => {
  const { db, env } = await createEnv();

  const invalidEmail = await post('/api/register', {
    username: 'tester',
    email: 'not-an-email',
    password: 'secret123',
  }, env);
  assert.equal(invalidEmail.status, 400);

  const ambiguousUsername = await post('/api/register', {
    username: 'name@example.com',
    email: 'other@example.com',
    password: 'secret123',
  }, env);
  assert.equal(ambiguousUsername.status, 400);

  db.close();
});

test('allows users to delete only their own messages', async () => {
  const { db, env } = await createEnv();

  const ownerRegistration = await post('/api/register', {
    username: 'owner',
    email: 'owner@example.com',
    password: 'secret123',
  }, env);
  const owner = await ownerRegistration.json();

  const otherRegistration = await post('/api/register', {
    username: 'other',
    email: 'other@example.com',
    password: 'secret123',
  }, env);
  const other = await otherRegistration.json();

  const createResponse = await authenticatedRequest(
    '/api/messages',
    'POST',
    owner.token,
    env,
    { content: 'owned message' }
  );
  assert.equal(createResponse.status, 200);
  const created = await createResponse.json();
  assert.equal(Number(created.message.user_id), Number(owner.user.id));

  const forbiddenResponse = await authenticatedRequest(
    `/api/messages/${created.message.id}`,
    'DELETE',
    other.token,
    env
  );
  assert.equal(forbiddenResponse.status, 403);

  const deleteResponse = await authenticatedRequest(
    `/api/messages/${created.message.id}`,
    'DELETE',
    owner.token,
    env
  );
  assert.equal(deleteResponse.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);

  db.close();
});

test('requires a signed-in user and the correct password for admin access', async () => {
  const { db, env } = await createEnv();

  const anonymous = await post('/api/admin/login', {
    password: 'test-admin-password',
  }, env);
  assert.equal(anonymous.status, 401);

  const registrationResponse = await post('/api/register', {
    username: 'admin-user',
    email: 'admin@example.com',
    password: 'secret123',
  }, env);
  const registration = await registrationResponse.json();

  const wrongPassword = await authenticatedRequest(
    '/api/admin/login',
    'POST',
    registration.token,
    env,
    { password: 'wrong-password' }
  );
  assert.equal(wrongPassword.status, 403);

  const success = await authenticatedRequest(
    '/api/admin/login',
    'POST',
    registration.token,
    env,
    { password: 'test-admin-password' }
  );
  assert.equal(success.status, 200);
  const data = await success.json();
  assert.ok(data.adminToken);

  const adminCheck = await authenticatedRequest(
    '/api/admin/me',
    'GET',
    data.adminToken,
    env
  );
  assert.equal(adminCheck.status, 200);

  db.close();
});

test('allows only administrators to delete uploaded photos', async () => {
  const { db, env } = await createEnv();

  const registrationResponse = await post('/api/register', {
    username: 'photo-admin',
    email: 'photo-admin@example.com',
    password: 'secret123',
  }, env);
  const registration = await registrationResponse.json();

  const adminResponse = await authenticatedRequest(
    '/api/admin/login',
    'POST',
    registration.token,
    env,
    { password: 'test-admin-password' }
  );
  const admin = await adminResponse.json();

  const photoResult = db.prepare(
    'INSERT INTO photos (user_id, filename, mime_type, image_data) VALUES (?, ?, ?, ?)'
  ).run(registration.user.id, 'test.jpg', 'image/jpeg', Buffer.from([1, 2, 3]));
  const photoId = Number(photoResult.lastInsertRowid);

  const forbidden = await authenticatedRequest(
    `/api/photos/${photoId}`,
    'DELETE',
    registration.token,
    env
  );
  assert.equal(forbidden.status, 403);

  const deleted = await authenticatedRequest(
    `/api/photos/${photoId}`,
    'DELETE',
    admin.adminToken,
    env
  );
  assert.equal(deleted.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM photos').get().count, 0);

  db.close();
});

test('allows administrators to manage registered accounts safely', async () => {
  const { db, env } = await createEnv();

  const adminRegistration = await post('/api/register', {
    username: 'account-admin',
    email: 'account-admin@example.com',
    password: 'secret123',
  }, env);
  const adminUser = await adminRegistration.json();

  const memberRegistration = await post('/api/register', {
    username: 'member-to-delete',
    email: 'member-to-delete@example.com',
    password: 'secret123',
  }, env);
  const member = await memberRegistration.json();

  const adminResponse = await authenticatedRequest(
    '/api/admin/login',
    'POST',
    adminUser.token,
    env,
    { password: 'test-admin-password' }
  );
  const admin = await adminResponse.json();

  db.prepare('INSERT INTO messages (user_id, username, content) VALUES (?, ?, ?)').run(
    member.user.id,
    member.user.username,
    'delete me too'
  );
  db.prepare(
    'INSERT INTO photos (user_id, filename, mime_type, image_data) VALUES (?, ?, ?, ?)'
  ).run(member.user.id, 'owned.jpg', 'image/jpeg', Buffer.from([1, 2, 3]));

  const usersResponse = await authenticatedRequest(
    '/api/admin/users',
    'GET',
    admin.adminToken,
    env
  );
  assert.equal(usersResponse.status, 200);
  const usersData = await usersResponse.json();
  const listedMember = usersData.users.find((user) => user.id === member.user.id);
  assert.equal(listedMember.message_count, 1);
  assert.equal(listedMember.photo_count, 1);

  const selfDelete = await authenticatedRequest(
    `/api/admin/users/${adminUser.user.id}`,
    'DELETE',
    admin.adminToken,
    env
  );
  assert.equal(selfDelete.status, 400);

  const deleteMember = await authenticatedRequest(
    `/api/admin/users/${member.user.id}`,
    'DELETE',
    admin.adminToken,
    env
  );
  assert.equal(deleteMember.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE id = ?').get(member.user.id).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE user_id = ?').get(member.user.id).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM photos WHERE user_id = ?').get(member.user.id).count, 0);

  db.close();
});
