# Deploying the backend to a VPS

Run only one backend per keeper key: a second copy would race the same nonces.

## Native (pm2), the current testnet host

The testnet backend runs at `https://api.chogworld.162-62-231-147.sslip.io`.
It runs natively next to other apps on a shared server: the system Postgres holds its database, pm2 runs the process, and the system Caddy terminates HTTPS.
The frontend is on Vercel (`https://chog-world-zeta.vercel.app`), built from `apps/web` with `apps/web/vercel.json`.

One-time setup on the server (Node 24, pm2, Postgres and Caddy already installed):

1. `sudo apt-get install -y fonts-liberation` for the image overlays.
2. Create the database: a `chogworld` role with a random password and a `chogworld` database it owns.
3. Create `~/chog-world/backend.env` (`chmod 600`) from `backend.env.example`, with:
   - `HOST=127.0.0.1` and `PORT=9100`, so only Caddy can reach it
   - `DATABASE_URL=postgres://chogworld:<password>@127.0.0.1:5432/chogworld`
   - `PUBLIC_URL` and `CORS_ORIGIN` (the Vercel domain)
   - `ART_CACHE_PATH=/home/ubuntu/chog-world/chog-base.png`
   - the keeper key
4. Run `deploy/deploy-native.sh <user>@<host>` once to build `~/chog-world/app`, then start it:
   `cd ~/chog-world/app && pm2 start dist/main.js --name chogworld-backend --node-args="--env-file=/home/ubuntu/chog-world/backend.env" --max-memory-restart 400M --time && pm2 save`
5. Add a site to `/etc/caddy/Caddyfile` that proxies `api.chogworld.<ip-with-dashes>.sslip.io` to `127.0.0.1:9100`.
   Run `sudo caddy validate --config /etc/caddy/Caddyfile` and then `sudo systemctl reload caddy`.

To redeploy after committing backend changes, run `deploy/deploy-native.sh <user>@<host>`.
After editing `backend.env`, run `pm2 restart chogworld-backend --update-env`.

## Docker Compose, for a dedicated server

Postgres, the backend and Caddy (automatic HTTPS) run with Docker Compose.
The image is built locally for the server's architecture and loaded over SSH, so the server needs no repo access.
This needs ports 80 and 443 free, so it does not fit a server where another Caddy already owns them.

1. On the server: Docker with the compose plugin, ports 80 and 443 open.
2. Copy this folder to the server (e.g. `~/chog-world`), then create there:
   - `.env` with `POSTGRES_PASSWORD=<random>` and `API_DOMAIN=<ip-with-dashes>.sslip.io`
   - `backend.env` from `backend.env.example`, with the keeper key; `chmod 600` both files.
3. From the repo root on your machine:
   `docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile -t chogworld-backend:latest --load .`
   `docker save chogworld-backend:latest | gzip | ssh <user>@<ip> 'gunzip | docker load'`
4. On the server: `docker compose up -d`, then `curl https://$API_DOMAIN/health`.
