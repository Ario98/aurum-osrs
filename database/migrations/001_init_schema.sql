-- OSRS Trading Dashboard Database Schema
-- This script initializes the database structure

-- Enable UUID extension for potential future use
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Items table: Static metadata for each OSRS item
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    examine TEXT,
    members BOOLEAN NOT NULL DEFAULT FALSE,
    lowalch INTEGER,
    highalch INTEGER,
    "limit" INTEGER,
    value INTEGER,
    icon VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Price history table: 5-minute price data
CREATE TABLE IF NOT EXISTS price_history (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    avg_high_price INTEGER,
    avg_low_price INTEGER,
    high_price_volume BIGINT,
    low_price_volume BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_item_timestamp UNIQUE (item_id, timestamp)
);

-- Collection state table: Tracks backfill progress
CREATE TABLE IF NOT EXISTS collection_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_timestamp TIMESTAMP WITH TIME ZONE,
    is_initial_backfill_complete BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Initialize collection state
INSERT INTO collection_state (id, last_timestamp, is_initial_backfill_complete)
VALUES (1, NULL, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS price_history_item_id_idx ON price_history(item_id);
CREATE INDEX IF NOT EXISTS price_history_timestamp_idx ON price_history(timestamp);
CREATE INDEX IF NOT EXISTS price_history_item_timestamp_idx ON price_history(item_id, timestamp);
CREATE INDEX IF NOT EXISTS items_name_idx ON items(name);

-- Create a function to automatically update the updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_items_updated_at ON items;
CREATE TRIGGER update_items_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_collection_state_updated_at ON collection_state;
CREATE TRIGGER update_collection_state_updated_at
    BEFORE UPDATE ON collection_state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create a view for latest prices (convenience view)
CREATE OR REPLACE VIEW latest_prices AS
SELECT DISTINCT ON (item_id)
    ph.item_id,
    i.name AS item_name,
    ph.timestamp,
    ph.avg_high_price,
    ph.avg_low_price,
    ph.high_price_volume,
    ph.low_price_volume
FROM price_history ph
JOIN items i ON ph.item_id = i.id
ORDER BY ph.item_id, ph.timestamp DESC;

-- Create a function to clean up old data (older than 4 years)
CREATE OR REPLACE FUNCTION cleanup_old_price_data()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
    cutoff_date TIMESTAMP WITH TIME ZONE;
BEGIN
    cutoff_date := CURRENT_TIMESTAMP - INTERVAL '4 years';
    
    DELETE FROM price_history
    WHERE timestamp < cutoff_date;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON TABLE items IS 'Static item metadata from OSRS Wiki mapping endpoint';
COMMENT ON TABLE price_history IS '5-minute price averages from OSRS Wiki prices endpoint';
COMMENT ON TABLE collection_state IS 'Tracks data collection progress and state';
COMMENT ON COLUMN price_history.avg_high_price IS 'Average high price for the 5-minute window';
COMMENT ON COLUMN price_history.avg_low_price IS 'Average low price for the 5-minute window';
COMMENT ON COLUMN price_history.high_price_volume IS 'Number of items traded at high price';
COMMENT ON COLUMN price_history.low_price_volume IS 'Number of items traded at low price';