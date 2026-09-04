const { createDb, initSchema } = require('./db');
const { createApp } = require('./app');

async function start() {
  const db = createDb();
  await initSchema(db);

  const app = createApp(db);
  const port = Number(process.env.PORT) || 3000;

  const server = app.listen(port, () => {
    console.log(`LeetCode preparation app listening on port ${port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await db.destroy();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
