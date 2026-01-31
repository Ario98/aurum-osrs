-- Migration: Add index for price_history query optimization
-- This index significantly improves query performance for item price history lookups

-- Index for efficient price history queries by item and timestamp
CREATE INDEX IF NOT EXISTS idx_price_history_item_timestamp 
ON price_history (item_id, timestamp DESC);

-- Index for efficient price lookups by timestamp alone (for collector operations)
CREATE INDEX IF NOT EXISTS idx_price_history_timestamp 
ON price_history (timestamp DESC);

-- Analyze tables to update query planner statistics
ANALYZE price_history;
ANALYZE items;
