"""Deterministic OSRS Arbitrage Engine: GE Item Sets, Bob Barter Potion Decanting & High-Alch."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from app.engine.state import MarketState
from app.engine.tax import calculate_ge_tax

POTION_RE = re.compile(r"^(.+)\(([1-4])\)$")

# Curated catalog of high-liquidity OSRS Grand Exchange Item Sets (exact Wiki names).
# Pack: buy components -> combine at GE clerk (free, instant) -> sell set (2% tax on set).
# Unpack: buy set -> unpack at GE clerk (free, instant) -> sell components (2% tax per piece).
ITEM_SETS_CATALOG: list[tuple[str, list[str]]] = [
    ("Dharok's armour set", ["Dharok's helm", "Dharok's platebody", "Dharok's platelegs", "Dharok's greataxe"]),
    ("Ahrim's armour set", ["Ahrim's hood", "Ahrim's robetop", "Ahrim's robeskirt", "Ahrim's staff"]),
    ("Karil's armour set", ["Karil's coif", "Karil's leathertop", "Karil's leatherskirt", "Karil's crossbow"]),
    ("Guthan's armour set", ["Guthan's helm", "Guthan's platebody", "Guthan's chainskirt", "Guthan's warspear"]),
    ("Torag's armour set", ["Torag's helm", "Torag's platebody", "Torag's platelegs", "Torag's hammers"]),
    ("Verac's armour set", ["Verac's helm", "Verac's brassard", "Verac's plateskirt", "Verac's flail"]),
    ("Dwarf cannon set", ["Cannon base", "Cannon stand", "Cannon barrels", "Cannon furnace"]),
    ("Justiciar armour set", ["Justiciar faceguard", "Justiciar chestguard", "Justiciar legguards"]),
    ("Inquisitor's armour set", ["Inquisitor's great helm", "Inquisitor's hauberk", "Inquisitor's plateskirt"]),
    ("Ancestral robes set", ["Ancestral hat", "Ancestral robe top", "Ancestral robe bottom"]),
    ("Masori armour set (f)", ["Masori mask (f)", "Masori body (f)", "Masori chaps (f)"]),
    ("Masori armour set", ["Masori mask", "Masori body", "Masori chaps"]),
    ("Virtus armour set", ["Virtus mask", "Virtus robe top", "Virtus robe bottom"]),
    ("Obsidian armour set", ["Obsidian helmet", "Obsidian platebody", "Obsidian platelegs"]),
    ("Dragonstone armour set", ["Dragonstone full helm", "Dragonstone platebody", "Dragonstone platelegs", "Dragonstone gauntlets", "Dragonstone boots"]),
    ("Black dragonhide set", ["Black d'hide body", "Black d'hide chaps", "Black d'hide vambraces"]),
    ("Red dragonhide set", ["Red d'hide body", "Red d'hide chaps", "Red d'hide vambraces"]),
    ("Blue dragonhide set", ["Blue d'hide body", "Blue d'hide chaps", "Blue d'hide vambraces"]),
    ("Green dragonhide set", ["Green d'hide body", "Green d'hide chaps", "Green d'hide vambraces"]),
    ("Rune armour set (lg)", ["Rune full helm", "Rune platebody", "Rune platelegs", "Rune kiteshield"]),
    ("Rune armour set (sk)", ["Rune full helm", "Rune platebody", "Rune plateskirt", "Rune kiteshield"]),
    ("Adamant armour set (lg)", ["Adamant full helm", "Adamant platebody", "Adamant platelegs", "Adamant kiteshield"]),
    ("Mithril armour set (lg)", ["Mithril full helm", "Mithril platebody", "Mithril platelegs", "Mithril kiteshield"]),
    ("Gilded armour set (lg)", ["Gilded full helm", "Gilded platebody", "Gilded platelegs", "Gilded kiteshield"]),
    ("Mystic set (light)", ["Mystic hat (light)", "Mystic robe top (light)", "Mystic robe bottom (light)", "Mystic gloves (light)", "Mystic boots (light)"]),
    ("Mystic set (dark)", ["Mystic hat (dark)", "Mystic robe top (dark)", "Mystic robe bottom (dark)", "Mystic gloves (dark)", "Mystic boots (dark)"]),
    ("Mystic set (blue)", ["Mystic hat", "Mystic robe top", "Mystic robe bottom", "Mystic gloves", "Mystic boots"]),
    ("Sunfire fanatic armour set", ["Sunfire fanatic helm", "Sunfire fanatic cuirass", "Sunfire fanatic chausses"]),
    ("Blood moon armour set", ["Blood moon helm", "Blood moon chestplate", "Blood moon tassets", "Dual macuahuitl"]),
    ("Blue moon armour set", ["Blue moon helm", "Blue moon chestplate", "Blue moon tassets", "Blue moon spear"]),
    ("Eclipse moon armour set", ["Eclipse moon helm", "Eclipse moon chestplate", "Eclipse moon tassets", "Eclipse atlatl"]),
    ("Oathplate armour set", ["Oathplate helm", "Oathplate chest", "Oathplate legs"]),
]


def scan_potion_decanting(
    state: MarketState,
    members: bool = True,
    min_profit_per_4dose: int = 5,
    min_volume_24h: int = 200,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """Find profitable Bob Barter potion decanting opportunities (3-dose -> 4-dose & 1/2-dose -> 4-dose)."""
    families: dict[str, dict[int, int]] = defaultdict(dict)
    for item_id, meta in state.items.items():
        name = meta.get("name", "")
        match = POTION_RE.match(name)
        if not match:
            continue
        base_name = match.group(1).strip()
        doses = int(match.group(2))
        families[base_name][doses] = item_id

    opportunities: list[dict[str, Any]] = []

    for base_name, dose_map in families.items():
        id_4 = dose_map.get(4)
        if not id_4:
            continue
        m4 = state.metrics.get(id_4)
        if not m4 or not m4.high or (not members and m4.members):
            continue
        if m4.vol_24h < min_volume_24h:
            continue

        for src_dose in (3, 2, 1):
            id_src = dose_map.get(src_dose)
            if not id_src:
                continue
            ms = state.metrics.get(id_src)
            if not ms or not ms.low or ms.low <= 0 or ms.vol_24h < min_volume_24h:
                continue

            # Buy 4 units of src_dose -> decant via Bob Barter (free) -> receive `src_dose` units of 4-dose
            # Example: 4x (3)-dose = 12 doses = 3x (4)-dose.
            # Realistic slow-buy (low) -> slow-sell (high), plus instant (high -> low) check.
            buy_qty_src = 4
            out_qty_4 = src_dose

            # Slow/Limit order profit
            cost_slow = ms.low * buy_qty_src
            tax_4_slow = calculate_ge_tax(m4.high, item_name=m4.name, exempt=m4.is_tax_exempt)
            revenue_slow = (m4.high - tax_4_slow) * out_qty_4
            net_batch_slow = revenue_slow - cost_slow
            net_per_4dose = net_batch_slow / out_qty_4

            # Instant profit (buy at high, sell at low)
            instant_profit_per_4dose = 0.0
            if ms.high and m4.low:
                tax_4_inst = calculate_ge_tax(m4.low, item_name=m4.name, exempt=m4.is_tax_exempt)
                instant_profit_per_4dose = ((m4.low - tax_4_inst) * out_qty_4 - ms.high * buy_qty_src) / out_qty_4

            if net_per_4dose < min_profit_per_4dose:
                continue

            roi_pct = (net_batch_slow / cost_slow) * 100.0 if cost_slow > 0 else 0.0
            src_limit = ms.buy_limit if ms.buy_limit > 0 else 2000
            max_4dose_per_limit = int((src_limit * src_dose) // 4)
            profit_per_limit = int(net_per_4dose * max_4dose_per_limit)

            opportunities.append(
                {
                    "type": "POTION_DECANT",
                    "potion_family": base_name,
                    "from_item_id": id_src,
                    "from_item_name": ms.name,
                    "from_doses": src_dose,
                    "from_buy_price": ms.low,
                    "from_instabuy_price": ms.high,
                    "from_vol_24h": ms.vol_24h,
                    "to_item_id": id_4,
                    "to_item_name": m4.name,
                    "to_sell_price": m4.high,
                    "to_instasell_price": m4.low,
                    "to_vol_24h": m4.vol_24h,
                    "tax_per_4dose": tax_4_slow,
                    "net_profit_per_4dose": round(net_per_4dose, 1),
                    "instant_profit_per_4dose": round(instant_profit_per_4dose, 1),
                    "roi_pct": round(roi_pct, 2),
                    "buy_limit": src_limit,
                    "profit_per_limit": profit_per_limit,
                    "is_instant_profitable": instant_profit_per_4dose > 0,
                    "is_tax_exempt": m4.is_tax_exempt,
                }
            )

    opportunities.sort(
        key=lambda x: (x["is_instant_profitable"], x["profit_per_limit"]),
        reverse=True,
    )
    return opportunities[:limit]


def scan_item_sets(
    state: MarketState,
    members: bool = True,
    min_profit: int = 10_000,
) -> list[dict[str, Any]]:
    """Find profitable GE Item Set pack & unpack arbitrage after exact 2% tax."""
    results: list[dict[str, Any]] = []

    for set_name, component_names in ITEM_SETS_CATALOG:
        set_id = state.name_to_id.get(set_name.lower())
        if not set_id:
            continue
        sm = state.metrics.get(set_id)
        if not sm or not sm.high or not sm.low or (not members and sm.members):
            continue

        comp_metrics = []
        missing = False
        for cname in component_names:
            cid = state.name_to_id.get(cname.lower())
            cm = state.metrics.get(cid) if cid else None
            if not cm or not cm.high or not cm.low:
                missing = True
                break
            comp_metrics.append(cm)
        if missing:
            continue

        min_comp_vol = min(c.vol_24h for c in comp_metrics)
        min_vol = min(sm.vol_24h, min_comp_vol)
        if min_vol < 5:
            continue

        # 1. PACK: buy pieces at low -> combine into set -> sell set at high
        pack_cost = sum(c.low for c in comp_metrics if c.low)
        pack_tax = calculate_ge_tax(sm.high, item_name=sm.name, exempt=sm.is_tax_exempt)
        pack_profit = sm.high - pack_tax - pack_cost
        pack_instant_cost = sum(c.high for c in comp_metrics if c.high)
        pack_instant_tax = calculate_ge_tax(sm.low, item_name=sm.name, exempt=sm.is_tax_exempt)
        pack_instant_profit = sm.low - pack_instant_tax - pack_instant_cost

        # 2. UNPACK: buy set at low -> unpack into pieces -> sell each piece at high
        unpack_cost = sm.low
        unpack_revenue = sum(
            c.high - calculate_ge_tax(c.high, item_name=c.name, exempt=c.is_tax_exempt)
            for c in comp_metrics
            if c.high
        )
        unpack_profit = unpack_revenue - unpack_cost
        unpack_instant_revenue = sum(
            c.low - calculate_ge_tax(c.low, item_name=c.name, exempt=c.is_tax_exempt)
            for c in comp_metrics
            if c.low
        )
        unpack_instant_profit = unpack_instant_revenue - sm.high

        best_direction = "PACK" if pack_profit >= unpack_profit else "UNPACK"
        best_profit = max(pack_profit, unpack_profit)
        best_instant = pack_instant_profit if best_direction == "PACK" else unpack_instant_profit
        best_cost = pack_cost if best_direction == "PACK" else unpack_cost

        if best_profit < min_profit and best_instant < min_profit:
            continue

        roi_pct = (best_profit / best_cost) * 100.0 if best_cost > 0 else 0.0
        results.append(
            {
                "type": "ITEM_SET",
                "direction": best_direction,
                "set_id": sm.id,
                "set_name": sm.name,
                "set_high": sm.high,
                "set_low": sm.low,
                "set_vol_24h": sm.vol_24h,
                "min_component_vol_24h": min_comp_vol,
                "capital_required": best_cost,
                "net_profit": best_profit,
                "instant_profit": best_instant,
                "is_instant_profitable": best_instant > 0,
                "roi_pct": round(roi_pct, 2),
                "components": [
                    {
                        "id": c.id,
                        "name": c.name,
                        "high": c.high,
                        "low": c.low,
                        "vol_24h": c.vol_24h,
                    }
                    for c in comp_metrics
                ],
            }
        )

    results.sort(key=lambda x: (x["is_instant_profitable"], x["net_profit"]), reverse=True)
    return results


def scan_high_alch(
    state: MarketState,
    members: bool = True,
    min_profit: int = 100,
    min_vol_24h: int = 200,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Find profitable High Alchemy items using live Nature Rune price."""
    results: list[dict[str, Any]] = []
    for m in state.metrics.values():
        if not members and m.members:
            continue
        if not m.low or m.low <= 0 or m.highalch <= 0 or m.vol_24h < min_vol_24h:
            continue
        if m.alch_profit < min_profit:
            continue
        eff_limit = m.buy_limit if m.buy_limit > 0 else 100
        results.append(
            {
                "item_id": m.id,
                "item_name": m.name,
                "icon": m.icon,
                "members": m.members,
                "buy_price": m.low,
                "highalch": m.highalch,
                "nature_rune_price": state.nature_rune_price,
                "alch_profit": m.alch_profit,
                "roi_pct": round((m.alch_profit / (m.low + state.nature_rune_price)) * 100.0, 2),
                "buy_limit": eff_limit,
                "profit_per_limit": m.alch_profit * eff_limit,
                "vol_24h": m.vol_24h,
            }
        )
    results.sort(key=lambda x: x["profit_per_limit"], reverse=True)
    return results[:limit]


