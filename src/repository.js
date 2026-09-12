const { DEFAULT_BOXES } = require('./db');
const { isDueForBox } = require('./schedule');

const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

function normalizeList(value) {
  if (!value) return [];

  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  return [...new Set(
    list.map((item) => String(item).trim()).filter(Boolean),
  )];
}

function normalizeDifficulty(value) {
  const difficulty = String(value || 'easy').trim().toLowerCase();
  if (!VALID_DIFFICULTIES.has(difficulty)) {
    throw new Error(`Invalid difficulty: ${difficulty}`);
  }
  return difficulty;
}

async function ensureDifficultyId(db, difficulty) {
  const level = normalizeDifficulty(difficulty);
  const row = await db('difficulty_levels')
    .select('id')
    .where({ level })
    .first();

  if (!row) throw new Error(`Difficulty level not found: ${level}`);
  return row.id;
}

async function ensureCategories(db, names) {
  const normalized = normalizeList(names);

  for (const name of normalized) {
    await db('categories')
      .insert({ name })
      .onConflict('name')
      .ignore();
  }

  if (!normalized.length) return [];

  return db('categories')
    .select('id', 'name')
    .whereIn('name', normalized);
}

async function ensureCompanies(db, names) {
  const normalized = normalizeList(names);

  for (const name of normalized) {
    await db('companies')
      .insert({ name })
      .onConflict('name')
      .ignore();
  }

  if (!normalized.length) return [];

  // Company names are logically case-insensitive. The normalized schema
  // should therefore return the canonical row regardless of input casing.
  const rows = [];
  for (const name of normalized) {
    const row = await db('companies')
      .select('id', 'name')
      .whereRaw('LOWER(name) = LOWER(?)', [name])
      .first();

    if (row) rows.push(row);
  }
  return rows;
}

async function withRelations(db, rows) {
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);

  const [tags, categories, companies] = await Promise.all([
    db('tags')
      .select('problem_id', 'tag_name')
      .whereIn('problem_id', ids)
      .orderBy('tag_name'),

    db('problem_categories as pc')
      .join('categories as c', 'c.id', 'pc.category_id')
      .select('pc.problem_id', 'c.id as category_id', 'c.name')
      .whereIn('pc.problem_id', ids)
      .orderBy('c.name'),

    db('problem_companies as pc')
      .join('companies as c', 'c.id', 'pc.company_id')
      .select('pc.problem_id', 'c.id as company_id', 'c.name')
      .whereIn('pc.problem_id', ids)
      .orderBy('c.name'),
  ]);

  const byProblem = new Map();

  for (const row of rows) {
    byProblem.set(row.id, {
      ...row,
      tags: [],
      categories: [],
      company_tags: [],
      companies: [],
    });
  }

  for (const tag of tags) {
    byProblem.get(tag.problem_id)?.tags.push(tag.tag_name);
  }

  for (const category of categories) {
    byProblem.get(category.problem_id)?.categories.push(category.name);
  }

  for (const company of companies) {
    byProblem.get(company.problem_id)?.company_tags.push(company.name);
    byProblem.get(company.problem_id)?.companies.push(company.name);
  }

  return rows.map((row) => {
    const result = byProblem.get(row.id);

    return {
      ...result,
      // Keep the existing API contract for the current frontend while the DB
      // remains fully normalized.
      difficulty: row.difficulty || null,
      category: result.categories.join(', '),
    };
  });
}

async function getProblemById(db, id) {
  const rows = await db('problems as p')
    .join('difficulty_levels as d', 'd.id', 'p.difficulty_id')
    .select(
      'p.id',
      'p.title',
      'p.description',
      'p.link',
      'p.github_link',
      'd.level as difficulty',
      'p.notes',
      'p.created_at',
      'p.last_reviewed',
      'p.box',
      'p.user_id',
    )
    .where('p.id', id)
    .limit(1);

  if (!rows.length) return null;
  return (await withRelations(db, rows))[0];
}

