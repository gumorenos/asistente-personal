# Docker bind-mounted data permissions

The application runs non-root. `docker-compose.yml` bind-mounts `./data` at `/app/data`, so the numeric UID/GID used inside the container must match an account that can write the host directory.

## Fresh Linux deployment

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Set the runtime identity in `.env` to the non-root deployment account:

   ```bash
   id -u
   id -g
   ```

   Copy those numeric values into:

   ```env
   ASSISTANT_UID=<id -u>
   ASSISTANT_GID=<id -g>
   ```

   Do not use `0:0`.

3. Ensure the bind source exists and is private:

   ```bash
   mkdir -p data
   chmod 0700 data
   test -w data
   ```

4. Validate Compose before starting:

   ```bash
   docker compose config >/dev/null
   ```

5. Start normally:

   ```bash
   docker compose up -d --build
   ```

## Existing deployment with wrong ownership

Do not solve this with `chmod 0777`.

First stop the QA instance and take a backup of the data directory. Then inspect ownership:

```bash
ls -ldn data
find data -maxdepth 1 -type f -printf '%u:%g %m %p\n'
```

If the deployment account is intentionally the owner of this assistant's data, restore ownership to that account and tighten permissions:

```bash
sudo chown -R "$(id -u):$(id -g)" data
find data -type d -exec chmod 0700 {} +
find data -type f -exec chmod 0600 {} +
```

Then set `ASSISTANT_UID` / `ASSISTANT_GID` to the same numeric identity and restart.

Never run the assistant container as root merely to bypass bind-mount permissions. Never make the data directory world-writable.

## Why the Dockerfile chown is not enough

The image prepares `/app/data` for its built-in `node` user, but a host bind mount is attached at container creation time and hides that image directory. Host filesystem ownership therefore controls write access.

The Compose file uses `bind.create_host_path: false` so a missing `./data` fails closed rather than being silently created with unsuitable ownership.
