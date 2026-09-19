const express = require('express');
const path = require('node:path');
const {
  createProblem,
  listProblems,
  getProblemById,
  updateProblem,
  deleteProblem,
  moveProblemBox,
  listBoxes,
  analytics,
  listReviewsByDay,
  exportDatabase,
  importDatabase,
} = require('./repository');

function createApp(db) {
  const app = express();
  app.use(express.json());

  app.get('/api/settings/export', async (_req, res, next) => {
    try {
      const snapshot = await exportDatabase(db);
      const filename = `leetcode-preparation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/settings/import', async (req, res, next) => {
    try {
      await importDatabase(db, req.body);
      res.status(200).json({ message: 'Database imported successfully' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/problems', async (req, res, next) => {
    try {
      const problems = await listProblems(db, req.query);
      res.json(problems);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/problems', async (req, res, next) => {
    try {
      const problem = await createProblem(db, req.body || {});
      res.status(201).json(problem);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/problems/:id', async (req, res, next) => {
    try {
      const problem = await getProblemById(db, Number(req.params.id));
      if (!problem) return res.status(404).json({ error: 'Problem not found' });
      res.json(problem);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/problems/:id', async (req, res, next) => {
    try {
      const problem = await updateProblem(db, Number(req.params.id), req.body || {});
      if (!problem) return res.status(404).json({ error: 'Problem not found' });
      res.json(problem);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/problems/:id', async (req, res, next) => {
    try {
      const deleted = await deleteProblem(db, Number(req.params.id));
      if (!deleted) return res.status(404).json({ error: 'Problem not found' });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/problems/:id/box', async (req, res, next) => {
    try {
      const problem = await moveProblemBox(db, Number(req.params.id), req.body?.box);
      if (!problem) return res.status(404).json({ error: 'Problem not found' });
      res.json(problem);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/boxes', async (req, res, next) => {
    try {
      const boxes = await listBoxes(db);
      res.json(boxes);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/analytics', async (req, res, next) => {
    try {
      const data = await analytics(db);
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/analytics/reviews', async (req, res, next) => {
    try {
      const reviews = await listReviewsByDay(db, String(req.query.date || ''));
      if (!reviews) return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD value' });
      res.json(reviews);
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(path.join(process.cwd(), 'public')));

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
