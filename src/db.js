const fs = require('node:fs');
const path = require('node:path');
const knex = require('knex');

const DEFAULT_BOXES = [
  { box_order: 1, box_name: 'Box 1 (New/Review Soon)' },
  { box_order: 2, box_name: 'Box 2 (Weekly)' },
  { box_order: 3, box_name: 'Box 3a (Bi-weekly Wednesday)' },
  { box_order: 4, box_name: 'Box 3b (Bi-weekly Saturday)' },
  { box_order: 5, box_name: 'Box 4 (Monthly)' },
  { box_order: 6, box_name: 'Box 5 (Pre-exam)' },
];

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    return knex({
      client: 'pg',
      connection: databaseUrl,
      pool: { min: 0, max: 10 },
    });
  }

  const sqlitePath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'leetcode-prep.db');
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

  return knex({
    client: 'sqlite3',
    connection: { filename: sqlitePath },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn, done) => conn.run('PRAGMA foreign_keys = ON', done),
    },
  });
}

async function initSchema(db) {
  const hasProblems = await db.schema.hasTable('problems');
  if (!hasProblems) {
    await db.schema.createTable('problems', (table) => {
      table.increments('id').primary();
      table.text('title').index();
      table.text('description');
      table.text('link');
      table.text('github_link');
      table.enu('difficulty', ['easy', 'medium', 'hard']).notNullable().defaultTo('easy');
      table.text('notes');
      table.text('category').index();
      table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      table.timestamp('last_reviewed');
      table.integer('box').notNullable().defaultTo(1);
      table.integer('user_id');
    });
  }

  const hasTags = await db.schema.hasTable('tags');
  if (!hasTags) {
    await db.schema.createTable('tags', (table) => {
      table.increments('id').primary();
      table.integer('problem_id').notNullable().references('id').inTable('problems').onDelete('CASCADE');
      table.text('tag_name').notNullable().index();
    });
  }

  const hasCustomBoxes = await db.schema.hasTable('custom_boxes');
  if (!hasCustomBoxes) {
    await db.schema.createTable('custom_boxes', (table) => {
      table.increments('id').primary();
      table.integer('user_id');
      table.integer('box_order').notNullable();
      table.text('box_name').notNullable();
    });
  }

  const hasStudyEvents = await db.schema.hasTable('study_events');
  if (!hasStudyEvents) {
    await db.schema.createTable('study_events', (table) => {
      table.increments('id').primary();
      table.integer('problem_id').notNullable().references('id').inTable('problems').onDelete('CASCADE').index();
      table.timestamp('studied_at').notNullable().defaultTo(db.fn.now()).index();
      table.integer('user_id').index();
    });
  }

  // Preserve the available history for databases created before study_events.
  // A prior version only retained each problem's latest review timestamp.
  const unrecordedReviews = await db('problems as p')
    .whereNotNull('p.last_reviewed')
    .whereNotExists(function noEventForProblem() {
      this.select('*').from('study_events as se').whereRaw('se.problem_id = p.id');
    })
    .select('p.id', 'p.last_reviewed', 'p.user_id');

  if (unrecordedReviews.length) {
    await db('study_events').insert(unrecordedReviews.map((problem) => ({
      problem_id: problem.id,
      studied_at: problem.last_reviewed,
      user_id: problem.user_id,
    })));
  }
}

module.exports = {
  createDb,
  initSchema,
  DEFAULT_BOXES,
};
