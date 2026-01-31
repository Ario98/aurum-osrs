"""OSRS Trading Dashboard Backend API

This FastAPI application provides endpoints for the dashboard frontend
to access OSRS trading data.
"""

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, List, Optional

import psycopg2
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configure logging
logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Database configuration
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "database"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "dbname": os.getenv("DB_NAME", "osrs_trading"),
    "user": os.getenv("DB_USER", "osrs_user"),
    "password": os.getenv("DB_PASSWORD", "changeme"),
}


def get_db_connection():
    """Get a database connection."""
    return psycopg2.connect(**DB_CONFIG)


# Pydantic models for API responses
class Item(BaseModel):
    id: int
    name: str
    examine: Optional[str]
    members: bool
    lowalch: Optional[int]
    highalch: Optional[int]
    limit: Optional[int]
    value: Optional[int]
    icon: Optional[str]


class ItemWithPrice(Item):
    buy_price: int  # This is high price (what buyers pay)
    sell_price: int  # This is low price (what sellers receive)
    buy_timestamp: Optional[datetime] = None
    sell_timestamp: Optional[datetime] = None
    margin: int
    tax: int  # min(sell_price * 0.02, 5000000)
    tax_status: str  # 'none', 'normal', or 'capped'
    profit: int  # sell_price - buy_price - tax
    roi: float  # (profit / buy_price) * 100
    high_volume: int
    low_volume: int


class ItemSuggestion(BaseModel):
    id: int
    name: str
    buy_price: int
    sell_price: int


class ItemsResponse(BaseModel):
    items: List[ItemWithPrice]
    total: int
    page: int
    page_size: int


class SearchResponse(BaseModel):
    items: List[ItemSuggestion]


class PricePoint(BaseModel):
    item_id: int
    item_name: Optional[str]
    timestamp: datetime
    avg_high_price: Optional[int]
    avg_low_price: Optional[int]
    high_price_volume: Optional[int]
    low_price_volume: Optional[int]


class HealthCheck(BaseModel):
    status: str
    timestamp: datetime


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events."""
    logger.info("Backend API starting up...")
    # Test database connection on startup
    try:
        conn = get_db_connection()
        conn.close()
        logger.info("Database connection successful")
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        raise

    yield

    logger.info("Backend API shutting down...")


app = FastAPI(
    title="OSRS Trading Dashboard API",
    description="API for accessing OSRS Grand Exchange price data",
    version="0.2.0",
    lifespan=lifespan,
)

# Enable CORS for dashboard frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", response_model=HealthCheck)
async def root():
    """Root endpoint - API info."""
    return HealthCheck(status="OK", timestamp=datetime.utcnow())


@app.get("/health", response_model=HealthCheck)
async def health_check():
    """Health check endpoint."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        conn.close()
        return HealthCheck(status="healthy", timestamp=datetime.utcnow())
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(status_code=503, detail="Service unavailable")


