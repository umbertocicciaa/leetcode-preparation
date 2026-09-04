const { DEFAULT_BOXES } = require('./db');
const { isDueForBox } = require('./schedule');

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') {
    return tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

async function withTags(db, rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const tags = await db('tags').select('problem_id', 'tag_name').whereIn('problem_id', ids);
  const byProblem = tags.reduce((acc, tag) => {
    if (!acc[tag.problem_id]) acc[tag.problem_id] = [];
    acc[tag.problem_id].push(tag.tag_name);
    return acc;
  }, {});

  return rows.map((row) => ({ ...row, tags: byProblem[row.id] || [] }));
}

async function createProblem(db, payload) {
  const data = {
    title: payload.title || null,
    description: payload.description || null,
    link: payload.link || null,
    github_link: payload.github_link || null,
    difficulty: (payload.difficulty || 'easy').toLowerCase(),
    category: payload.category || null,
    box: Number(payload.box) || 1,
    user_id: payload.user_id || null,
  };

  const [id] = await db('problems').insert(data);
  const tags = normalizeTags(payload.tags);
  if (tags.length) {
    await db('tags').insert(tags.map((tag) => ({ problem_id: id, tag_name: tag })));
  }

  return getProblemById(db, id);
}

async function getProblemById(db, id) {
  const rows = await db('problems').where({ id }).limit(1);
  if (rows.length === 0) return null;
  return (await withTags(db, rows))[0];
}

async function listProblems(db, query) {
  const q = (query.q || '').trim();
  const difficulty = query.difficulty ? query.difficulty.toLowerCase() : null;
  const category = (query.category || '').trim();
  const tag = (query.tag || '').trim();

  const base = db('problems as p').select('p.*').distinct();

  if (q) {
    base.leftJoin('tags as t', 't.problem_id', 'p.id').where((builder) => {
      builder
        .whereILike('p.title', `%${q}%`)
        .orWhereILike('p.description', `%${q}%`)
        .orWhereILike('p.category', `%${q}%`)
        .orWhereILike('t.tag_name', `%${q}%`);
    });
  }

  if (difficulty) base.andWhere('p.difficulty', difficulty);
  if (category) base.andWhereILike('p.category', `%${category}%`);

  if (tag) {
    base.join('tags as t2', 't2.problem_id', 'p.id').andWhereILike('t2.tag_name', `%${tag}%`);
  }

  const rows = await base.orderBy('p.created_at', 'desc');
  return withTags(db, rows);
}

async function updateProblem(db, id, payload) {
  const current = await getProblemById(db, id);
  if (!current) return null;

  const next = {
    title: payload.title ?? current.title,
    description: payload.description ?? current.description,
    link: payload.link ?? current.link,
    github_link: payload.github_link ?? current.github_link,
    difficulty: payload.difficulty ? payload.difficulty.toLowerCase() : current.difficulty,
    category: payload.category ?? current.category,
    box: payload.box ?? current.box,
  };

  await db('problems').where({ id }).update(next);

  if (payload.tags !== undefined) {
    await db('tags').where({ problem_id: id }).del();
    const tags = normalizeTags(payload.tags);
    if (tags.length) {
      await db('tags').insert(tags.map((tagName) => ({ problem_id: id, tag_name: tagName })));
    }
  }

  return getProblemById(db, id);
}

async function deleteProblem(db, id) {
  const count = await db('problems').where({ id }).del();
  return count > 0;
}

async function moveProblemBox(db, id, box) {
  const numericBox = Number(box);
  if (!Number.isInteger(numericBox) || numericBox < 1) return null;

  await db('problems').where({ id }).update({ box: numericBox, last_reviewed: db.fn.now() });
  return getProblemById(db, id);
}

async function listBoxes(db) {
  const custom = await db('custom_boxes').select('box_order', 'box_name').orderBy('box_order', 'asc');
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

  for (const p of problems) {
    difficulty[p.difficulty] = (difficulty[p.difficulty] || 0) + 1;
    if (p.category) categoryMap.set(p.category, (categoryMap.get(p.category) || 0) + 1);
    boxCounts.set(p.box, (boxCounts.get(p.box) || 0) + 1);
  }

  const category = [...categoryMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 83);
  startDate.setHours(0, 0, 0, 0);

  const reviewed = await db('problems')
    .whereNotNull('last_reviewed')
    .andWhere('last_reviewed', '>=', startDate.toISOString())
    .select('last_reviewed');

  const heatCount = new Map();
  for (const row of reviewed) {
    const date = new Date(row.last_reviewed).toISOString().slice(0, 10);
    heatCount.set(date, (heatCount.get(date) || 0) + 1);
  }

  const heatmap = [];
  for (let i = 0; i < 84; i += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const key = date.toISOString().slice(0, 10);
    heatmap.push({ date: key, count: heatCount.get(key) || 0 });
  }

  const reviewedDays = [...heatCount.entries()].filter(([, count]) => count > 0).map(([date]) => date).sort();
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

  const lastDate = reviewedDays.length ? reviewedDays[reviewedDays.length - 1] : null;
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const streak = lastDate === today ? currentStreak : (lastDate === yesterday ? currentStreak : 0);

  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - now.getDay());
  thisWeekStart.setHours(0, 0, 0, 0);
  const reviewsThisWeek = reviewed.filter((row) => new Date(row.last_reviewed) >= thisWeekStart).length;

  const boxStatus = Array.from({ length: 6 }, (_, idx) => {
    const box = idx + 1;
    return {
      box,
      count: boxCounts.get(box) || 0,
      readyToday: problems.filter((p) => p.box === box && isDueForBox(box, p.last_reviewed, now)).length,
    };
  });

  const dueToday = boxStatus.reduce((acc, item) => acc + item.readyToday, 0);

  return {
    heatmap,
    difficulty,
    category,
    boxStatus,
    streak,
    longestStreak,
    insights: `${problems.length} total problems | ${reviewsThisWeek} reviews this week | ${dueToday} due today | Longest streak: ${longestStreak} days`,
  };
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
};
