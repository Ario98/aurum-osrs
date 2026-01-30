import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import PriceChart from './PriceChart';
import { getItem, getPriceHistory, getLatestPrices } from '../services/api';
import { format, subDays, formatDistanceToNow } from 'date-fns';

function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [latestPrice, setLatestPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('live'); // Default live (24h)

  useEffect(() => {
    fetchItemData();
  }, [id]);

  useEffect(() => {
    if (item) {
      fetchPriceHistory();
    }
  }, [item, timeRange]);

  const fetchItemData = async () => {
    try {
      const itemData = await getItem(id);
      setItem(itemData);
      
      // Also fetch latest prices to get current price for this item
      const latestPrices = await getLatestPrices(1000);
      const itemLatest = latestPrices.find(p => p.item_id === parseInt(id));
      setLatestPrice(itemLatest);
    } catch (error) {
      console.error('Error fetching item:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPriceHistory = async () => {
    try {
      const endDate = new Date();
      let startDate = null;
      
      // Map timeRange to days
      const timeRangeMap = {
        'live': 1,
        'week': 7,
        'month': 30,
        'year': 365
      };
      
      if (timeRange !== 'all') {
        const days = timeRangeMap[timeRange];
        startDate = subDays(endDate, days);
      }
      
      const history = await getPriceHistory(item.id, startDate, endDate, 10000);
      setPriceHistory(history);
    } catch (error) {
      console.error('Error fetching price history:', error);
    }
  };

  const formatPrice = (price) => {
    if (!price) return 'N/A';
    return price.toLocaleString() + ' GP';
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return format(date, 'MMM d, HH:mm');
  };

  const formatTimestampWithRelative = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    const formatted = format(date, 'MMM d, HH:mm');
    const relative = formatDistanceToNow(date, { addSuffix: true });
    return `${formatted} (${relative})`;
  };

  // Helper functions to find latest valid prices from history
  const getLatestHighPrice = () => {
    if (!priceHistory || priceHistory.length === 0) return null;
    // Iterate backwards to find most recent entry with valid high price
    for (let i = priceHistory.length - 1; i >= 0; i--) {
      if (priceHistory[i].avg_high_price != null) {
        return priceHistory[i];
      }
    }
    return null;
  };

  const getLatestLowPrice = () => {
    if (!priceHistory || priceHistory.length === 0) return null;
    // Iterate backwards to find most recent entry with valid low price
    for (let i = priceHistory.length - 1; i >= 0; i--) {
      if (priceHistory[i].avg_low_price != null) {
        return priceHistory[i];
      }
    }
    return null;
  };

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div className="loading-spinner" style={{
          width: '50px',
          height: '50px',
          border: '4px solid rgba(139, 92, 246, 0.3)',
          borderTop: '4px solid #8B5CF6',
          borderRadius: '50%'
        }} />
      </div>
    );
  }

  if (!item) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        padding: '40px'
      }}>
        <div className="card">
          <h2>Item not found</h2>
          <Link to="/" className="btn-primary" style={{ marginTop: '20px', display: 'inline-block' }}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
      padding: '20px'
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Back Button */}
        <Link 
          to="/" 
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: '#a78bfa',
            fontSize: '14px',
            fontWeight: 500,
            marginBottom: '24px',
            transition: 'color 0.3s'
          }}
          onMouseEnter={(e) => e.target.style.color = '#C4B5FD'}
          onMouseLeave={(e) => e.target.style.color = '#a78bfa'}
        >
          <span style={{ fontSize: '18px' }}>←</span>
          Back to Dashboard
        </Link>

        {/* Tile 1: Item Info */}
        <div className="card" style={{ marginBottom: '24px' }}>
          {/* Item Name - Purple Gradient */}
          <h1 className="gradient-text" style={{ 
            fontSize: '32px', 
            marginBottom: '16px',
            fontWeight: 800
          }}>
            {item.name}
          </h1>

          {/* Description */}
          {item.examine && (
            <p style={{ 
              color: 'rgba(255, 255, 255, 0.7)', 
              fontSize: '15px',
              lineHeight: '1.6',
              marginBottom: '20px',
              fontStyle: 'italic'
            }}>
              {item.examine}
            </p>
          )}

          {/* Badges */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {item.members && (
              <span className="badge badge-members">
                <span style={{ fontSize: '14px' }}>✓</span>
                Members
              </span>
            )}
            {item.limit && (
              <span className="badge badge-limit">
                <span style={{ fontSize: '14px' }}>📦</span>
                Limit: {item.limit.toLocaleString()}
              </span>
            )}
          </div>

          <div className="divider" />

          {/* Current Prices Section */}
          <div className="section-title">Current Prices</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                High Price
              </div>
              <div className="price-high" style={{ fontSize: '20px', marginBottom: '4px' }}>
                {formatPrice(getLatestHighPrice()?.avg_high_price)}
              </div>
              <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>
                Last updated: {formatTimestampWithRelative(getLatestHighPrice()?.timestamp)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                Low Price
              </div>
              <div className="price-low" style={{ fontSize: '20px', marginBottom: '4px' }}>
                {formatPrice(getLatestLowPrice()?.avg_low_price)}
              </div>
              <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>
                Last updated: {formatTimestampWithRelative(getLatestLowPrice()?.timestamp)}
              </div>
            </div>

            {item.tax !== null && item.tax > 0 && (
              <div>
                <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                  Tax
                </div>
                <div style={{ fontSize: '20px', marginBottom: '4px', color: '#fbbf24', fontWeight: 600 }}>
                  {formatPrice(item.tax)}
                  {item.tax_capped && (
                    <span style={{ fontSize: '13px', marginLeft: '8px', opacity: 0.8, color: '#fbbf24' }}>
                      (capped at 5M)
                    </span>
                  )}
                  {!item.tax_capped && item.sell_price > 0 && (
                    <span style={{ fontSize: '13px', marginLeft: '8px', opacity: 0.8, color: '#fbbf24' }}>
                      (2%)
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>
                  2% tax on Grand Exchange sales
                </div>
              </div>
            )}
          </div>

          {/* Margin */}
          {(() => {
            const highPrice = getLatestHighPrice();
            const lowPrice = getLatestLowPrice();
            if (highPrice?.avg_high_price && lowPrice?.avg_low_price) {
              return (
                <div style={{ 
                  marginTop: '16px',
                  padding: '12px 16px',
                  background: 'rgba(74, 222, 128, 0.1)',
                  borderRadius: '8px',
                  border: '1px solid rgba(74, 222, 128, 0.2)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.7)' }}>Profit Margin</span>
                    <span className="margin-positive" style={{ fontSize: '18px' }}>
                      {(highPrice.avg_high_price - lowPrice.avg_low_price).toLocaleString()} gp
                      <span style={{ fontSize: '13px', marginLeft: '8px', opacity: 0.8 }}>
                        ({((highPrice.avg_high_price - lowPrice.avg_low_price) / lowPrice.avg_low_price * 100).toFixed(1)}%)
                      </span>
                    </span>
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Additional Info */}
          <div className="divider" />
          <div className="section-title">Item Details</div>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
            gap: '12px',
            fontSize: '14px'
          }}>
            {item.value && (
              <div>
                <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Value: </span>
                <span style={{ color: '#fff' }}>{item.value.toLocaleString()} gp</span>
              </div>
            )}
            {item.highalch && (
              <div>
                <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>High Alch: </span>
                <span style={{ color: '#fff' }}>{item.highalch.toLocaleString()} gp</span>
              </div>
            )}
            {item.lowalch && (
              <div>
                <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Low Alch: </span>
                <span style={{ color: '#fff' }}>{item.lowalch.toLocaleString()} gp</span>
              </div>
            )}
          </div>
        </div>

        {/* Tile 2: Price Chart */}
        <div className="card">
          <div className="section-title">Price History</div>
          
          {/* Time Range Selector */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
            {[
              { value: 'live', label: 'Live' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
              { value: 'all', label: 'All Time' }
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeRange(option.value)}
                className={`btn-secondary ${timeRange === option.value ? 'btn-active' : ''}`}
                style={{ minWidth: '70px' }}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Chart */}
          <PriceChart data={priceHistory} timeRange={timeRange} />
        </div>
      </div>
    </div>
  );
}

export default ItemDetail;