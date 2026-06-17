# VPS Docker Deploy

This runs the Bio Lec bot as a separate Docker service and exposes it through your VPS reverse proxy.

## 1. Choose the public bot URL

Use a subdomain such as:

```text
https://bot.biolecmobility.com
```

Create a DNS `A` record for the subdomain pointing to your VPS IP.

## 2. Copy files to the VPS

Copy the project folder to the VPS, for example:

```bash
mkdir -p /opt/biolec-codex-bot
rsync -av --exclude node_modules --exclude .env ./ /opt/biolec-codex-bot/
cd /opt/biolec-codex-bot
```

## 3. Create the production `.env`

Create `/opt/biolec-codex-bot/.env` from `.env.example`.

Use these production values:

```text
HOST=0.0.0.0
PORT=8787
PUBLIC_SITE_ORIGIN=https://biolecmobility.com
ANSWER_MODEL=gpt-5
```

Keep the real values for:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
BIOLEC_SYNC_SECRET
WOOCOMMERCE_URL
WOOCOMMERCE_CONSUMER_KEY
WOOCOMMERCE_CONSUMER_SECRET
```

The bot runs the OpenAI Agents SDK engine (triage + product/policy/tracking specialists). `ANSWER_MODEL` sets the model the specialists answer with (defaults to `gpt-5`).

## 4. Start the container

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f biolec-codex-bot
```

Local VPS health check:

```bash
curl http://127.0.0.1:8787/health
curl http://127.0.0.1:8787/health/chat
```

## 5. Reverse proxy

Point your existing reverse proxy to:

```text
http://127.0.0.1:8787
```

Enable HTTPS for the public bot subdomain.

Nginx server block example:

```nginx
server {
    listen 80;
    server_name bot.biolecmobility.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

After HTTPS is enabled, test:

```bash
curl https://bot.biolecmobility.com/health
```

## 6. WordPress setting

In WordPress admin, set:

```text
Bot server URL: https://bot.biolecmobility.com
```

The WordPress plugin sync secret must match `BIOLEC_SYNC_SECRET` in the VPS `.env`.

Then run:

1. Test Bot Server Connection
2. Sync Key Pages
3. Sync Current Catalog
4. Test the storefront chat widget
