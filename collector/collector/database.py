"""Database client for PostgreSQL operations."""

import logging
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values

from collector.config import Config

logger = logging.getLogger(__name__)


class DatabaseClient:
    """Handles all database operations for the collector."""

    def __init__(self, config: Config):
        self.config = config
        self._connection = None

    def connect(self) -> None:
        """Establish database connection."""
        try:
            self._connection = psycopg2.connect(self.config.database_url)
            self._connection.autocommit = False
            logger.info("Connected to PostgreSQL database")
        except psycopg2.Error as e:
            logger.error(f"Failed to connect to database: {e}")
            raise

    def disconnect(self) -> None:
        """Close database connection."""
        if self._connection:
            self._connection.close()
            logger.info("Disconnected from PostgreSQL database")

    @contextmanager
    def cursor(self):
        """Context manager for database cursor."""
        if self._connection is None:
            raise RuntimeError("Database not connected. Call connect() first.")
        cursor = self._connection.cursor()
        try:
            yield cursor
            self._connection.commit()
        except Exception as e:
            self._connection.rollback()
            logger.error(f"Database operation failed: {e}")
            raise
        finally:
            cursor.close()

    def insert_items(self, items: List[Dict[str, Any]]) -> int:
        """Insert or update items in the database.

        Args:
            items: List of item dictionaries from the mapping endpoint

        Returns:
            Number of items inserted/updated
        """
        if not items:
            return 0

        query = """
            INSERT INTO items (id, name, examine, members, lowalch, highalch, "limit", value, icon)
            VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                examine = EXCLUDED.examine,
                members = EXCLUDED.members,
                lowalch = EXCLUDED.lowalch,
                highalch = EXCLUDED.highalch,
                "limit" = EXCLUDED."limit",
                value = EXCLUDED.value,
                icon = EXCLUDED.icon,
                updated_at = CURRENT_TIMESTAMP
        """

        values = [
            (
                item["id"],
                item.get("name", ""),
                item.get("examine", ""),
                item.get("members", False),
                item.get("lowalch"),
                item.get("highalch"),
                item.get("limit"),
                item.get("value"),
                item.get("icon", ""),
            )
            for item in items
        ]

        with self.cursor() as cur:
            execute_values(cur, query, values)
            count = cur.rowcount

        logger.info(f"Inserted/updated {count} items")
        return count

    def insert_price_data(
        self, price_data: List[Tuple[int, Dict[str, Any]]], timestamp: datetime
    ) -> int:
        """Insert price history data.

        Args:
            price_data: List of (item_id, price_data_dict) tuples from the API
            timestamp: The timestamp for this price window

        Returns:
            Number of prices inserted
        """
        if not price_data:
            return 0

        query = """
            INSERT INTO price_history (item_id, timestamp, avg_high_price, avg_low_price, 
                                      high_price_volume, low_price_volume)
            VALUES %s
            ON CONFLICT (item_id, timestamp) DO NOTHING
        """

        values = [
            (
                item_id,
                timestamp,
                data.get("avgHighPrice"),
                data.get("avgLowPrice"),
                data.get("highPriceVolume"),
                data.get("lowPriceVolume"),
            )
            for item_id, data in price_data
        ]

        with self.cursor() as cur:
            execute_values(cur, query, values)
            count = cur.rowcount

        logger.info(f"Inserted {count} price records for timestamp {timestamp}")
        return count

    def get_collection_state(self) -> Optional[Dict[str, Any]]:
        """Get the current collection state.

        Returns:
            Dictionary with last_timestamp, is_initial_backfill_complete, updated_at
            or None if no state exists
        """
        query = "SELECT last_timestamp, is_initial_backfill_complete, updated_at FROM collection_state WHERE id = 1"

        with self.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()

            if row:
                return {
                    "last_timestamp": row[0],
                    "is_initial_backfill_complete": row[1],
                    "updated_at": row[2],
                }
            return None

    def update_collection_state(
        self, last_timestamp: datetime, is_initial_backfill_complete: Optional[bool] = None
    ) -> None:
        """Update the collection state.

        Args:
            last_timestamp: The latest timestamp we've collected
            is_initial_backfill_complete: Whether initial backfill is done
        """
        if is_initial_backfill_complete is not None:
            query = """
                UPDATE collection_state 
                SET last_timestamp = %s, 
                    is_initial_backfill_complete = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            """
            params = (last_timestamp, is_initial_backfill_complete)
        else:
            query = """
                UPDATE collection_state 
                SET last_timestamp = %s, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
            """
            params = (last_timestamp,)

        with self.cursor() as cur:
            cur.execute(query, params)

        logger.info(
            f"Updated collection state: last_timestamp={last_timestamp}, "
            f"backfill_complete={is_initial_backfill_complete}"
        )

    def get_earliest_timestamp(self) -> Optional[datetime]:
        """Get the earliest timestamp in the price_history table.

        Returns:
            The earliest timestamp or None if no data exists
        """
        query = "SELECT MIN(timestamp) FROM price_history"

        with self.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()

            if row and row[0]:
                return row[0]
            return None

    def get_latest_timestamp(self) -> Optional[datetime]:
        """Get the latest timestamp in the price_history table.

        Returns:
            Latest timestamp or None if no data exists
        """
        query = "SELECT MAX(timestamp) FROM price_history"

        with self.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()
            return row[0] if row and row[0] else None

    def cleanup_old_data(self) -> int:
        """Remove price data older than 4 years.

        Returns:
            Number of records deleted
        """
        with self.cursor() as cur:
            cur.execute("SELECT cleanup_old_price_data()")
            row = cur.fetchone()
            deleted_count = row[0] if row else 0

        if deleted_count > 0:
            logger.info(f"Cleaned up {deleted_count} old price records (older than 4 years)")

        return deleted_count