# ------------------------------------------------------------------
# Expanded Processing Arbitrage: Zahur Unf. Potions, Herb Cleaning, Planks & Enchanting
# ------------------------------------------------------------------

HERB_CATALOG: list[tuple[str, str, str, int]] = [
    # (grimy_name, clean_name, unf_potion_name, herblore_lvl)
    ("Grimy guam leaf", "Guam leaf", "Guam potion (unf)", 3),
    ("Grimy marrentill", "Marrentill", "Marrentill potion (unf)", 5),
    ("Grimy tarromin", "Tarromin", "Tarromin potion (unf)", 11),
    ("Grimy harralander", "Harralander", "Harralander potion (unf)", 20),
    ("Grimy ranarr weed", "Ranarr weed", "Ranarr potion (unf)", 30),
    ("Grimy toadflax", "Toadflax", "Toadflax potion (unf)", 34),
    ("Grimy irit leaf", "Irit leaf", "Irit potion (unf)", 45),
    ("Grimy avantoe", "Avantoe", "Avantoe potion (unf)", 50),
    ("Grimy kwuarm", "Kwuarm", "Kwuarm potion (unf)", 55),
    ("Grimy huasca", "Huasca", "Huasca potion (unf)", 58),
    ("Grimy snapdragon", "Snapdragon", "Snapdragon potion (unf)", 63),
    ("Grimy cadantine", "Cadantine", "Cadantine potion (unf)", 66),
    ("Grimy lantadyme", "Lantadyme", "Lantadyme potion (unf)", 69),
    ("Grimy dwarf weed", "Dwarf weed", "Dwarf weed potion (unf)", 72),
    ("Grimy torstol", "Torstol", "Torstol potion (unf)", 78),
]

