"""OSRS Wiki API client for fetching price and mapping data."""

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

from collector.config import Config

logger = logging.getLogger(__name__)


class OSRSApiClient:
    """Client for interacting with the OSRS Wiki Prices API."""

    def __init__(self, config: Config):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": config.user_agent,
                "Accept": "application/json",
            }
        )
        self._last_request_time = 0.0

    def _rate_limit(self) -> None:
        """Ensure we don't exceed the rate limit."""
        min_interval = self.config.rate_limit_seconds
        elapsed = time.time() - self._last_request_time

        if elapsed < min_interval:
            sleep_time = min_interval - elapsed
            logger.debug(f"Rate limiting: sleeping for {sleep_time:.2f} seconds")
            time.sleep(sleep_time)

        self._last_request_time = time.time()

    def _make_request(self, endpoint: str, params: Optional[Dict] = None) -> Any:
        """Make a rate-limited API request.

        Args:
            endpoint: API endpoint (e.g., "/mapping", "/5m")
            params: Optional query parameters

        Returns:
            JSON response (can be dict, list, etc. depending on endpoint)

        Raises:
            requests.RequestException: If the request fails
        """
        self._rate_limit()

        url = f"{self.config.api_base_url}{endpoint}"
        logger.debug(f"Making request to {url} with params {params}")

        try:
            response = self.session.get(url, params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.Timeout:
            logger.error(f"Request to {url} timed out")
            raise
        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error {e.response.status_code} for {url}: {e}")
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed for {url}: {e}")
            raise

    def get_mapping(self) -> List[Dict[str, Any]]:
        """Fetch item mapping data.

        Returns:
            List of item dictionaries with metadata
        """
        logger.info("Fetching item mapping data...")
        data = self._make_request("/mapping")
        logger.info(f"Retrieved {len(data)} items from mapping endpoint")
        return data

    def get_latest_prices(self) -> Dict[int, Dict[str, Any]]:
        """Fetch latest prices for all items.

        Returns:
            Dictionary mapping item_id to price data
        """
        logger.info("Fetching latest prices...")
        data = self._make_request("/latest")

        # Convert string keys to integers
        prices = {int(k): v for k, v in data.get("data", {}).items()}
        logger.info(f"Retrieved latest prices for {len(prices)} items")
        return prices

    def get_5min_prices(
        self, timestamp: Optional[int] = None
    ) -> Tuple[datetime, Dict[int, Dict[str, Any]]]:
        """Fetch 5-minute prices for a specific timestamp or current.

        Args:
            timestamp: Unix timestamp (optional). If None, gets current data.

        Returns:
            Tuple of (timestamp_datetime, prices_dict)
        """
        params = {}
        if timestamp is not None:
            params["timestamp"] = timestamp
            logger.info(f"Fetching 5-minute prices for timestamp {timestamp}...")
        else:
            logger.info("Fetching current 5-minute prices...")

        data = self._make_request("/5m", params=params)

        # Get the timestamp from the response
        ts = data.get("timestamp")
        if ts is None:
            raise ValueError("No timestamp in API response")

        timestamp_dt = datetime.fromtimestamp(ts, tz=timezone.utc)

        # Convert string keys to integers
        prices = {int(k): v for k, v in data.get("data", {}).items()}

        logger.info(f"Retrieved {len(prices)} price records for timestamp {timestamp_dt}")
        return timestamp_dt, prices

    def parse_price_data(
        self, prices: Dict[int, Dict[str, Any]]
    ) -> List[Tuple[int, Dict[str, Any]]]:
        """Parse price data into a list of tuples for database insertion.

        Args:
            prices: Dictionary of item_id -> price_data

        Returns:
            List of (item_id, price_data) tuples
        """
        return list(prices.items())
