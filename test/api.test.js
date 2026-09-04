const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { createDb, initSchema } = require('../src/db');
const { createApp } = require('../src/app');

async function setup() {
  const dbPath = path.join('/tmp', `leetcode-prep-test-${Date.now()}-${Math.random()}.db`);
  process.env.SQLITE_PATH = dbPath;
  delete process.env.DATABASE_URL;

  const db = createDb();
  await initSchema(db);
  const app = createApp(db);

  return {
    db,
    app,
    dbPath,
    async close() {
      await db.destroy();
      if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
      delete process.env.SQLITE_PATH;
    },
  };
}

test('CRUD + search + box movement + analytics', async () => {
  const ctx = await setup();
  try {
    const createRes = await request(ctx.app)
      .post('/api/problems')
      .send({
        title: 'Two Sum',
        description: 'hash map approach',
        link: 'https://leetcode.com/problems/two-sum/',
        difficulty: 'easy',
        category: 'Arrays',
        tags: ['array', 'hash-map'],
      })
      .expect(201);

    assert.equal(createRes.body.title, 'Two Sum');
    assert.deepEqual(createRes.body.tags, ['array', 'hash-map']);

    const listRes = await request(ctx.app).get('/api/problems?q=hash').expect(200);
    assert.equal(listRes.body.length, 1);
    assert.equal(listRes.body[0].title, 'Two Sum');

    const moveRes = await request(ctx.app)
      .patch(`/api/problems/${createRes.body.id}/box`)
      .send({ box: 2 })
      .expect(200);

    assert.equal(moveRes.body.box, 2);
    assert.ok(moveRes.body.last_reviewed);

    const boxesRes = await request(ctx.app).get('/api/boxes').expect(200);
    const boxTwo = boxesRes.body.find((b) => b.box === 2);
    assert.ok(boxTwo);
    assert.equal(boxTwo.problems.length, 1);

    const analyticsRes = await request(ctx.app).get('/api/analytics').expect(200);
    assert.equal(analyticsRes.body.difficulty.easy, 1);
    assert.ok(Array.isArray(analyticsRes.body.heatmap));
    assert.equal(analyticsRes.body.heatmap.length, 84);
    assert.match(analyticsRes.body.insights, /total problems/);

    await request(ctx.app).delete(`/api/problems/${createRes.body.id}`).expect(204);
    const afterDelete = await request(ctx.app).get('/api/problems').expect(200);
    assert.equal(afterDelete.body.length, 0);
  } finally {
    await ctx.close();
  }
});

test('UI defines separate tab panels for library, kanban, and analytics', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  assert.match(html, /data-tab="problemsTab"/);
  assert.match(html, /data-tab="kanbanTab"/);
  assert.match(html, /data-tab="analyticsTab"/);
  assert.match(html, /<section id="problemsTab" class="tab-panel active">/);
  assert.match(html, /<section id="kanbanTab" class="tab-panel">/);
  assert.match(html, /<section id="analyticsTab" class="tab-panel">/);
});
