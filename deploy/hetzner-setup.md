# Deploying OSRS Flip Terminal v2 on Hetzner VPS

This entire stack (collector + metrics engine + SQLite WAL + React terminal + Caddy HTTPS + automated daily backups) runs comfortably on the smallest Hetzner Cloud server (**CX22 / CAX11**, ~€3.79–€4.50/month) using **< 350 MB RAM**.

## 1. Point a Domain (or Subdomain) to Your Hetzner IP
Create an `A` record at your DNS registrar (e.g., Cloudflare / Namecheap):
- Host: `flip` (so `flip.yourdomain.com`)
- Value: `<YOUR_HETZNER_VPS_IP>`

*(If you don't have a domain, you can alternatively use Tailscale or a free Cloudflare Tunnel pointing to `http://localhost:8000`.)*

## 2. Firewall & Docker on Hetzner (Ubuntu 24.04)
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in so docker group applies
```

## 3. Clone & Configure `.env`
```bash
git clone <your-repo-url> osrs_trading_dashboard
cd osrs_trading_dashboard
cp .env.example .env
```

Edit `.env` and set strong production values:
```bash
DOMAIN=flip.yourdomain.com
APP_PASSWORD=choose-a-strong-password
SESSION_SECRET=$(openssl rand -hex 32)
DINK_WEBHOOK_TOKEN=$(openssl rand -hex 24)
WIKI_USER_AGENT="osrs-flip-terminal/2.0 - your-contact-here"
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## 4. Launch Production Stack (Auto-HTTPS!)
```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml logs -f osrs-terminal
```
- Within **~20 seconds**, the fast tiered bootstrap completes and your dashboard is live at `https://flip.yourdomain.com`.
- Within **~2 minutes** in the background, 7 days of hourly history finishes loading automatically.

## 5. Connect RuneLite Dink (30 Seconds)
1. Open `https://flip.yourdomain.com` → **Settings & Dink**.
2. Copy your private **Dink Webhook URL** (`https://flip.yourdomain.com/api/webhooks/dink?token=...`).
3. Paste it into **RuneLite → Dink → Grand Exchange → Grand Exchange Webhook Override**.
4. Your 8 GE slots, 4h buy limits, Offer Coach warnings, and realized post-tax profit will now sync 24/7!

## 6. Updating Later
```bash
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build
```
*(SQLite WAL data persists in the `osrs_data` Docker volume, and daily backups rotate for 7 days in `osrs_backups`.)*
