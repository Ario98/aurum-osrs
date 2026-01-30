# OSRS Trading Dashboard

A comprehensive trading dashboard for Old School RuneScape (OSRS) that tracks Grand Exchange prices using the OSRS Wiki real-time prices API.

## Features

- **Real-time Price Tracking**: Continuously collects 5-minute price intervals from the OSRS Wiki API
- **Historical Data**: Backfills data from January 1, 2025 onwards (configurable)
- **Interactive Charts**: Price history visualizations with multiple time ranges
- **Market Overview**: Latest prices and profit margins for all tradeable items
- **Item Search**: Quick search for any OSRS item
- **Smart Collection**: Fast catch-up mode when collector falls behind, with rate limiting
- **Automatic Cleanup**: Removes data older than 4 years to manage storage

## Architecture

Microservices architecture with Docker:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Dashboard  │────▶│   Backend   │────▶│  Database   │
│   (React)   │     │  (FastAPI)  │     │(PostgreSQL) │
└─────────────┘     └─────────────┘     └─────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │     Dual Collectors     │
              │  ┌───────────────────┐  │
              │  │  Backfill Mode    │  │
              │  │ (Historical Data) │  │
              │  └───────────────────┘  │
              │  ┌───────────────────┐  │
              │  │  Continuous Mode  │  │
              │  │ (Real-time Data)  │  │
              │  └───────────────────┘  │
              └─────────────────────────┘
                            │
                            ▼
                     ┌─────────────┐
                     │ OSRS Wiki   │
                     │    API      │
                     └─────────────┘
```

### Services

| Service | Technology | Purpose |
|---------|-----------|---------|
| **Database** | PostgreSQL | Stores item metadata and price history (persistent) |
| **Collector (Backfill)** | Python | Fills historical data backwards from 2025-01-01 |
| **Collector (Continuous)** | Python | Collects new 5-minute intervals with fast catch-up mode |
| **Backend** | FastAPI | REST API for dashboard queries |
| **Dashboard** | React | Dark theme UI with charts and search |

## Quick Start

### 1. Clone and Configure

```bash
git clone <your-repo-url>
cd osrs_trading_dashboard
cp .env.example .env
# Edit .env and set DB_PASSWORD
```

### 2. Start Services

```bash
docker-compose up -d
```

### 3. Monitor Progress

```bash
# Check all services are running
docker-compose ps

# Watch backfill progress
docker-compose logs -f collector-backfill

# Watch continuous collection
docker-compose logs -f collector-continuous
```

### 4. Access Dashboard

- **Dashboard**: http://localhost:3000
- **API Docs**: http://localhost:8000/docs

**Note**: Initial backfill to January 2025 will take several hours. The continuous collector starts automatically and maintains real-time data.

## API Endpoints

- `GET /health` - Health check
- `GET /api/items` - List items (with search/filter)
- `GET /api/items/{id}` - Item details
- `GET /api/items/search?q={query}` - Search suggestions
- `GET /api/prices/latest` - Latest prices for all items
- `GET /api/prices/{item_id}` - Price history for item

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PASSWORD` | changeme | PostgreSQL password |
| `BACKFILL_START_DATE` | 2025-01-01 | Earliest date for backfill |
| `RATE_LIMIT_SECONDS` | 1 | API rate limit between requests |

### Dual Collector Setup

The system uses two separate collectors:

1. **collector-backfill**: Starts first, fills historical data backwards
   - Configurable start date (default: 2025-01-01)
   - Runs until target date reached
   
2. **collector-continuous**: Starts after backfill begins, collects real-time data
   - Automatically detects gaps >30 min and enters "fast catch-up mode"
   - Processes rapidly until caught up, then resumes normal 90s intervals
   - Never skips timestamps unless >15 min old

## Useful Commands

```bash
# View all logs
docker-compose logs -f

# Check database
docker exec -it osrs_database psql -U osrs_user -d osrs_trading -c "SELECT MAX(timestamp) FROM price_history;"

# Check collection state
docker exec -it osrs_database psql -U osrs_user -d osrs_trading -c "SELECT * FROM collection_state;"

# Restart a service
docker-compose restart collector-continuous

# Stop everything
docker-compose down

# Clean start (removes all data!)
docker-compose down -v
```

## Troubleshooting

### Dashboard shows old data

Check continuous collector is running:
```bash
docker-compose ps collector-continuous
docker-compose logs collector-continuous | tail -20
```

### Large gap in recent data

The continuous collector will automatically enter fast catch-up mode when >30 min behind. Monitor with:
```bash
docker-compose logs -f collector-continuous | grep -i "catch-up\|behind"
```

### Database connection issues

1. Verify database is healthy: `docker-compose ps database`
2. Check credentials in `.env` match
3. Restart: `docker-compose restart database backend collector-continuous`

## Project Structure

```
osrs_trading_dashboard/
├── database/
│   └── migrations/001_init_schema.sql
├── collector/
│   ├── collector/           # Python collector package
│   │   ├── collector.py     # Main collection logic (dual mode)
│   │   ├── api_client.py    # OSRS Wiki API client
│   │   └── database.py      # Database operations
│   ├── Dockerfile
│   └── pyproject.toml
├── backend/
│   ├── main.py              # FastAPI application
│   └── Dockerfile
├── dashboard/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── App.js           # Main app with search
│   │   └── services/api.js  # API client
│   └── Dockerfile
├── docker-compose.yml       # Dual collector configuration
└── README.md
```

## Database Schema

**items**: Item metadata (id, name, examine, members, alch values, limit)

**price_history**: 5-minute price data (timestamp, avg_high_price, avg_low_price, volumes)

**collection_state**: Tracks collection progress (last_timestamp, backfill_complete)

## Development

Run services individually without Docker:

```bash
# Backend
cd backend && pip install -e . && uvicorn main:app --reload

# Collector
cd collector && pip install -e . && python -m collector.main

# Dashboard
cd dashboard && npm install && npm start
```

## License

For personal use. Please respect the OSRS Wiki API terms of use.

**Happy Trading!** 🎮💰