PLANK_CATALOG: list[tuple[str, str, int, int]] = [
    # (log_name, plank_name, sawmill_fee, plank_make_fee)
    ("Logs", "Plank", 100, 70),
    ("Oak logs", "Oak plank", 250, 175),
    ("Teak logs", "Teak plank", 500, 350),
    ("Mahogany logs", "Mahogany plank", 1500, 1050),
]

ENCHANT_CATALOG: list[tuple[str, str, str, int]] = [
    # (base_name, enchanted_name, tier, magic_lvl)
    ("Sapphire ring", "Ring of recoil", "Sapphire", 7),
    ("Sapphire necklace", "Games necklace(8)", "Sapphire", 7),
    ("Sapphire amulet", "Amulet of magic", "Sapphire", 7),
    ("Sapphire bracelet", "Bracelet of clay", "Sapphire", 7),
    ("Emerald ring", "Ring of dueling(8)", "Emerald", 27),
    ("Emerald necklace", "Binding necklace", "Emerald", 27),
    ("Emerald amulet", "Amulet of defence", "Emerald", 27),
    ("Emerald bracelet", "Castle wars bracelet(3)", "Emerald", 27),
    ("Ruby ring", "Ring of forging", "Ruby", 49),
    ("Ruby amulet", "Amulet of strength", "Ruby", 49),
    ("Diamond ring", "Ring of life", "Diamond", 57),
    ("Diamond necklace", "Phoenix necklace", "Diamond", 57),
    ("Diamond amulet", "Amulet of power", "Diamond", 57),
    ("Diamond bracelet", "Abyssal bracelet(5)", "Diamond", 57),
    ("Dragonstone ring", "Ring of wealth", "Dragonstone", 68),
    ("Dragonstone necklace", "Skills necklace", "Dragonstone", 68),
    ("Dragonstone amulet", "Amulet of glory", "Dragonstone", 68),
    ("Dragonstone bracelet", "Combat bracelet", "Dragonstone", 68),
    ("Onyx ring", "Ring of stone", "Onyx", 87),
    ("Onyx necklace", "Berserker necklace", "Onyx", 87),
    ("Onyx amulet", "Amulet of fury", "Onyx", 87),
    ("Onyx bracelet", "Regen bracelet", "Onyx", 87),
    ("Zenyte ring", "Ring of suffering", "Zenyte", 93),
    ("Zenyte necklace", "Necklace of anguish", "Zenyte", 93),
    ("Zenyte amulet", "Amulet of torture", "Zenyte", 93),
    ("Zenyte bracelet", "Tormented bracelet", "Zenyte", 93),
]