async function writeRelations(db, problemId, categories, companies, tags) {
  await db('problem_categories').where({ problem_id: problemId }).del();
  await db('problem_companies').where({ problem_id: problemId }).del();
  await db('tags').where({ problem_id: problemId }).del();

  const categoryRows = await ensureCategories(db, categories);
  if (categoryRows.length) {
    await db('problem_categories')
      .insert(categoryRows.map((category) => ({
        problem_id: problemId,
        category_id: category.id,
      })))
      .onConflict(['problem_id', 'category_id'])
      .ignore();
  }

  const companyRows = await ensureCompanies(db, companies);
  if (companyRows.length) {
    await db('problem_companies')
      .insert(companyRows.map((company) => ({
        problem_id: problemId,
        company_id: company.id,
      })))
      .onConflict(['problem_id', 'company_id'])
      .ignore();
  }

  const tagRows = normalizeList(tags);
  if (tagRows.length) {
    await db('tags')
      .insert(tagRows.map((tag_name) => ({
        problem_id: problemId,
        tag_name,
      })))
      .onConflict(['problem_id', 'tag_name'])
      .ignore();
  }
}

async function createProblem(db, payload) {
  return db.transaction(async (trx) => {
    const difficulty_id = await ensureDifficultyId(
      trx,
      payload.difficulty || 'easy',
    );

    const data = {
      title: payload.title || null,
      description: payload.description || null,
      link: payload.link || null,
      github_link: payload.github_link || null,
      notes: payload.notes || null,
      difficulty_id,
      box: Number(payload.box) || 1,
      user_id: payload.user_id || null,
    };

    const [id] = await trx('problems').insert(data);

    await writeRelations(
      trx,
      id,
      payload.categories !== undefined ? payload.categories : payload.category,
      payload.companies !== undefined ? payload.companies : payload.company_tags,
      payload.tags,
    );

    return getProblemById(trx, id);
  });
}

async function listProblems(db, query = {}) {
  const q = (query.q || '').trim();
  const difficulty = query.difficulty
    ? normalizeDifficulty(query.difficulty)
    : null;
  const category = (query.category || '').trim();
  const tag = (query.tags || query.tag || '').trim();
  const company = (query.company_tags || query.company_tag || '').trim();

  const base = db('problems as p')
    .join('difficulty_levels as d', 'd.id', 'p.difficulty_id')
    .select(
      'p.id',
      'p.title',
      'p.description',
      'p.link',
      'p.github_link',
      'd.level as difficulty',
      'p.notes',
      'p.created_at',
      'p.last_reviewed',
      'p.box',
      'p.user_id',
    )
    .distinct();

  if (q) {
    base
      .leftJoin('tags as t', 't.problem_id', 'p.id')
      .leftJoin('problem_categories as pcq', 'pcq.problem_id', 'p.id')
      .leftJoin('categories as cq', 'cq.id', 'pcq.category_id')
      .leftJoin('problem_companies as pcoq', 'pcoq.problem_id', 'p.id')
      .leftJoin('companies as coq', 'coq.id', 'pcoq.company_id')
      .where((builder) => {
        builder
          .whereILike('p.title', `%${q}%`)
          .orWhereILike('p.description', `%${q}%`)
          .orWhereILike('p.link', `%${q}%`)
          .orWhereILike('p.github_link', `%${q}%`)
          .orWhereILike('d.level', `%${q}%`)
          .orWhereILike('cq.name', `%${q}%`)
          .orWhereILike('t.tag_name', `%${q}%`)
          .orWhereILike('coq.name', `%${q}%`);
      });
  }

  if (difficulty) base.andWhere('d.level', difficulty);

  if (category) {
    base
      .join('problem_categories as pc', 'pc.problem_id', 'p.id')
      .join('categories as c', 'c.id', 'pc.category_id')
      .andWhereILike('c.name', `%${category}%`);
  }

  if (tag) {
    base
      .join('tags as t2', 't2.problem_id', 'p.id')
      .andWhereILike('t2.tag_name', `%${tag}%`);
  }

  if (company) {
    base
      .join('problem_companies as pc2', 'pc2.problem_id', 'p.id')
      .join('companies as co2', 'co2.id', 'pc2.company_id')
      .andWhereILike('co2.name', `%${company}%`);
  }

  const rows = await base.orderBy('p.created_at', 'desc');
  return withRelations(db, rows);
}

