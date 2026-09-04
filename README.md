# leetcode-preparation

Local web app to manage LeetCode problems with CRUD, search/filter, Leitner-style Kanban review boxes, and analytics.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Test

```bash
npm test
```

## Database

- Defaults to local SQLite at `./data/leetcode-prep.db`
- Supports remote PostgreSQL by setting `DATABASE_URL`
