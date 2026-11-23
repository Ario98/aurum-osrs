"""Exact Old School RuneScape Grand Exchange 2% tax rules (May 2025 update)."""

from __future__ import annotations

import math

GE_TAX_RATE = 0.02
GE_TAX_CAP = 5_000_000
GE_TAX_MIN_PRICE = 50
GE_MEGA_RARE_CAP_THRESHOLD = 250_000_000  # 2% of 250M == 5M cap

# Official Jagex Grand Exchange tax-exempt item names (normalized lowercase).
# Matching against exact item names from /mapping avoids brittle hardcoded IDs.
TAX_EXEMPT_NAMES: frozenset[str] = frozenset(
    {
        # Bond
        "old school bond",
        # Runes
        "mind rune",
        # Low-level Food
        "bass",
        "bread",
        "cake",
        "cooked chicken",
        "cooked meat",
        "herring",
        "lobster",
        "mackerel",
        "meat pie",
        "pike",
        "salmon",
        "shrimps",
        "tuna",
        # Energy potions
        "energy potion(1)",
        "energy potion(2)",
        "energy potion(3)",
        "energy potion(4)",
        # Low-tier Ammunition
        "bronze arrow",
        "bronze dart",
        "iron arrow",
        "iron dart",
        "steel arrow",
        "steel dart",
        # Teleports & Jewelry
        "ardougne teleport",
        "camelot teleport",
        "civitas illa fortis teleport",
        "falador teleport",
        "kourend castle teleport",
        "lumbridge teleport",
        "teleport to house",
        "varrock teleport",
        "games necklace(8)",
        "ring of dueling(8)",
        # Basic Tools & Skilling Equipment
        "chisel",
        "gardening trowel",
        "glassblowing pipe",
        "hammer",
        "needle",
        "pestle and mortar",
        "rake",
        "saw",
        "secateurs",
        "seed dibber",
        "shears",
        "spade",
        "watering can",
    }
)


def is_tax_exempt_name(item_name: str | None) -> bool:
    """Return True if the item is on Jagex's explicit GE tax-exempt list."""
    if not item_name:
        return False
    return item_name.strip().lower() in TAX_EXEMPT_NAMES


def calculate_ge_tax(sell_price: int, item_name: str | None = None, *, exempt: bool = False) -> int:
    """Calculate exact per-unit Grand Exchange tax on a sale.

    Rules (May 2025+):
    - 2% of sell price, rounded down per item.
    - 0 GP if sell_price < 50 GP (since floor(49 * 0.02) == 0).
    - 0 GP if item is on Jagex's explicit tax-exempt list.
    - Capped at 5,000,000 GP per item (reached at 250,000,000 GP).
    """
    if sell_price < GE_TAX_MIN_PRICE or exempt or is_tax_exempt_name(item_name):
        return 0
    return min(math.floor(sell_price * GE_TAX_RATE), GE_TAX_CAP)


def calculate_net_flip(
    buy_price: int,
    sell_price: int,
    quantity: int = 1,
    item_name: str | None = None,
    *,
    exempt: bool = False,
) -> tuple[int, int, float]:
    """Return (tax_per_unit, total_net_profit, net_roi_pct) for a flip."""
    if buy_price <= 0 or sell_price <= 0 or quantity <= 0:
        return 0, 0, 0.0
    tax_unit = calculate_ge_tax(sell_price, item_name=item_name, exempt=exempt)
    net_unit = sell_price - buy_price - tax_unit
    total_profit = net_unit * quantity
    roi_pct = (net_unit / buy_price) * 100.0
    return tax_unit, total_profit, roi_pct
