# OSRS Trading Dashboard

A comprehensive trading dashboard for Old School RuneScape (OSRS) that tracks Grand Exchange prices using the OSRS Wiki real-time prices API.

## Features

- **Real-time Price Tracking**: Continuously collects 5-minute price intervals from the OSRS Wiki API
- **Historical Data**: Backfills data from January 1, 2022 onwards
- **Interactive Charts**: Beautiful price history visualizations with time range selection
- **Market Overview**: Latest prices and profit margins for all tradeable items
- **Item Search**: Quick search for any OSRS item
- **Automatic Data Cleanup**: Removes data older than 4 years to manage storage
- **Respectful API Usage**: Rate-limited to 1 request per second with descriptive User-Agent

## Architecture

This project uses a microservices architecture with Docker:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Dashboard  │────▶│   Backend   │────▶│  Database   │
│   (React)   │     │  (FastAPI)  │     │(PostgreSQL) │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Collector  │
                    │   (Python)  │
                    └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ OSRS Wiki   │
                    │    API      │
                    └─────────────┘
```

### Services

1. **Database** (PostgreSQL)
   - Stores item metadata and price history
   - Persistent storage using Docker volumes
   - Includes views and cleanup functions

2. **Collector** (Python)
   - Initial backfill: Fetches all historical data from 2022-01-01
   - Continuous collection: Monitors for new 5-minute intervals
   - Rate-limited to 1 request/second
   - Inserts only new data (prevents duplicates)

3. **Backend** (FastAPI)
   - REST API for the dashboard
   - Endpoints for items, price history, and latest prices
   - Health checks and error handling

4. **Dashboard** (React)
   - Dark theme UI
   - Interactive price charts
   - Market overview with profit margins
   - Item search functionality

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- Git (for cloning the repository)
- At least 2GB of free disk space (for initial backfill)

## Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd osrs_trading_dashboard
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and set your database password:

```env
DB_PASSWORD=your_secure_password_here
```

### 3. Start the Services

```bash
# Start all services
docker-compose up -d

# Or start specific services
docker-compose up -d database  # Just the database
docker-compose up -d backend   # Database + backend
docker-compose up -d           # Everything
```

### 4. Monitor the Initial Backfill

The collector will automatically start backfilling data. Monitor its progress:

```bash
# View collector logs
docker-compose logs -f collector

# Or check the log file
docker exec -it osrs_collector tail -f logs/collector.log
```

**Note**: Initial backfill to January 2022 will take several hours (approximately 6-12 hours depending on your connection). The collector fetches data in 5-minute intervals going backwards in time.

### 5. Access the Dashboard

Once services are running:

- **Dashboard**: http://localhost:3000
- **API Documentation**: http://localhost:8000/docs
- **Database**: localhost:5432 (PostgreSQL)

## API Endpoints

### Health Check
- `GET /health` - Check if the service is running

### Items
- `GET /api/items` - List all items (with search and filter options)
- `GET /api/items/{id}` - Get specific item details

### Prices
- `GET /api/prices/latest` - Get latest prices for all items
- `GET /api/prices/{item_id}` - Get price history for a specific item
  - Query params: `start_date`, `end_date`, `limit`

## Project Structure

```
osrs_trading_dashboard/
├── database/
│   └── migrations/
│       └── 001_init_schema.sql    # Database schema
├── collector/
│   ├── collector/
│   │   ├── __init__.py
│   │   ├── config.py              # Configuration management
│   │   ├── database.py            # Database operations
│   │   ├── api_client.py          # OSRS Wiki API client
│   │   ├── collector.py           # Main collection logic
│   │   └── main.py                # Entry point
│   ├── Dockerfile
│   └── pyproject.toml
├── backend/
│   ├── main.py                    # FastAPI application
│   ├── Dockerfile
│   └── pyproject.toml
├── dashboard/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ItemSearch.js      # Item search component
│   │   │   └── PriceChart.js      # Price chart component
│   │   ├── services/
│   │   │   └── api.js             # API client
│   │   ├── App.js                 # Main application
│   │   ├── index.js               # Entry point
│   │   └── index.css              # Styles
│   ├── public/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml             # Docker orchestration
├── .env.example                   # Environment template
└── .gitignore
```

## Database Schema

### Tables

**items** - Item metadata
- `id` (PK) - Item ID
- `name` - Item name
- `examine` - Examine text
- `members` - Members-only status
- `lowalch`, `highalch` - Alchemy values
- `limit` - GE buy limit
- `value` - Item value
- `icon` - Icon filename

**price_history** - 5-minute price data
- `id` (PK) - Auto-generated
- `item_id` (FK) - Reference to items
- `timestamp` - 5-minute window start
- `avg_high_price` - Average high price
- `avg_low_price` - Average low price
- `high_price_volume` - Volume at high price
- `low_price_volume` - Volume at low price

**collection_state** - Tracks backfill progress
- `last_timestamp` - Last collected timestamp
- `is_initial_backfill_complete` - Backfill status

### Views

**latest_prices** - Current prices for all items

## Useful Commands

### Docker Compose

```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Stop and remove volumes (WARNING: deletes all data!)
docker-compose down -v

