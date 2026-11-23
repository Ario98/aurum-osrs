# OSRS Flip Terminal v2

A blazing-fast, action-first Old School RuneScape Grand Exchange flipping & arbitrage terminal powered by the OSRS Wiki Real-Time Prices API.

## Highlights
- **~20-Second Cold Start & Automatic Downtime Recovery:** Tiered bootstrap fetches `/mapping`, `/latest`, last 24h of `/1h`, and last 2h of `/5m` (~50 API calls total), then silently enriches 7 days of hourly history in the background.
- **Exact 2% GE Tax Engine (May 2025+ Rules):** Deducts 2% seller tax rounded down per unit, honors the 5M GP cap at 250M+ mega-rares, 0 tax under 50 GP, and Jagex's full official tax-exempt item list.
- **Action-First Command Center:** Enter your Cash Stack (1M–2B+) and mode (`Auto-Mix`, `Fast Flips`, `Big Margin`, `Dump Sniper`, `Alch Floor`) to get exact Buy/Sell prices, quantities, net post-tax profit, estimated fill time, and GP/hr.
- **Proactive Offer Coach & 8-Slot GE Tracker:** Monitors open GE offers live and flags when to relist or bail out on dumps.
- **RuneLite Dink Auto-Sync:** Paste your private webhook URL into RuneLite's official Dink plugin to auto-sync your 8 GE slots, 4-hour buy limits, and realized profit.
- **Deterministic Arbitrage:** Live GE Item Set pack/unpack scanner, Bob Barter potion decanting (1/2/3-dose → 4-dose), and High Alchemy margins using live Nature Rune prices.
- **Real-Time Alerts:** Live WebSocket toasts + audio chime + Discord Webhook pings.
- **Hetzner VPS Ready:** Single lean Docker container (`< 350 MB` RAM) + Caddy auto-HTTPS + rolling SQLite backups.

## Local Quick Start

### Option A: Docker (Single Command)
```bash
cp .env.example .env
docker compose up --build
```
Open **http://localhost:8000**.

### Option B: Local Dev (Hot Reload)
Terminal 1 (Backend):
```bash
cd backend
python -m venv .venv
.venv/Scripts/activate   # or source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Terminal 2 (Frontend):
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173**.

## Hetzner VPS Production Deployment
See [deploy/hetzner-setup.md](deploy/hetzner-setup.md) for the 5-minute Caddy auto-HTTPS setup guide.
