# Add Bot To Existing Caddy Docker Stack

Your current stack uses an external Docker network named `caddy_net`. Add the bot container to the same network, then Caddy can proxy to it by container name.

## 1. Copy project to VPS

From inside `/docker/biolecmobility`, create:

```bash
mkdir -p /docker/biolecmobility/biolec-codex-bot
```

Upload this project into:

```text
/docker/biolecmobility/biolec-codex-bot
```

Do not upload `node_modules`.

## 2. Add bot service to your compose file

In `/docker/biolecmobility/docker-compose.yml`, add this service beside `n8n` and `caddy`:

```yaml
  biolec-codex-bot:
    build:
      context: ./biolec-codex-bot
    container_name: biolec-codex-bot
    restart: unless-stopped
    env_file:
      - ./biolec-codex-bot/.env
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 8787
    expose:
      - "8787"
    networks:
      - caddy_net
```

Then update Caddy dependencies:

```yaml
    depends_on:
      - n8n
      - biolec-codex-bot
```

## 3. Add Caddy route

Wherever your Caddyfile currently defines `n8n.biolecmobility.com`, add:

```caddyfile
bot.biolecmobility.com {
    encode gzip
    reverse_proxy biolec-codex-bot:8787
}
```

## 4. Create `.env`

On the VPS:

```bash
cd /docker/biolecmobility/biolec-codex-bot
cp .env.example .env
nano .env
```

Use:

```text
HOST=0.0.0.0
PORT=8787
PUBLIC_SITE_ORIGIN=https://biolecmobility.com
ANSWER_MODEL=gpt-5
```

Fill the real values for:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
BIOLEC_SYNC_SECRET
WOOCOMMERCE_URL
WOOCOMMERCE_CONSUMER_KEY
WOOCOMMERCE_CONSUMER_SECRET
```

## 5. Start

From `/docker/biolecmobility`:

```bash
docker compose up -d --build biolec-codex-bot caddy
docker compose ps
docker compose logs -f biolec-codex-bot
```

Test from the VPS:

```bash
docker exec caddy wget -qO- http://biolec-codex-bot:8787/health
curl https://bot.biolecmobility.com/health
curl https://bot.biolecmobility.com/health/chat
```

## 6. WordPress

In WordPress admin:

```text
Bot server URL: https://bot.biolecmobility.com
```

Make sure the plugin sync secret matches `BIOLEC_SYNC_SECRET`.
