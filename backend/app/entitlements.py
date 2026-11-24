"""Central feature-tier & entitlement registry for future public SaaS gating.

When `settings.billing_enforced` is False (default for private/self-hosted deployments),
EVERY feature is unlocked and `show_upgrade_ui` is False so no paywall or Pro badges
appear anywhere in the UI. When launching publicly with subscriptions, flip
`BILLING_ENFORCED=true` and resolve `plan` from the authenticated user's subscription.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from app.config import Settings


class FeatureKey(StrEnum):
    ML_PREDICTIONS = "ml_predictions"
    ML_BOOST = "ml_boost"
    DUMP_SNIPER = "dump_sniper"
    DISCORD_ALERTS = "discord_alerts"
    EXTENDED_HISTORY_90D = "extended_history_90d"


class PlanTier(StrEnum):
    FREE = "free"
    PRO = "pro"


# Declarative feature -> minimum required plan when BILLING_ENFORCED=true
FEATURE_MIN_PLAN: dict[FeatureKey, PlanTier] = {
    FeatureKey.ML_PREDICTIONS: PlanTier.PRO,
    FeatureKey.ML_BOOST: PlanTier.PRO,
    FeatureKey.DUMP_SNIPER: PlanTier.PRO,
    FeatureKey.DISCORD_ALERTS: PlanTier.PRO,
    FeatureKey.EXTENDED_HISTORY_90D: PlanTier.PRO,
}


def has_feature(
    feature: FeatureKey,
    settings: Settings,
    user_plan: PlanTier = PlanTier.FREE,
) -> bool:
    """Return True if the caller may access `feature`. Always True while billing is unenforced."""
    if not settings.billing_enforced:
        return True
    required = FEATURE_MIN_PLAN.get(feature, PlanTier.FREE)
    if required == PlanTier.FREE:
        return True
    return user_plan == PlanTier.PRO


def build_entitlements_payload(
    settings: Settings,
    user_plan: PlanTier = PlanTier.FREE,
) -> dict[str, Any]:
    """Compact feature flags payload served on /api/market/status."""
    return {
        "billing_enforced": settings.billing_enforced,
        "show_upgrade_ui": settings.billing_enforced and user_plan != PlanTier.PRO,
        "plan": PlanTier.PRO.value if not settings.billing_enforced else user_plan.value,
        "features": {
            key.value: has_feature(key, settings, user_plan) for key in FeatureKey
        },
    }
