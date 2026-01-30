"""Main collector logic for OSRS price data collection."""

import logging
import sys
import time
from datetime import datetime, timedelta
from typing import Optional

from collector.api_client import OSRSApiClient
from collector.config import Config
from collector.database import DatabaseClient

logger = logging.getLogger(__name__)


class PriceCollector:
    """Handles both initial backfill and continuous data collection."""

    def __init__(self, config: Config):
        self.config = config
        self.db = DatabaseClient(config)
        self.api = OSRSApiClient(config)

    def setup_logging(self) -> None:
        """Configure logging for the collector."""
        log_level = getattr(logging, self.config.log_level.upper(), logging.INFO)

        # Console handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(log_level)
        console_formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        )
        console_handler.setFormatter(console_formatter)

        # File handler
        file_handler = logging.FileHandler("logs/collector.log")
        file_handler.setLevel(logging.DEBUG)
        file_formatter = logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s"
        )
        file_handler.setFormatter(file_formatter)

        # Root logger configuration
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.DEBUG)
        root_logger.addHandler(console_handler)
        root_logger.addHandler(file_handler)

        logger.info(f"Logging configured with level {self.config.log_level}")

    def initialize_items(self) -> None:
        """Fetch and store item mapping data."""
        logger.info("Initializing items table...")

        items = self.api.get_mapping()
        if items:
            count = self.db.insert_items(items)
            logger.info(f"Initialized {count} items in database")
        else:
            logger.warning("No items retrieved from API")

    def do_initial_backfill(self) -> None:
        """Perform initial backfill from the earliest available data to target date."""
        logger.info("Starting initial backfill process...")

        # Parse backfill start date
        backfill_start = datetime.strptime(self.config.backfill_start_date, "%Y-%m-%d")
        backfill_start = backfill_start.replace(tzinfo=None)  # Make it naive UTC

        logger.info(f"Target backfill date: {backfill_start}")

        # Get current prices first (this gives us the most recent timestamp)
        current_timestamp, current_prices = self.api.get_5min_prices()

        if current_prices:
            price_data = self.api.parse_price_data(current_prices)
            self.db.insert_price_data(price_data, current_timestamp)
            logger.info(f"Inserted current data: {current_timestamp}")

        # Calculate how far back we need to go
        earliest_timestamp = current_timestamp
        total_inserted = len(current_prices) if current_prices else 0

        # Work backwards in time
        while earliest_timestamp > backfill_start:
            # Calculate the next timestamp to fetch (5 minutes earlier)
            next_timestamp = earliest_timestamp - timedelta(minutes=5)
            next_unix_ts = int(next_timestamp.timestamp())

            try:
                timestamp_dt, prices = self.api.get_5min_prices(next_unix_ts)

                if prices:
                    price_data = self.api.parse_price_data(prices)
                    inserted = self.db.insert_price_data(price_data, timestamp_dt)
                    total_inserted += inserted

                    logger.info(
                        f"Backfill progress: {timestamp_dt} | "
                        f"Inserted: {inserted} | Total: {total_inserted} | "
                        f"Progress: {(timestamp_dt - backfill_start).days} days to go"
                    )
                else:
                    logger.warning(f"No data for timestamp {timestamp_dt}")

                # Update the earliest timestamp
                earliest_timestamp = timestamp_dt

                # Update collection state periodically
                if total_inserted % 10000 == 0:
                    self.db.update_collection_state(
                        timestamp_dt, is_initial_backfill_complete=False
                    )

            except Exception as e:
                logger.error(f"Error fetching data for timestamp {next_timestamp}: {e}")
                # Continue to next timestamp even if this one fails
                earliest_timestamp = next_timestamp
                continue

        # Mark backfill as complete
        self.db.update_collection_state(current_timestamp, is_initial_backfill_complete=True)
        logger.info(f"Initial backfill complete! Total records inserted: {total_inserted}")

    def do_continuous_collection(self) -> None:
        """Continuously collect new price data."""
        logger.info("Starting continuous collection mode...")

        while True:
            try:
                # Get the last timestamp we collected
                state = self.db.get_collection_state()

                if not state or not state.get("last_timestamp"):
                    logger.error("No collection state found. Please run initial backfill first.")
                    break

                last_timestamp = state["last_timestamp"]

                # Calculate next timestamp to fetch
                next_timestamp = last_timestamp + timedelta(minutes=5)
                next_unix_ts = int(next_timestamp.timestamp())
                current_time = datetime.utcnow()

                # Only fetch if the data should be available (5 minutes have passed)
                if next_timestamp > current_time:
                    wait_seconds = (next_timestamp - current_time).total_seconds()
                    logger.info(f"Waiting {wait_seconds:.0f} seconds until next data point...")
                    time.sleep(min(wait_seconds, 60))  # Check at least every minute
                    continue

                # Fetch the data
                timestamp_dt, prices = self.api.get_5min_prices(next_unix_ts)

                if prices:
                    price_data = self.api.parse_price_data(prices)
                    inserted = self.db.insert_price_data(price_data, timestamp_dt)

                    # Update collection state
                    self.db.update_collection_state(timestamp_dt)

                    logger.info(f"Collected data for {timestamp_dt} | Inserted: {inserted} records")
                else:
                    logger.warning(f"No data available for {timestamp_dt}")
                    # Still update the state so we don't get stuck
                    self.db.update_collection_state(timestamp_dt)

                # Periodic cleanup of old data (once per day)
                if current_time.hour == 2 and current_time.minute < 5:
                    logger.info("Running daily cleanup of old data...")
                    deleted = self.db.cleanup_old_data()
                    if deleted > 0:
                        logger.info(f"Cleaned up {deleted} old records")

            except Exception as e:
                logger.error(f"Error in continuous collection: {e}", exc_info=True)
                logger.info("Waiting 60 seconds before retry...")
                time.sleep(60)

    def run(self) -> None:
        """Main entry point - determines whether to backfill or continue collection."""
        try:
            # Setup
            self.setup_logging()
            self.db.connect()

            # Initialize items (fetch mapping data)
            self.initialize_items()

            # Check collection state
            state = self.db.get_collection_state()

            if not state or not state.get("is_initial_backfill_complete"):
                logger.info("Initial backfill not complete. Starting backfill...")
                self.do_initial_backfill()
            else:
                logger.info(f"Initial backfill complete. Last collected: {state['last_timestamp']}")

            # Start continuous collection
            self.do_continuous_collection()

        except KeyboardInterrupt:
            logger.info("Collection stopped by user")
        except Exception as e:
            logger.error(f"Fatal error: {e}", exc_info=True)
            raise
        finally:
            self.db.disconnect()
            logger.info("Collector shutdown complete")