async function updateProblem(db, id, payload) {
  const current = await getProblemById(db, id);
  if (!current) return null;

  return db.transaction(async (trx) => {
    const next = {
      title: payload.title ?? current.title,
      description: payload.description ?? current.description,
      link: payload.link ?? current.link,
      github_link: payload.github_link ?? current.github_link,
      notes: payload.notes ?? current.notes,
      box: payload.box ?? current.box,
    };

    if (payload.difficulty !== undefined) {
      next.difficulty_id = await ensureDifficultyId(trx, payload.difficulty);
    }

    await trx('problems').where({ id }).update(next);

    if (payload.tags !== undefined) {
      await trx('tags').where({ problem_id: id }).del();
      const tags = normalizeList(payload.tags);
      if (tags.length) {
        await trx('tags')
          .insert(tags.map((tag_name) => ({ problem_id: id, tag_name })))
          .onConflict(['problem_id', 'tag_name'])
          .ignore();
      }
    }

    const categoriesChanged =
      payload.categories !== undefined || payload.category !== undefined;
    if (categoriesChanged) {
      await trx('problem_categories').where({ problem_id: id }).del();
      const categories = payload.categories !== undefined
        ? payload.categories
        : payload.category;
      const categoryRows = await ensureCategories(trx, categories);

      if (categoryRows.length) {
        await trx('problem_categories')
          .insert(categoryRows.map((category) => ({
            problem_id: id,
            category_id: category.id,
          })))
          .onConflict(['problem_id', 'category_id'])
          .ignore();
      }
    }

    const companiesChanged =
      payload.companies !== undefined || payload.company_tags !== undefined;
    if (companiesChanged) {
      await trx('problem_companies').where({ problem_id: id }).del();
      const companies = payload.companies !== undefined
        ? payload.companies
        : payload.company_tags;
      const companyRows = await ensureCompanies(trx, companies);

      if (companyRows.length) {
        await trx('problem_companies')
          .insert(companyRows.map((company) => ({
            problem_id: id,
            company_id: company.id,
          })))
          .onConflict(['problem_id', 'company_id'])
          .ignore();
      }
    }

    return getProblemById(trx, id);
  });
}

async function deleteProblem(db, id) {
  const count = await db('problems').where({ id }).del();
  return count > 0;
}

async function moveProblemBox(db, id, box) {
  const numericBox = Number(box);
  if (!Number.isInteger(numericBox) || numericBox < 1) return null;

  return db.transaction(async (trx) => {
    const problem = await trx('problems').where({ id }).first();
    if (!problem) return null;

    await trx('problems')
      .where({ id })
      .update({
        box: numericBox,
        last_reviewed: trx.fn.now(),
      });

    const lastReviewedDate = problem.last_reviewed
      ? new Date(problem.last_reviewed).toISOString().slice(0, 10)
      : null;
    const today = new Date().toISOString().slice(0, 10);

    if (lastReviewedDate !== today) {
      await trx('study_events').insert({
        problem_id: id,
        user_id: problem.user_id || null,
      });
    }

    return getProblemById(trx, id);
  });
}

async function listBoxes(db) {
  const custom = await db('custom_boxes')
    .select('box_order', 'box_name')
    .orderBy('box_order', 'asc');

  const boxDefs = custom.length ? custom : DEFAULT_BOXES;
  const problems = await listProblems(db, {});

  return boxDefs.map((boxDef) => {
    const key = Number(boxDef.box_order);
    return {
      box: key,
      name: boxDef.box_name,
      problems: problems.filter((p) => p.box === key),
    };
  });
}

