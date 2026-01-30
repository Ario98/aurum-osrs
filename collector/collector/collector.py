"""Main collector logic for OSRS price data collection."""

import logging
import sys
import time
from datetime import datetime, timedelta, timezone
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

    def do_backfill_collection(self) -> None:
        """Perform backfill collection going backwards from earliest DB data to target date."""
        logger.info("Starting backfill collection mode...")

        # Parse backfill start date (ensure UTC timezone)
        backfill_start = datetime.strptime(self.config.backfill_start_date, "%Y-%m-%d")
        backfill_start = backfill_start.replace(tzinfo=timezone.utc)

        logger.info(f"Target backfill date: {backfill_start}")

        # Get the earliest timestamp from database (or fetch current if DB is empty)
        earliest_timestamp = self.db.get_earliest_timestamp()
        total_inserted = 0

        if not earliest_timestamp:
            logger.info("No existing data in database. Fetching current data first...")
            current_timestamp, current_prices = self.api.get_5min_prices()
            if current_prices:
                price_data = self.api.parse_price_data(current_prices)
                self.db.insert_price_data(price_data, current_timestamp)
                logger.info(f"Inserted current data: {current_timestamp}")
                earliest_timestamp = current_timestamp
                total_inserted = len(current_prices)
            else:
                logger.error("No data available from API. Exiting.")
                return

        logger.info(f"Starting backfill from: {earliest_timestamp}")

        # Work backwards in time until we reach backfill_start_date
        current_earliest = earliest_timestamp
        while current_earliest > backfill_start:
            # Calculate the next timestamp to fetch (5 minutes earlier)
            next_timestamp = current_earliest - timedelta(minutes=5)
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
                        f"Days remaining: {(timestamp_dt - backfill_start).days}"
                    )
                else:
                    logger.warning(f"No data for timestamp {timestamp_dt}")

                # Update the current earliest timestamp
                current_earliest = timestamp_dt

                # Update collection state with current position
                self.db.update_collection_state(timestamp_dt)

            except Exception as e:
                logger.error(f"Error fetching data for timestamp {next_timestamp}: {e}")
                # Continue to next timestamp even if this one fails
                current_earliest = next_timestamp
                continue

        logger.info(f"Backfill complete! Total records inserted: {total_inserted}")
        logger.info(f"Reached target date: {backfill_start}")

    def do_continuous_collection(self) -> None:
        """Continuously collect new price data going forward from the latest timestamp."""
        logger.info("Starting continuous collection mode...")

        # Wait for initial data to be created by backfill collector
        logger.info("Checking for existing data in database...")
        latest_timestamp = self.db.get_latest_timestamp()

        while not latest_timestamp:
            logger.info(
                "No data in database yet. Waiting for backfill collector to create initial data..."
            )
            time.sleep(60)  # Check every 60 seconds
            latest_timestamp = self.db.get_latest_timestamp()

        # Determine if we need fast catch-up mode
        current_time = datetime.now(timezone.utc)
        time_gap = current_time - latest_timestamp
        fast_catchup_threshold = timedelta(minutes=30)
        realtime_threshold = timedelta(minutes=5)

        if time_gap > fast_catchup_threshold:
            estimated_intervals = int(time_gap.total_seconds() / 300)
            logger.warning(
                f"FAST CATCH-UP MODE: Database is {time_gap} behind current time!\n"
                f"Latest DB timestamp: {latest_timestamp}\n"
                f"Current time: {current_time}\n"
                f"Estimated intervals to catch up: {estimated_intervals}\n"
                f"Will process rapidly until caught up (< 5 min behind)."
            )
            fast_catchup_mode = True
        else:
            logger.info(
                f"Found data! Starting continuous collection from: {latest_timestamp}\n"
                f"Time gap: {time_gap} - Using normal real-time mode."
            )
            fast_catchup_mode = False

        last_timestamp = latest_timestamp

        while True:
            try:
                # Calculate next timestamp to fetch
                next_timestamp = last_timestamp + timedelta(minutes=5)
                next_unix_ts = int(next_timestamp.timestamp())
                current_time = datetime.now(timezone.utc)

                # Check if we've caught up to real-time
                if next_timestamp > current_time:
                    # Caught up! Switch to normal mode if we were in fast mode
                    if fast_catchup_mode:
                        logger.info(
                            "CAUGHT UP TO REAL-TIME! Switching from fast catch-up to normal mode.\n"
                            "Will now wait 90 seconds between collections."
                        )
                        fast_catchup_mode = False

                    # Normal wait
                    wait_seconds = 90
                    logger.info(
                        f"Caught up to real-time. Waiting {wait_seconds} seconds before next check..."
                    )
                    time.sleep(wait_seconds)
                    continue

                # Calculate how far behind we are
                time_diff = current_time - next_timestamp

                # In fast catch-up mode, periodically log progress
                if fast_catchup_mode:
                    intervals_remaining = int(time_diff.total_seconds() / 300)
                    if intervals_remaining % 10 == 0 or intervals_remaining < 5:
                        logger.info(
                            f"Fast catch-up progress: {intervals_remaining} intervals remaining.\n"
                            f"Processing timestamp: {next_timestamp}"
                        )

                # Fetch the data
                timestamp_dt, prices = self.api.get_5min_prices(next_unix_ts)

                if prices:
                    price_data = self.api.parse_price_data(prices)
                    inserted = self.db.insert_price_data(price_data, timestamp_dt)

                    # Update collection state
                    self.db.update_collection_state(timestamp_dt)
                    last_timestamp = timestamp_dt

                    if fast_catchup_mode:
                        # In fast mode, only log every 10th interval or milestones
                        if inserted % 10 == 0 or time_diff < realtime_threshold:
                            logger.info(
                                f"Fast catch-up: {timestamp_dt} | Inserted: {inserted} | "
                                f"{int(time_diff.total_seconds() / 300)} intervals behind"
                            )
                    else:
                        logger.info(
                            f"Collected data for {timestamp_dt} | Inserted: {inserted} records"
                        )

                    # Check if we should exit fast catch-up mode
                    if fast_catchup_mode and time_diff < realtime_threshold:
                        logger.info(
                            f"Exiting fast catch-up mode. Now only {time_diff} behind real-time.\n"
                            "Switching to normal collection with 90-second waits."
                        )
                        fast_catchup_mode = False
                else:
                    logger.warning(f"No data available for {timestamp_dt} (diff: {time_diff})")

                    # Only advance if we're more than 15 minutes behind real-time
                    # Otherwise, keep retrying the same timestamp until data appears
                    if time_diff > timedelta(minutes=15):
                        logger.info(
                            f"Timestamp {timestamp_dt} is >15 min old with no data. Skipping."
                        )
                        self.db.update_collection_state(timestamp_dt)
                        last_timestamp = timestamp_dt
                    else:
                        wait_msg = "90s" if not fast_catchup_mode else "immediate retry"
                        logger.info(
                            f"Timestamp {timestamp_dt} is recent. Waiting {wait_msg} before retry..."
                        )
                        if not fast_catchup_mode:
                            time.sleep(90)

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
        """Main entry point - determines mode and runs appropriate collection logic."""
        try:
            # Setup
            self.setup_logging()

            # Connect to database
            self.db.connect()

            # Initialize items table (if needed)
            self.initialize_items()

            # Run based on configuration mode
            if self.config.collector_mode == "backfill":
                self.do_backfill_collection()
            elif self.config.collector_mode == "continuous":
                self.do_continuous_collection()
            else:
                logger.error(f"Unknown collector mode: {self.config.collector_mode}")
                sys.exit(1)

        except KeyboardInterrupt:
            logger.info("Collection stopped by user")
        except Exception as e:
            logger.error(f"Fatal error in collector: {e}", exc_info=True)
            sys.exit(1)
