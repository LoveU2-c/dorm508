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
  return {
    db,
    env: {
      DB: new D1DatabaseMock(db),
      JWT_SECRET: 'test-secret',
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
