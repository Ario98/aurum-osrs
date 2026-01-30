"""Entry point for the OSRS price data collector."""

import sys

from collector.collector import PriceCollector
from collector.config import Config


def main():
    """Main entry point."""
    try:
        # Load configuration from environment
        config = Config.from_env()

        # Create and run collector
        collector = PriceCollector(config)
        collector.run()

    except Exception as e:
        print(f"Fatal error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