async function analytics(db) {
  const problems = await listProblems(db, {});
  const now = new Date();

  const difficulty = { easy: 0, medium: 0, hard: 0 };
  const categoryMap = new Map();
  const boxCounts = new Map();

  for (const problem of problems) {
    difficulty[problem.difficulty] =
      (difficulty[problem.difficulty] || 0) + 1;

    for (const category of problem.categories || []) {
      categoryMap.set(
        category,
        (categoryMap.get(category) || 0) + 1,
      );
    }

    boxCounts.set(
      problem.box,
      (boxCounts.get(problem.box) || 0) + 1,
    );
  }

  const category = [...categoryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const today = now.toISOString().slice(0, 10);
  const startDate = new Date(`${today}T00:00:00.000Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 83);

  const reviewed = await db('study_events')
    .where('studied_at', '>=', startDate)
    .select('studied_at');

  const heatCount = new Map();
  for (const row of reviewed) {
    const date = new Date(row.studied_at).toISOString().slice(0, 10);
    heatCount.set(date, (heatCount.get(date) || 0) + 1);
  }

  const heatmap = [];
  for (let i = 0; i < 84; i += 1) {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + i);
    const key = date.toISOString().slice(0, 10);
    heatmap.push({
      date: key,
      count: heatCount.get(key) || 0,
    });
  }

  const reviewedDays = [...heatCount.entries()]
    .filter(([, count]) => count > 0)
    .map(([date]) => date)
    .sort();

  let currentStreak = 0;
  let longestStreak = 0;
  let prev = null;

  for (const date of reviewedDays) {
    const current = new Date(`${date}T00:00:00.000Z`);

    if (!prev) {
      currentStreak = 1;
    } else {
      const delta = (current - prev) / 86400000;
      currentStreak = delta === 1 ? currentStreak + 1 : 1;
    }

    longestStreak = Math.max(longestStreak, currentStreak);
    prev = current;
  }

  const lastDate = reviewedDays.length
    ? reviewedDays[reviewedDays.length - 1]
    : null;
  const yesterday = new Date(now.getTime() - 86400000)
    .toISOString()
    .slice(0, 10);

  const streak =
    lastDate === today || lastDate === yesterday
      ? currentStreak
      : 0;

  const thisWeekStart = new Date(`${today}T00:00:00.000Z`);
  thisWeekStart.setUTCDate(
    thisWeekStart.getUTCDate() - thisWeekStart.getUTCDay(),
  );

  const reviewsThisWeek = reviewed.filter(
    (row) => new Date(row.studied_at) >= thisWeekStart,
  ).length;

  const boxStatus = Array.from({ length: 6 }, (_, idx) => {
    const box = idx + 1;

    return {
      box,
      count: boxCounts.get(box) || 0,
      readyToday: problems.filter(
        (problem) =>
          problem.box === box &&
          isDueForBox(box, problem.last_reviewed, now),
      ).length,
    };
  });

  const dueToday = boxStatus.reduce(
    (total, item) => total + item.readyToday,
    0,
  );

  const totalReviews = await db('study_events')
    .count({ count: '*' })
    .first();

  return {
    heatmap,
    difficulty,
    category,
    boxStatus,
    streak,
    longestStreak,
    totalReviews: Number(totalReviews?.count || 0),
    reviewsThisWeek,
    dueToday,
    totalProblems: problems.length,
    insights:
      `${problems.length} total problems | ` +
      `${reviewsThisWeek} reviews this week | ` +
      `${dueToday} due today | ` +
      `Longest streak: ${longestStreak} days`,
  };
}

async function listReviewsByDay(db, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const start = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 10) !== date
  ) {
    return null;
  }

  const rows = await db('study_events as se')
    .join('problems as p', 'p.id', 'se.problem_id')
    .join('difficulty_levels as d', 'd.id', 'p.difficulty_id')
    .select(
      'se.id as review_id',
      'se.problem_id',
      'se.studied_at',
      'p.title',
      'd.level as difficulty',
      'p.link',
    )
    .orderBy('se.studied_at', 'desc');

  const reviewsForDay = rows
    .filter(
      (row) =>
        new Date(row.studied_at).toISOString().slice(0, 10) === date,
    )
    .map((row) => ({ ...row, id: row.problem_id }));

  return withRelations(db, reviewsForDay);
}

module.exports = {
  createProblem,
  listProblems,
  getProblemById,
  updateProblem,
  deleteProblem,
  moveProblemBox,
  listBoxes,
  analytics,
  listReviewsByDay,
};
