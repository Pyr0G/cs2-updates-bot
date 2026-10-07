# Docker deployment

Requires Docker Engine and Docker Compose v2 or newer on a Linux host. This deploys one instance for one configured Discord server. No incoming ports or public domain are required.

## Prepare

Copy package.json, src/, Dockerfile, .dockerignore and compose.yaml into a dedicated directory on the host. Keep .dockerignore alongside the Dockerfile so private files are excluded from the build context.

For a new installation, create .env from .env.example and configure your own bot token and server/channel/role IDs. Leave state.json absent so the first start establishes a quiet baseline; do not create an empty state file.

For migration, stop the old instance first, then transfer your private .env and its final data/state.json over a trusted encrypted connection. Do not copy a state lock or temporary file. Preserve a private backup of the history before migration.

On the Linux host, from the deployment directory:

```sh
mkdir -p data
chmod 600 .env
sudo chown -R 1000:1000 data
sudo chmod 700 data
if [ -f data/state.json ]; then sudo chmod 600 data/state.json; fi
docker compose build
docker compose run --rm --no-deps bot node src/main.js check
```

Use the ownership commands only on the dedicated bot data directory. The check command validates Discord access without sending a message. Do not run the check concurrently with deployment changes. Docker administrators can inspect container environment variables; restrict Docker access accordingly. Never share expanded Compose configuration or unrestricted container inspection output.

## Start and verify

```sh
docker compose up -d
docker compose ps
docker compose logs --tail 40 bot
```

Starting resumes from transferred history and can post announcements published while the bot was stopped, each with the configured role ping. Review that expected catch-up before starting. An absent history file instead establishes a quiet baseline; do not discard existing history unintentionally.

Verify the startup identity and monitoring logs, then perform a controlled restart and inspect logs again:

```sh
docker compose restart bot
docker compose logs --tail 40 bot
```

The container uses a non-root user, read-only application files, a dedicated writable data directory, bounded logs/resources and no published ports. Credentials and history are excluded from the image build. Ensure Docker itself starts at boot. The restart policy resumes after host restart unless the container was deliberately stopped.

## Recovery and rollback

```sh
docker compose stop bot
```

After a hard kill or power loss, version 1.0 may leave a stale data/state.json.lock. Automatic container restart does not remove it. Stop the container, confirm no other instance uses the state, and follow the README lock recovery procedure. An uncertain pending delivery also requires manual review; restarting must not silently replay it. A container reported as running is not proof of successful polling; inspect errors in its logs.

To move back to another machine, stop this container and securely copy its latest state.json back before starting the other instance. Do not restore an older history over newer successful deliveries. Keep credentials and state backups private. No Docker socket or other host application directories should be mounted into this container.

Deployment files are prepared separately from the original 1.0 release. Build, live-host checks and restart validation must be completed on the target before claiming deployment success.