@app.get("/api/items", response_model=ItemsResponse)
async def get_items(
    search: Optional[str] = Query(
        None, description="Search by item name (case-insensitive partial match)"
    ),
    sort_by: str = Query(
        "name",
        description="Sort column: name, buy_price, sell_price, margin, tax, profit, roi, high_volume, low_volume, buy_timestamp, sell_timestamp, limit",
    ),
    sort_order: str = Query("asc", description="Sort order: asc or desc"),
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(50, ge=1, le=100, description="Number of results per page"),
    members_only: Optional[bool] = Query(None, description="Filter by members status"),
):
    """Get list of items with their latest prices.

    Note: buy_price and sell_price come from the LATEST records with valid prices,
    which may be from different timestamps. This ensures we always have the most
    recent data for each price type.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Validate sort_by parameter
        valid_sort_columns = [
            "name",
            "buy_price",
            "sell_price",
            "margin",
            "tax",
            "profit",
            "roi",
            "high_volume",
            "low_volume",
            "buy_timestamp",
            "sell_timestamp",
            "limit",
        ]
        if sort_by not in valid_sort_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid sort_by. Must be one of: {', '.join(valid_sort_columns)}",
            )

        # Validate sort_order parameter
        if sort_order not in ["asc", "desc"]:
            raise HTTPException(status_code=400, detail="sort_order must be 'asc' or 'desc'")

        # Calculate offset
        offset = (page - 1) * page_size

        # Simple column mapping for items_with_metrics view
        sort_columns = {
            "name": "name",
            "buy_price": "buy_price",
            "sell_price": "sell_price",
            "margin": "margin",
            "tax": "tax",
            "profit": "profit",
            "roi": "roi",
            "high_volume": "high_volume",
            "low_volume": "low_volume",
            "buy_timestamp": "buy_timestamp",
            "sell_timestamp": "sell_timestamp",
            "limit": '"limit"',
        }

        sort_column = sort_columns[sort_by]
        order_direction = "ASC" if sort_order == "asc" else "DESC"

        # Simple query using items_with_metrics view
        query = f"""
            SELECT id, name, examine, members, lowalch, highalch, "limit", value, icon,
                   buy_price, sell_price, buy_timestamp, sell_timestamp, 
                   high_volume, low_volume, margin, tax, tax_status, profit, roi
            FROM items_with_metrics
            WHERE (%s IS NULL OR name ILIKE %s)
              AND (%s IS NULL OR members = %s)
            ORDER BY {sort_column} {order_direction} NULLS LAST
            LIMIT %s OFFSET %s
        """

        # Prepare parameters
        search_pattern = f"%{search}%" if search else None
        params = [
            search,  # $1 - IS NULL check for search
            search_pattern,  # $2 - ILIKE pattern
            members_only,  # $3 - IS NULL check for members_only
            members_only,  # $4 - members value
            page_size,  # $5 - LIMIT
            offset,  # $6 - OFFSET
        ]

        cursor.execute(query, params)
        rows = cursor.fetchall()

        items = []
        for row in rows:
            items.append(
                ItemWithPrice(
                    id=row[0],
                    name=row[1],
                    examine=row[2],
                    members=row[3],
                    lowalch=row[4],
                    highalch=row[5],
                    limit=row[6],
                    value=row[7],
                    icon=row[8],
                    buy_price=row[9],
                    sell_price=row[10],
                    buy_timestamp=row[11],
                    sell_timestamp=row[12],
                    high_volume=row[13],
                    low_volume=row[14],
                    margin=row[15],
                    tax=row[16],
                    tax_status=row[17],
                    profit=row[18],
                    roi=row[19],
                )
            )

        # Get total count for pagination
        count_query = """
            SELECT COUNT(*) 
            FROM items_with_metrics
            WHERE (%s IS NULL OR name ILIKE %s)
              AND (%s IS NULL OR members = %s)
        """
        cursor.execute(count_query, [search, search_pattern, members_only, members_only])
        total = cursor.fetchone()[0]

        cursor.close()
        conn.close()

        return ItemsResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching items: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch items")


@app.get("/api/items/search", response_model=SearchResponse)
async def search_items_suggestions(
    q: str = Query(..., min_length=2, description="Search query (min 2 characters)"),
):
    """Quick search for dropdown suggestions.

    Returns top 10 matching items with just id, name, buy_price, and sell_price
    for the navigation search dropdown.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        search_pattern = f"%{q}%"

        query = """
            SELECT i.id, i.name,
                   COALESCE(buy_data.avg_high_price, 0) as buy_price,
                   COALESCE(sell_data.avg_low_price, 0) as sell_price
            FROM items i
            LEFT JOIN LATERAL (
                SELECT avg_high_price
                FROM price_history 
                WHERE item_id = i.id AND avg_high_price IS NOT NULL
                ORDER BY timestamp DESC 
                LIMIT 1
            ) buy_data ON true
            LEFT JOIN LATERAL (
                SELECT avg_low_price
                FROM price_history 
                WHERE item_id = i.id AND avg_low_price IS NOT NULL
                ORDER BY timestamp DESC 
                LIMIT 1
            ) sell_data ON true
            WHERE i.name ILIKE %s
            ORDER BY 
                CASE WHEN i.name ILIKE %s THEN 0 ELSE 1 END,
                i.name
            LIMIT 10
        """

        exact_pattern = f"{q}%"
        cursor.execute(query, [search_pattern, exact_pattern])
        rows = cursor.fetchall()

        items = [
            ItemSuggestion(
                id=row[0],
                name=row[1],
                buy_price=row[2],
                sell_price=row[3],
            )
            for row in rows
        ]

        cursor.close()
        conn.close()

        return SearchResponse(items=items)
    except Exception as e:
        logger.error(f"Error searching items: {e}")
        raise HTTPException(status_code=500, detail="Failed to search items")


