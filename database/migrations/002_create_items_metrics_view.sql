-- Create view for items with calculated trading metrics
-- This view automatically calculates tax, profit, ROI, and other trading metrics

CREATE OR REPLACE VIEW items_with_metrics AS
SELECT 
    i.id,
    i.name,
    i.examine,
    i.members,
    i.lowalch,
    i.highalch,
    i."limit",
    i.value,
    i.icon,
    i.created_at,
    i.updated_at,
    
    -- Latest buy price (high price) with timestamp
    COALESCE(buy_data.avg_high_price, 0) as buy_price,
    buy_data.timestamp as buy_timestamp,
    COALESCE(buy_data.high_price_volume, 0) as high_volume,
    
    -- Latest sell price (low price) with timestamp  
    COALESCE(sell_data.avg_low_price, 0) as sell_price,
    sell_data.timestamp as sell_timestamp,
    COALESCE(sell_data.low_price_volume, 0) as low_volume,
    
    -- Calculated metrics
    COALESCE(buy_data.avg_high_price, 0) - COALESCE(sell_data.avg_low_price, 0) as margin,
    
    -- Tax calculation: 2% with 5M cap, but no tax if sell price < 50 GP
    CASE 
        WHEN COALESCE(sell_data.avg_low_price, 0) < 50 THEN 0
        ELSE LEAST(
            (COALESCE(sell_data.avg_low_price, 0) * 0.02)::bigint, 
            5000000
        )
    END as tax,
    
    -- Profit: sell - buy - tax (tax is 0 if sell price < 50)
    (
        COALESCE(sell_data.avg_low_price, 0) - 
        COALESCE(buy_data.avg_high_price, 0) - 
        CASE 
            WHEN COALESCE(sell_data.avg_low_price, 0) < 50 THEN 0
            ELSE LEAST(
                (COALESCE(sell_data.avg_low_price, 0) * 0.02)::bigint, 
                5000000
            )
        END
    )::bigint as profit,
    
    -- ROI: (profit / buy_price) * 100
    CASE 
        WHEN COALESCE(buy_data.avg_high_price, 0) > 0 THEN 
            (
                (
                    COALESCE(sell_data.avg_low_price, 0) - 
                    COALESCE(buy_data.avg_high_price, 0) - 
                    CASE 
                        WHEN COALESCE(sell_data.avg_low_price, 0) < 50 THEN 0
                        ELSE LEAST(
                            (COALESCE(sell_data.avg_low_price, 0) * 0.02)::bigint, 
                            5000000
                        )
                    END
                )::float / 
                COALESCE(buy_data.avg_high_price, 0)::float * 100
            )
        ELSE 0 
    END as roi,
    
    -- Flag for tax status: 'none' (<50 GP), 'normal' (2%), or 'capped' (5M)
    CASE 
        WHEN COALESCE(sell_data.avg_low_price, 0) < 50 THEN 'none'
        WHEN COALESCE(sell_data.avg_low_price, 0) * 0.02 >= 5000000 THEN 'capped'
        ELSE 'normal'
    END as tax_status

FROM items i
LEFT JOIN LATERAL (
    -- Get latest price record with valid high price
    SELECT avg_high_price, high_price_volume, timestamp
    FROM price_history
    WHERE item_id = i.id AND avg_high_price IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 1
) buy_data ON true
LEFT JOIN LATERAL (
    -- Get latest price record with valid low price
    SELECT avg_low_price, low_price_volume, timestamp
    FROM price_history
    WHERE item_id = i.id AND avg_low_price IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT 1
) sell_data ON true;

-- Add comment for documentation
COMMENT ON VIEW items_with_metrics IS 
'Pre-calculated trading metrics for all items including buy/sell prices, margins, tax (2% capped at 5M, no tax under 50 GP), profit, and ROI. Updates automatically as price_history is updated.';

-- Grant permissions
GRANT SELECT ON items_with_metrics TO osrs_user;