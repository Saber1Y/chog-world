# Deploying the backend to a VPS

Postgres, the backend and Caddy (automatic HTTPS) run with Docker Compose. The image is built
locally for the server's architecture and loaded over SSH, so the server needs no repo access.

1. On the server: Docker with the compose plugin, ports 80 and 443 open.
2. Copy this folder to the server (e.g. `~/chog-world`), then create there:
   - `.env` with `POSTGRES_PASSWORD=<random>` and `API_DOMAIN=<ip-with-dashes>.sslip.io`
   - `backend.env` from `backend.env.example`, with the keeper key; `chmod 600` both files.
3. From the repo root on your machine:
   `docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile -t chogworld-backend:latest --load .`
   `docker save chogworld-backend:latest | gzip | ssh <user>@<ip> 'gunzip | docker load'`
4. On the server: `docker compose up -d`, then `curl https://$API_DOMAIN/health`.

Run only one backend per keeper key: a second copy would race the same nonces.
