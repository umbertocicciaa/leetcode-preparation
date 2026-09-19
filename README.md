# leetcode-preparation

Local web app to manage LeetCode problems with CRUD, search/filter, Leitner-style Kanban review boxes, and analytics.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Test

```bash
npm test
```

## Docker Compose

The production Compose stack contains:

- `app`: Node.js/Express application.
- `db`: PostgreSQL.
- `leetcode_postgres_data`: named PostgreSQL volume for persistent database storage.

Create an environment file:

```bash
cp .env.example .env
```

Set a strong `POSTGRES_PASSWORD`, then start the stack:

```bash
docker compose up -d --build
```

The application is available at `http://localhost:3000` by default.

The database is intentionally not published to the host. The application reaches it through the Compose network using the `db` service name.

To stop the stack without deleting database data:

```bash
docker compose down
```

Do not use `docker compose down -v` unless you intentionally want to delete the persistent PostgreSQL volume.

## Komodo

The repository is ready to be deployed as a Komodo Stack using `docker-compose.yml`.

Recommended stack configuration:

- Repository: `https://github.com/umbertocicciaa/leetcode-preparation.git`
- Branch: `main` (or `feat/docker-komodo-deployment` while testing)
- Compose file: `docker-compose.yml`

Set the PostgreSQL credentials as Komodo stack environment variables/secrets rather than committing them to Git:

```text
POSTGRES_DB=leetcode
POSTGRES_USER=leetcode
POSTGRES_PASSWORD=<strong-password>
APP_PORT=3000
```

The PostgreSQL data lives in the named volume `leetcode_postgres_data`, so application container replacement does not remove the database.

For local validation of the Komodo-oriented configuration:

```bash
KOMODO_SERVER=<server> \
KOMODO_HOST=<host> \
./scripts/deploy-komodo.sh
```

The script validates the Compose configuration and prints the expected Komodo Stack settings. It deliberately does not embed Komodo API credentials or destructive database operations.