def scan_herb_and_zahur(
    state: MarketState,
    members: bool = True,
) -> list[dict[str, Any]]:
    """Scan Zahur Unfinished Potions (200 gp instant NPC) and Grimy -> Clean herb spreads."""
    if not members:
        return []

    vial_id = state.name_to_id.get("vial of water")
    vial_m = state.metrics.get(vial_id) if vial_id else None
    vial_price = (vial_m.low or vial_m.high or 5) if vial_m else 5

    results: list[dict[str, Any]] = []
    for grimy_name, clean_name, unf_name, lvl in HERB_CATALOG:
        gid = state.name_to_id.get(grimy_name.lower())
        cid = state.name_to_id.get(clean_name.lower())
        uid = state.name_to_id.get(unf_name.lower())
        gm = state.metrics.get(gid) if gid else None
        cm = state.metrics.get(cid) if cid else None
        um = state.metrics.get(uid) if uid else None

        # 1. Zahur Unfinished Potion: Clean Herb + Vial of water + 200 gp -> Unf Potion (instant noted!)
        if cm and um and cm.low and um.high and cm.vol_24h >= 100 and um.vol_24h >= 100:
            fee = 200
            cost = cm.low + vial_price + fee
            tax = calculate_ge_tax(um.high, item_name=um.name, exempt=um.is_tax_exempt)
            net_unit = um.high - tax - cost
            inst_net = 0
            if cm.high and um.low:
                inst_tax = calculate_ge_tax(um.low, item_name=um.name, exempt=um.is_tax_exempt)
                inst_net = um.low - inst_tax - (cm.high + vial_price + fee)
            if net_unit > 0 or inst_net > 0:
                lim = cm.buy_limit if cm.buy_limit > 0 else 11_000
                results.append(
                    {
                        "method": "ZAHUR_UNF",
                        "method_label": "Zahur Unf. (200gp Instant)",
                        "level_req": lvl,
                        "input_id": cm.id,
                        "input_name": cm.name,
                        "input_price": cm.low,
                        "extra_cost": vial_price + fee,
                        "extra_note": f"Vial ({vial_price}) + Zahur (200)",
                        "output_id": um.id,
                        "output_name": um.name,
                        "output_price": um.high,
                        "tax": tax,
                        "net_profit": net_unit,
                        "instant_profit": inst_net,
                        "is_instant_profitable": inst_net > 0,
                        "roi_pct": round((net_unit / max(cost, 1)) * 100.0, 2),
                        "buy_limit": lim,
                        "profit_per_limit": net_unit * lim,
                        "vol_24h": min(cm.vol_24h, um.vol_24h),
                    }
                )

        # 2. Grimy -> Clean Herb (0 gp manual clean; also show Zahur 200 gp instant net!)
        if gm and cm and gm.low and cm.high and gm.vol_24h >= 100 and cm.vol_24h >= 100:
            tax = calculate_ge_tax(cm.high, item_name=cm.name, exempt=cm.is_tax_exempt)
            net_manual = cm.high - tax - gm.low
            net_zahur = net_manual - 200
            if net_manual > 20:
                lim = gm.buy_limit if gm.buy_limit > 0 else 11_000
                results.append(
                    {
                        "method": "HERB_CLEAN",
                        "method_label": "Clean Herb (0gp / Zahur 200gp)",
                        "level_req": lvl,
                        "input_id": gm.id,
                        "input_name": gm.name,
                        "input_price": gm.low,
                        "extra_cost": 0,
                        "extra_note": f"Zahur instant net: {net_zahur:+,} gp",
                        "output_id": cm.id,
                        "output_name": cm.name,
                        "output_price": cm.high,
                        "tax": tax,
                        "net_profit": net_manual,
                        "instant_profit": net_zahur,
                        "is_instant_profitable": net_zahur > 0,
                        "roi_pct": round((net_manual / max(gm.low, 1)) * 100.0, 2),
                        "buy_limit": lim,
                        "profit_per_limit": net_manual * lim,
                        "vol_24h": min(gm.vol_24h, cm.vol_24h),
                    }
                )

    results.sort(key=lambda x: (x["is_instant_profitable"], x["profit_per_limit"]), reverse=True)
    return results