# View logs
docker-compose logs -f [service_name]

# Rebuild a service
docker-compose up -d --build [service_name]

# Scale collector (not recommended, single instance only)
docker-compose up -d --scale collector=1
```

### Database

```bash
# Access PostgreSQL CLI
docker exec -it osrs_database psql -U osrs_user -d osrs_trading

# Check table sizes
\dt+

# Query latest prices
SELECT * FROM latest_prices LIMIT 10;

# Check collection state
SELECT * FROM collection_state;

# Count total price records
SELECT COUNT(*) FROM price_history;
```

### Collector

```bash
# View collector logs
docker-compose logs -f collector

# Restart collector
docker-compose restart collector

# Run collector manually (for debugging)
docker exec -it osrs_collector python -m collector.main
```

## Troubleshooting

### Collector stops or fails

1. Check logs: `docker-compose logs collector`
2. Verify database is healthy: `docker-compose ps`
3. Restart collector: `docker-compose restart collector`

### Database connection issues

1. Check database is running: `docker-compose ps database`
2. Verify credentials in `.env` match `docker-compose.yml`
3. Check database logs: `docker-compose logs database`

### Dashboard not loading

1. Ensure backend is running: `docker-compose ps backend`
2. Check browser console for errors
3. Verify CORS is configured correctly

### Data not appearing

1. Check if backfill is complete:
   ```sql
   SELECT is_initial_backfill_complete, last_timestamp FROM collection_state;
   ```
2. Check for recent price records:
   ```sql
   SELECT MAX(timestamp) FROM price_history;
   ```
3. Verify collector is running: `docker-compose ps collector`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PASSWORD` | changeme | PostgreSQL password |
| `BACKFILL_START_DATE` | 2022-01-01 | Earliest date to backfill |
| `RATE_LIMIT_SECONDS` | 1 | API rate limit (seconds) |
| `LOG_LEVEL` | INFO | Logging level (DEBUG/INFO/WARNING/ERROR) |

### Customization

Edit `docker-compose.yml` to customize:
- Port mappings
- Resource limits
- Environment variables
- Volume locations

## Development

### Running Locally (without Docker)

**Backend:**
```bash
cd backend
pip install -e .
uvicorn main:app --reload
```

**Collector:**
```bash
cd collector
pip install -e .
python -m collector.main
```

**Dashboard:**
```bash
cd dashboard
npm install
npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -am 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Submit a pull request

## License

This project is for personal use. Please respect the OSRS Wiki API terms of use.

## Acknowledgments

- OSRS Wiki for providing the real-time prices API
- RuneLite for partnering with the OSRS Wiki on price data
- The OSRS community

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the logs: `docker-compose logs`
3. Open an issue on GitHub

---

**Happy Trading!** 🎮💰