# OSRS Flip Terminal

A real-time, self-hosted Old School RuneScape (OSRS) Grand Exchange flipping, overnight swing, and arbitrage dashboard powered by the [OSRS Wiki Real-Time Prices API](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices).

Built for speed and clarity: cold-starts from an empty database in **~20 seconds**, updates all **4,600+ tradeable items** live over WebSockets, accounts for the **2% Grand Exchange tax** (including the 5M GP cap and Jagex's tax-exempt item list), and integrates with the official **RuneLite Dink** plugin and **Discord webhooks**.

---

## Key Features

### Action-First Trading Terminal
- **Trade Calls (`Auto-Mix`, `Fast Flips`, `Big Margin`, `Dump Sniper`, `Alch Floor`):** Enter your cash stack (1M to 2B+) and P2P/F2P filter to get budget-sized buy/sell quantities, exact post-tax net profit, estimated fill time, GP/hr, and 1-click price copy.
- **Dedicated Overnight Flips (`8–12h`):** Anchors night bids near each item's 7-day hourly 25th-percentile troughs and morning targets near the 75th-percentile peaks, filters out multi-day downtrends, and displays a visual 7-day oscillation band and 8-hour fill confidence.
- **Dump Sniper & Mean-Reversion Transparency:** Measures standard deviation (`σ`) across hourly (`/1h`) candles (`24h` and `7d`), compares 24h vs. 7d trend drift to separate sudden panic dumps from slow multi-day bleeds, and provides 1-click **Safe Bounce** and **Full 7d Rebound** targets.
- **`Ctrl+K` Command Palette & Virtualized Scanner:** Jump to any of 4,600+ items instantaneously or filter/sort the full market at 60 FPS with presets for `0% Tax Exempt` and `>250M Tax Cap` mega-rares.

### Pro Charts, Microstructure & Arbitrage
- **Synchronized Two-Pane Charts (TradingView `lightweight-charts`):** Top pane renders High/Low prices with toggleable 24h & 7d VWAP lines (`30H 5m`, `15D 1h`, `90D 6h`, `1Y 24h` loaded lazily from `/timeseries`); synced bottom pane displays diverging **Instant-Buy (`↑` emerald) vs. Instant-Sell (`↓` rose) volume** with a live crosshair hover readout.
- **Interactive Flip Calculator:** Tweak Buy Price, Sell Price, and Quantity inside the wide Item Modal to preview exact 2% GE tax, capital required, and net ROI before starting a flip.
- **Deterministic Arbitrage Scanner:**
  - **GE Item Sets:** Pack & unpack margins (with expandable component pricing) after 2% tax.
  - **Bob Barter Potion Decanting:** Dynamically discovers all 1/2/3-dose → 4-dose conversions with both limit-order and instant-profit calculations.
  - **High Alchemy:** Live margins anchored to real-time Nature Rune prices.

### Live 8-Slot Tracking, Offer Coach & Alerts
- **Persistent 8-Slot Live Ribbon:** Displays all 8 GE slots across every screen with live status chips.
- **Overnight-Aware Proactive Offer Coach:** Monitors active slots against live market ticks — flags outbids, undercuts, and crash bailouts for fast flips, while staying calm during normal intraday swings on `Overnight` slots and alerting only on major trend breaks.
- **RuneLite Dink Integration:** Receives official [Dink](https://runelite.net/plugin-hub/show/dink) `GRAND_EXCHANGE` webhooks to auto-sync completed buys/sells, track 4-hour GE buy-limit cooldowns, and log realized post-tax profit & GP/hr.
- **Real-Time Alerts:** In-app WebSocket toasts + optional audio chime + **Discord Webhook** notifications with anti-spam cooldowns.

---

## Architecture

```text
OSRS Wiki Prices API (/mapping, /latest, /5m, /1h, /timeseries)
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│  FastAPI Backend (Python 3.12 · asyncio · httpx · NumPy) │
│  • 20s Tiered Bootstrap + Smart Downtime Gap-Filler      │
│  • In-Memory Market State (4,600+ items, ~5 MB RAM)      │
│  • 2% Tax Engine, Arbitrage Scanner, Offer Coach         │
│  • REST API + WebSocket Push + Dink Webhook Receiver     │
└──────────────┬───────────────────────────┬───────────────┘
               │                           │
               ▼                           ▼
     SQLite (WAL Mode)          React + TypeScript SPA
  • 5m: 14d · 1h: 90d           • Tailwind CSS (OLED Black)
  • 24h: Forever (<350 MB)      • TanStack Virtual + TradingView Charts
```

### How Cold Starts & Downtime Recovery Work
Instead of scraping months of 5-minute intervals on startup, the collector uses a **tiered multi-resolution bootstrap**:
1. Fetches `/mapping`, `/latest`, the last **24 hours of `/1h`**, and the last **2 hours of `/5m`** (~50 API calls total → tradable in **~20 seconds**).
2. Silently enriches the remaining **7 days of `/1h`** candles in the background without blocking the UI.
3. Fetches deep item history (`30h`, `15d`, `90d`, `1y`) lazily on demand via `/timeseries` with TTL caching.
4. On restart after downtime, only the missing recent buckets are fetched (warm restarts typically finish in **~1–2 seconds**).

### Grand Exchange 2% Tax Rules
Implements OSRS's May 2025+ Grand Exchange tax mechanics:
- **2%** seller tax, rounded down per unit (`floor(sell_price * 0.02)`).
- **5,000,000 GP** maximum tax cap per unit (reached at 250M+ GP).
- **0 GP** tax on items sold under 50 GP and on Jagex's explicit tax-exempt item list (Bonds, Mind runes, Energy potions, listed foods, low-tier ammo, standard teleports, and basic tools).

---

## Quick Start

### Option 1: Docker (Recommended — Single Container)
```bash
git clone https://github.com/Ario98/osrs_trading_dashboard.git
cd osrs_trading_dashboard
cp .env.example .env
```

Edit `.env` and set a descriptive `WIKI_USER_AGENT` (required by the OSRS Wiki API policy, e.g. your app name + Discord/GitHub contact), plus `APP_PASSWORD` if deploying publicly:

```bash
docker compose up -d --build
```
Open **http://localhost:8000**.

### Option 2: Local Development (Hot Reload)

**Backend (Python 3.11+):**
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

**Frontend (Node 20+):**
```bash
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173** (Vite proxies `/api` and `/ws` to port `8000`).

---

## Configuration (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `WIKI_USER_AGENT` | *(required)* | Descriptive `User-Agent` header with your contact info per OSRS Wiki API rules. |
| `PORT` | `8000` | HTTP port exposed by Docker Compose. |
| `DATABASE_PATH` | `./data/osrs_terminal.db` | Path to the SQLite WAL database file. |
| `APP_PASSWORD` | *(empty)* | Enables login protection when set. Leave empty for passwordless local/Tailnet use. |
| `SESSION_SECRET` | *(change in prod)* | Random 32-byte hex secret used to sign session cookies. |
| `DINK_WEBHOOK_TOKEN` | *(change in prod)* | Secret token required on `POST /api/webhooks/dink?token=...`. |
| `DISCORD_WEBHOOK_URL` | *(empty)* | Optional default Discord webhook URL (also editable in the Settings UI). |
| `DEFAULT_CASH_STACK` | `25000000` | Initial bankroll used for trade sizing (editable live in the top bar). |
| `DOMAIN` | `flip.yourdomain.com` | Public domain for automatic Let's Encrypt HTTPS in `deploy/docker-compose.prod.yml`. |

---

## Connecting RuneLite (Dink Plugin)

1. Open **Settings & Dink** in the dashboard and copy your private **Dink Webhook URL**.
2. In **RuneLite → Plugin Hub**, install **Dink**.
3. Open Dink settings → **Grand Exchange**:
   - Enable **Grand Exchange** notifications.
   - Paste your webhook URL into **Grand Exchange Webhook Override**.
   - Set **Min Value** to `1` and disable GE screenshots for faster delivery.
4. Click **Start Flip** (or **Start Night**) on the dashboard when placing a buy offer so the Proactive Offer Coach watches it live — Dink automatically updates the slot on `BOUGHT`, tracks your 4-hour buy limit, and logs realized post-tax profit to **Journal & Limits** when it sells.

---

## Self-Hosting on a VPS

The entire stack uses **< 350 MB RAM** and runs comfortably on a \$4–\$6/month VPS (e.g., Hetzner CX22/CAX11, DigitalOcean, or Oracle Free Tier):
- **Public HTTPS with Caddy:** See [deploy/hetzner-setup.md](deploy/hetzner-setup.md) and `deploy/docker-compose.prod.yml` (includes automatic Let's Encrypt TLS + daily 7-day rolling SQLite backups).
- **Private Tailnet-Only HTTPS:** Run behind `tailscale serve` so the dashboard and Dink webhooks are accessible from your PC and phone with zero public ports exposed.

---

## Running Tests

```bash
cd backend
pytest -v
```

```bash
cd frontend
npm run build
```

---

## Disclaimer & API Etiquette
- This project is a **read-only market analytics and tracking dashboard**. It never automates or interacts with the Old School RuneScape game client.
- Always configure a unique, descriptive `WIKI_USER_AGENT` in `.env` and respect the [OSRS Wiki Real-Time Prices API](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices) acceptable use guidelines.
