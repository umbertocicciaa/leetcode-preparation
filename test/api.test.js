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
        github_link: 'https://github.com/example/leetcode-two-sum',
        difficulty: 'easy',
        category: 'Arrays',
        tags: ['array', 'hash-map'],
        company_tags: ['Meta', 'Google'],
      })
      .expect(201);

    assert.equal(createRes.body.title, 'Two Sum');
    assert.deepEqual(createRes.body.tags, ['array', 'hash-map']);
    assert.deepEqual(createRes.body.company_tags, ['Meta', 'Google']);

    const listRes = await request(ctx.app).get('/api/problems?q=hash').expect(200);
    assert.equal(listRes.body.length, 1);
    assert.equal(listRes.body[0].title, 'Two Sum');

    const searchByLink = await request(ctx.app).get('/api/problems?q=leetcode.com/problems/two-sum').expect(200);
    assert.equal(searchByLink.body.length, 1);

    const searchByDifficulty = await request(ctx.app).get('/api/problems?q=easy').expect(200);
    assert.equal(searchByDifficulty.body.length, 1);

    const searchByGithubLink = await request(ctx.app).get('/api/problems?q=github.com/example').expect(200);
    assert.equal(searchByGithubLink.body.length, 1);

    const searchByCompany = await request(ctx.app).get('/api/problems?company_tags=Meta').expect(200);
    assert.equal(searchByCompany.body.length, 1);

    const moveRes = await request(ctx.app)
      .patch(`/api/problems/${createRes.body.id}/box`)
      .send({ box: 2 })
      .expect(200);

    assert.equal(moveRes.body.box, 2);
    assert.ok(moveRes.body.last_reviewed);
    assert.equal(await ctx.db('study_events').where({ problem_id: createRes.body.id }).count({ count: '*' }).then(([row]) => Number(row.count)), 1);

    const boxesRes = await request(ctx.app).get('/api/boxes').expect(200);
    const boxTwo = boxesRes.body.find((b) => b.box === 2);
    assert.ok(boxTwo);
    assert.equal(boxTwo.problems.length, 1);

    const analyticsRes = await request(ctx.app).get('/api/analytics').expect(200);
    assert.equal(analyticsRes.body.difficulty.easy, 1);
    assert.ok(Array.isArray(analyticsRes.body.heatmap));
    assert.equal(analyticsRes.body.heatmap.length, 84);
    assert.equal(analyticsRes.body.totalReviews, 1);
    assert.equal(analyticsRes.body.reviewsThisWeek, 1);
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
  assert.match(html, /id="openAddProblem"/);
  assert.match(html, /id="problemModal" class="modal hidden"/);
  assert.match(html, /id="closeAddProblem"/);
});

test('popup handlers are defined at top-level in frontend script', () => {
  const js = fs.readFileSync(path.join(process.cwd(), 'public', 'app.js'), 'utf8');
  assert.match(js, /function switchTab\([^)]*\) \{[\s\S]*?\}\n\nfunction openModal\(\)/);
  assert.match(js, /\nfunction openModal\(\) \{\n  problemModal\.classList\.remove\('hidden'\);\n\}/);
  assert.match(js, /\nfunction closeModal\(\) \{\n  problemModal\.classList\.add\('hidden'\);\n\}/);
});


test('database can be exported and imported with all application data', async () => {
  const ctx = await setup();
  try {
    const createRes = await request(ctx.app)
      .post('/api/problems')
      .send({
        title: 'Export Me',
        description: 'backup test',
        link: 'https://leetcode.com/problems/export-me/',
        difficulty: 'medium',
        category: 'Arrays',
        tags: ['backup', 'json'],
        company_tags: ['Google'],
      })
      .expect(201);

    await request(ctx.app)
      .patch(`/api/problems/${createRes.body.id}/box`)
      .send({ box: 2 })
      .expect(200);

    const exportRes = await request(ctx.app)
      .get('/api/settings/export')
      .expect(200);

    assert.equal(exportRes.body.format, 'leetcode-preparation-db');
    assert.equal(exportRes.body.version, 1);
    assert.ok(exportRes.body.exported_at);
    assert.ok(Array.isArray(exportRes.body.tables.problems));
    assert.ok(Array.isArray(exportRes.body.tables.study_events));
    assert.equal(exportRes.body.tables.problems.length, 1);
    assert.equal(exportRes.body.tables.tags.length, 2);
    assert.equal(exportRes.body.tables.study_events.length, 1);
    assert.match(exportRes.headers['content-disposition'], /attachment/);

    await request(ctx.app)
      .delete(`/api/problems/${createRes.body.id}`)
      .expect(204);

    assert.equal((await request(ctx.app).get('/api/problems')).body.length, 0);

    await request(ctx.app)
      .post('/api/settings/import')
      .send(exportRes.body)
      .expect(200);

    const restored = await request(ctx.app)
      .get('/api/problems')
      .expect(200);

    assert.equal(restored.body.length, 1);
    assert.equal(restored.body[0].title, 'Export Me');
    assert.equal(restored.body[0].box, 2);
    assert.deepEqual(restored.body[0].tags, ['backup', 'json']);
    assert.deepEqual(restored.body[0].company_tags, ['Google']);
    assert.equal(
      await ctx.db('study_events')
        .where({ problem_id: createRes.body.id })
        .count({ count: '*' })
        .then(([row]) => Number(row.count)),
      1,
    );
  } finally {
    await ctx.close();
  }
});

test('database import rejects unsupported export formats', async () => {
  const ctx = await setup();
  try {
    const response = await request(ctx.app)
      .post('/api/settings/import')
      .send({ format: 'unknown', version: 1, tables: {} })
      .expect(500);

    assert.equal(response.body.error, 'Internal server error');
  } finally {
    await ctx.close();
  }
});

test('UI defines the settings section and database import/export controls', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(process.cwd(), 'public', 'app.js'), 'utf8');

  assert.match(html, /data-tab="settingsTab"/);
  assert.match(html, /<section id="settingsTab" class="tab-panel">/);
  assert.match(html, /id="exportDatabase"/);
  assert.match(html, /id="importDatabase"/);
  assert.match(html, /id="importDatabaseFile"/);
  assert.match(js, /api\/settings\/export/);
  assert.match(js, /api\/settings\/import/);
});