@app.get("/api/items/{item_id}", response_model=Item)
async def get_item(item_id: int):
    """Get specific item by ID."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Note: "limit" is a reserved keyword in PostgreSQL, so we quote it
        cursor.execute(
            """SELECT id, name, examine, members, lowalch, highalch, "limit", value, icon 
               FROM items WHERE id = %s""",
            (item_id,),
        )
        row = cursor.fetchone()

        cursor.close()
        conn.close()

        if not row:
            raise HTTPException(status_code=404, detail=f"Item {item_id} not found")

        return Item(
            id=row[0],
            name=row[1],
            examine=row[2],
            members=row[3],
            lowalch=row[4],
            highalch=row[5],
            limit=row[6],
            value=row[7],
            icon=row[8],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching item {item_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch item")


@app.get("/api/prices/{item_id}", response_model=List[PricePoint])
async def get_price_history(
    item_id: int,
    start_date: Optional[datetime] = Query(None, description="Start date (ISO format)"),
    end_date: Optional[datetime] = Query(None, description="End date (ISO format)"),
    limit: int = Query(1000, ge=1, le=10000, description="Number of results to return"),
):
    """Get price history for a specific item."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        query = """
            SELECT ph.item_id, i.name, ph.timestamp, ph.avg_high_price, 
                   ph.avg_low_price, ph.high_price_volume, ph.low_price_volume
            FROM price_history ph
            JOIN items i ON ph.item_id = i.id
            WHERE ph.item_id = %s
        """
        params: List[Any] = [item_id]

        if start_date:
            query += " AND ph.timestamp >= %s"
            params.append(start_date)

        if end_date:
            query += " AND ph.timestamp <= %s"
            params.append(end_date)

        # For year/all-time views with large date ranges, use higher limit
        # All-time view (no start_date) needs a limit to prevent loading all history
        query += " ORDER BY ph.timestamp DESC"
        if start_date:
            # Check if date range > 90 days (approx 3 months), use higher limit
            date_range_days = 365  # Default for year view
            if end_date and start_date:
                date_range_days = (end_date - start_date).days

            effective_limit = 50000 if date_range_days > 90 else limit
            query += " LIMIT %s"
            params.append(effective_limit)
        else:
            # All-time view: limit to 10000 records for performance
            # With 5-min intervals = ~35 days, with grouping = several months of data
            query += " LIMIT %s"
            params.append(10000)

        cursor.execute(query, params)
        rows = cursor.fetchall()

        prices = [
            PricePoint(
                item_id=row[0],
                item_name=row[1],
                timestamp=row[2],
                avg_high_price=row[3],
                avg_low_price=row[4],
                high_price_volume=row[5],
                low_price_volume=row[6],
            )
            for row in rows
        ]

        cursor.close()
        conn.close()

        return prices
    except Exception as e:
        logger.error(f"Error fetching price history for item {item_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch price history")


@app.get("/api/prices/latest", response_model=List[PricePoint])
async def get_latest_prices(
    limit: int = Query(100, ge=1, le=1000, description="Number of items to return"),
):
    """Get latest prices for all items."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        query = """
            SELECT DISTINCT ON (ph.item_id)
                ph.item_id, i.name, ph.timestamp, ph.avg_high_price, 
                ph.avg_low_price, ph.high_price_volume, ph.low_price_volume
            FROM price_history ph
            JOIN items i ON ph.item_id = i.id
            ORDER BY ph.item_id, ph.timestamp DESC
            LIMIT %s
        """

        cursor.execute(query, (limit,))
        rows = cursor.fetchall()

        prices = [
            PricePoint(
                item_id=row[0],
                item_name=row[1],
                timestamp=row[2],
                avg_high_price=row[3],
                avg_low_price=row[4],
                high_price_volume=row[5],
                low_price_volume=row[6],
            )
            for row in rows
        ]

        cursor.close()
        conn.close()

        return prices
    except Exception as e:
        logger.error(f"Error fetching latest prices: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch latest prices")


@app.get("/api/prices/{item_id}/weekly", response_model=List[PricePoint])
async def get_weekly_price_history(
    item_id: int,
    weeks: int = Query(52, ge=1, le=208, description="Number of weeks to return (max 4 years)"),
):
    """Get weekly aggregated price history for year/all-time views.

    Returns weekly aggregated data with:
    - High price: MAX of all high prices in the week
    - Low price: MIN of all low prices in the week
    - Volumes: SUM of all volumes in the week

    This is much faster than returning all 5-minute data points.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        query = """
            SELECT 
                ph.item_id,
                i.name,
                DATE_TRUNC('week', ph.timestamp) as week_start,
                MAX(ph.avg_high_price) as week_high,
                MIN(ph.avg_low_price) as week_low,
                SUM(ph.high_price_volume) as total_buy_volume,
                SUM(ph.low_price_volume) as total_sell_volume
            FROM price_history ph
            JOIN items i ON ph.item_id = i.id
            WHERE ph.item_id = %s
            GROUP BY ph.item_id, i.name, DATE_TRUNC('week', ph.timestamp)
            ORDER BY week_start DESC
            LIMIT %s
        """

        cursor.execute(query, (item_id, weeks))
        rows = cursor.fetchall()

        prices = [
            PricePoint(
                item_id=row[0],
                item_name=row[1],
                timestamp=row[2],
                avg_high_price=row[3],
                avg_low_price=row[4],
                high_price_volume=row[5],
                low_price_volume=row[6],
            )
            for row in rows
        ]

        cursor.close()
        conn.close()

        return prices
    except Exception as e:
        logger.error(f"Error fetching weekly price history for item {item_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch weekly price history")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