def scan_processing_and_enchanting(
    state: MarketState,
    members: bool = True,
) -> list[dict[str, Any]]:
    """Scan Plank Make / Sawmill and Jewelry Enchanting spreads after exact 2% GE tax."""
    astral_id = state.name_to_id.get("astral rune")
    cosmic_id = state.name_to_id.get("cosmic rune")
    astral_m = state.metrics.get(astral_id) if astral_id else None
    cosmic_m = state.metrics.get(cosmic_id) if cosmic_id else None
    astral_price = (astral_m.low or astral_m.high or 80) if astral_m else 80
    cosmic_price = (cosmic_m.low or cosmic_m.high or 130) if cosmic_m else 130
    nat_price = state.nature_rune_price

    results: list[dict[str, Any]] = []

    # 1. Planks (Sawmill & Lunar Plank Make)
    if members:
        for log_name, plank_name, sawmill_fee, pm_fee in PLANK_CATALOG:
            lid = state.name_to_id.get(log_name.lower())
            pid = state.name_to_id.get(plank_name.lower())
            lm = state.metrics.get(lid) if lid else None
            pm = state.metrics.get(pid) if pid else None
            if not lm or not pm or not lm.low or not pm.high:
                continue

            tax = calculate_ge_tax(pm.high, item_name=pm.name, exempt=pm.is_tax_exempt)
            lim = lm.buy_limit if lm.buy_limit > 0 else 13_000

            # Lunar Plank Make: log + 2 Astral + 1 Nature + pm_fee (earth staff free)
            pm_runes = 2 * astral_price + nat_price
            pm_extra = pm_fee + pm_runes
            pm_cost = lm.low + pm_extra
            pm_net = pm.high - tax - pm_cost
            if pm_net > 0:
                results.append(
                    {
                        "category": "PLANK_MAKE",
                        "method_label": "Plank Make (86 Magic)",
                        "input_id": lm.id,
                        "input_name": lm.name,
                        "input_price": lm.low,
                        "extra_cost": pm_extra,
                        "extra_note": f"{pm_fee}gp + 2 Astral + 1 Nat",
                        "output_id": pm.id,
                        "output_name": pm.name,
                        "output_price": pm.high,
                        "tax": tax,
                        "net_profit": pm_net,
                        "roi_pct": round((pm_net / max(pm_cost, 1)) * 100.0, 2),
                        "buy_limit": lim,
                        "profit_per_limit": pm_net * lim,
                        "est_gp_per_hour": pm_net * 1_650,
                        "vol_24h": min(lm.vol_24h, pm.vol_24h),
                        "is_tax_exempt": pm.is_tax_exempt,
                    }
                )

            # Sawmill (Demon Butler / Woodcutting Guild)
            sm_cost = lm.low + sawmill_fee
            sm_net = pm.high - tax - sm_cost
            if sm_net > 0:
                results.append(
                    {
                        "category": "SAWMILL",
                        "method_label": "Sawmill / Butler",
                        "input_id": lm.id,
                        "input_name": lm.name,
                        "input_price": lm.low,
                        "extra_cost": sawmill_fee,
                        "extra_note": f"Sawmill fee ({sawmill_fee:,} gp)",
                        "output_id": pm.id,
                        "output_name": pm.name,
                        "output_price": pm.high,
                        "tax": tax,
                        "net_profit": sm_net,
                        "roi_pct": round((sm_net / max(sm_cost, 1)) * 100.0, 2),
                        "buy_limit": lim,
                        "profit_per_limit": sm_net * lim,
                        "est_gp_per_hour": sm_net * 4_200,
                        "vol_24h": min(lm.vol_24h, pm.vol_24h),
                        "is_tax_exempt": pm.is_tax_exempt,
                    }
                )

    # 2. Jewelry Enchanting (1 Cosmic rune + elemental staff)
    for base_name, ench_name, tier, magic_lvl in ENCHANT_CATALOG:
        bid = state.name_to_id.get(base_name.lower())
        eid = state.name_to_id.get(ench_name.lower())
        bm = state.metrics.get(bid) if bid else None
        em = state.metrics.get(eid) if eid else None
        if not bm or not em or not bm.low or not em.high:
            continue
        if not members and (bm.members or em.members):
            continue
        if min(bm.vol_24h, em.vol_24h) < 50:
            continue

        cost = bm.low + cosmic_price
        tax = calculate_ge_tax(em.high, item_name=em.name, exempt=em.is_tax_exempt)
        net = em.high - tax - cost
        if net <= 0:
            continue
        lim = bm.buy_limit if bm.buy_limit > 0 else 10_000
        results.append(
            {
                "category": "ENCHANT",
                "method_label": f"Enchant {tier} ({magic_lvl} Magic)",
                "input_id": bm.id,
                "input_name": bm.name,
                "input_price": bm.low,
                "extra_cost": cosmic_price,
                "extra_note": f"1 Cosmic ({cosmic_price} gp)",
                "output_id": em.id,
                "output_name": em.name,
                "output_price": em.high,
                "tax": tax,
                "net_profit": net,
                "roi_pct": round((net / max(cost, 1)) * 100.0, 2),
                "buy_limit": lim,
                "profit_per_limit": net * lim,
                "est_gp_per_hour": net * 1_800,
                "vol_24h": min(bm.vol_24h, em.vol_24h),
                "is_tax_exempt": em.is_tax_exempt,
            }
        )

    results.sort(key=lambda x: x["profit_per_limit"], reverse=True)
    return results
