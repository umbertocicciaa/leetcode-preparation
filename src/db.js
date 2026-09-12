const fs = require('node:fs');
const os = require('node:os');
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

  const sqlitePath = process.env.SQLITE_PATH
    || path.join(os.homedir(), 'releases', 'dbs', 'leetcode-preparation', 'leetcode-prep.db');

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
  // Reference tables must exist before PostgreSQL creates problems with an FK
  // to difficulty_levels.
  if (!(await db.schema.hasTable('difficulty_levels'))) {
    await db.schema.createTable('difficulty_levels', (table) => {
      table.increments('id').primary();
      table.text('level').notNullable().unique();
      table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('categories'))) {
    await db.schema.createTable('categories', (table) => {
      table.increments('id').primary();
      table.text('name').notNullable().unique();
      table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    });
  }

  if (!(await db.schema.hasTable('companies'))) {
    await db.schema.createTable('companies', (table) => {
      table.increments('id').primary();
      table.text('name').notNullable().unique();
      table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    });
  }

  await db('difficulty_levels')
    .insert([{ level: 'easy' }, { level: 'medium' }, { level: 'hard' }])
    .onConflict('level')
    .ignore();

  if (!(await db.schema.hasTable('problems'))) {
    await db.schema.createTable('problems', (table) => {
      table.increments('id').primary();
      table.text('title').index();
      table.text('description');
      table.text('link');
      table.text('github_link');
      table.integer('difficulty_id').notNullable()
        .references('id').inTable('difficulty_levels');
      table.text('notes');
      table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      table.timestamp('last_reviewed');
      table.integer('box').notNullable().defaultTo(1);
      table.integer('user_id');
      table.index(['difficulty_id']);
    });
  }

  if (!(await db.schema.hasTable('tags'))) {
    await db.schema.createTable('tags', (table) => {
      table.increments('id').primary();
      table.integer('problem_id').notNullable()
        .references('id').inTable('problems').onDelete('CASCADE');
      table.text('tag_name').notNullable();
      table.unique(['problem_id', 'tag_name']);
      table.index(['problem_id']);
    });
  }

  if (!(await db.schema.hasTable('problem_categories'))) {
    await db.schema.createTable('problem_categories', (table) => {
      table.increments('id').primary();
      table.integer('problem_id').notNullable()
        .references('id').inTable('problems').onDelete('CASCADE');
      table.integer('category_id').notNullable()
        .references('id').inTable('categories').onDelete('CASCADE');
      table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      table.unique(['problem_id', 'category_id']);
      table.index(['problem_id']);
      table.index(['category_id']);
    });
  }

  if (!(await db.schema.hasTable('problem_companies'))) {
    await db.schema.createTable('problem_companies', (table) => {
      table.increments('id').primary();
      table.integer('problem_id').notNullable()
        .references('id').inTable('problems').onDelete('CASCADE');
      table.integer('company_id').notNullable()
        .references('id').inTable('companies').onDelete('CASCADE');
      table.timestamp('created_at').notNullable().defaultTo(db.fn.now());
      table.unique(['problem_id', 'company_id']);
      table.index(['problem_id']);
      table.index(['company_id']);
    });
  }

  if (!(await db.schema.hasTable('custom_boxes'))) {
    await db.schema.createTable('custom_boxes', (table) => {
      table.increments('id').primary();
      table.integer('user_id');
      table.integer('box_order').notNullable();
      table.text('box_name').notNullable();
    });
  }

  if (!(await db.schema.hasTable('study_events'))) {
    await db.schema.createTable('study_events', (table) => {
      table.increments('id').primary();
      table.integer('problem_id').notNullable()
        .references('id').inTable('problems').onDelete('CASCADE');
      table.timestamp('studied_at').notNullable().defaultTo(db.fn.now()).index();
      table.integer('user_id').index();
      table.index(['problem_id']);
    });
  }
}

module.exports = {
  createDb,
  initSchema,
  DEFAULT_BOXES,
};
