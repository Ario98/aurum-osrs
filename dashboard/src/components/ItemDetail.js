import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import PriceChart from './PriceChart';
import { getItem, getPriceHistory, getWeeklyPriceHistory } from '../services/api';
import { format, subDays, formatDistanceToNow } from 'date-fns';

function ItemDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [currentPrices, setCurrentPrices] = useState({ high: null, low: null });
  const [loading, setLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('live');
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchItemData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const itemData = await getItem(id);
      
      if (!itemData) {
        setError('Item not found');
        setItem(null);
        return;
      }
      
      setItem(itemData);
      
      const latestHistory = await getPriceHistory(id, null, new Date(), 100);
      
      let latestHigh = null;
      let latestLow = null;
      
      for (let i = 0; i < latestHistory.length; i++) {
        const entry = latestHistory[i];
        if (!latestHigh && entry.avg_high_price != null) {
          latestHigh = entry;
        }
        if (!latestLow && entry.avg_low_price != null) {
          latestLow = entry;
        }
        if (latestHigh && latestLow) break;
      }
      
      setCurrentPrices({ high: latestHigh, low: latestLow });
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching item:', err);
      setError('Failed to load item data. Please try again.');
    } finally {
      setLoading(false);
      setIsLoading(false);
    }
  }, [id]);

  const fetchPriceHistory = useCallback(async () => {
    if (!item) return;
    
    try {
      setLoadingHistory(true);
      let history;
      
      // Use weekly aggregation for year and all-time views (faster, shows full history)
      if (timeRange === 'year' || timeRange === 'all') {
        const weeks = timeRange === 'year' ? 52 : 208; // 52 weeks for year, 4 years for all
        history = await getWeeklyPriceHistory(id, weeks);
      } else {
        // Use regular price history for live, week, month views with optimized limits
        const endDate = new Date();
        let startDate = null;
        let limit = 1000; // Default limit
        
        const timeRangeConfig = {
          'live': { days: 1, limit: 300 },      // 1 day = ~300 5-min intervals
          'week': { days: 7, limit: 2000 },     // 1 week = ~2000 5-min intervals  
          'month': { days: 30, limit: 9000 }    // 1 month = ~9000 5-min intervals
        };
        
        const config = timeRangeConfig[timeRange];
        startDate = subDays(endDate, config.days);
        limit = config.limit;
        
        history = await getPriceHistory(id, startDate, endDate, limit);
      }
      
      setPriceHistory(history);
    } catch (err) {
      console.error('Error fetching price history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [id, item, timeRange]);

  const refreshData = useCallback(() => {
    fetchItemData();
  }, [fetchItemData]);

  useEffect(() => {
    // Reset state when ID changes to prevent showing stale data
    setLoading(true);
    setIsLoading(true);
    setError(null);
    fetchItemData();
  }, [id, fetchItemData]);

  useEffect(() => {
    if (item) {
      fetchPriceHistory();
    }
  }, [item, timeRange, fetchPriceHistory]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshData();
    }, 300000);
    return () => clearInterval(interval);
  }, [id, refreshData]);

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

  if (error && !item) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        padding: '40px'
      }}>
        <div className="card">
          <h2 style={{ color: '#f87171', marginBottom: '16px' }}>Error</h2>
          <p style={{ color: 'rgba(255, 255, 255, 0.7)', marginBottom: '24px' }}>{error}</p>
          <Link to="/" className="btn-primary" style={{ display: 'inline-block' }}>
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

        {/* Loading Indicator - shows during any loading state */}
        {isLoading && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '16px',
            padding: '12px 16px',
            background: 'rgba(139, 92, 246, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(139, 92, 246, 0.2)'
          }}>
            <div style={{
              width: '16px',
              height: '16px',
              border: '2px solid rgba(139, 92, 246, 0.3)',
              borderTop: '2px solid #8B5CF6',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span style={{ color: '#a78bfa', fontSize: '14px' }}>
              {item ? 'Loading new item...' : 'Loading item...'}
            </span>
          </div>
        )}

        {/* Error Message */}
        {error && item && (
          <div style={{
            marginBottom: '16px',
            padding: '12px 16px',
            background: 'rgba(248, 113, 113, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(248, 113, 113, 0.2)'
          }}>
            <span style={{ color: '#f87171', fontSize: '14px' }}>{error}</span>
          </div>
        )}

        {/* Show placeholder while loading for the first time */}
        {!item && isLoading && (
          <div className="card">
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              padding: '60px 20px',
              flexDirection: 'column',
              gap: '16px'
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                border: '3px solid rgba(139, 92, 246, 0.3)',
                borderTop: '3px solid #8B5CF6',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '16px' }}>
                Loading item...
              </span>
            </div>
          </div>
        )}

        {/* Show error if no item and not loading */}
        {!item && !isLoading && (
          <div className="card">
            <h2>{error || 'Item not found'}</h2>
            <Link to="/" className="btn-primary" style={{ marginTop: '20px', display: 'inline-block' }}>
              ← Back to Dashboard
            </Link>
          </div>
        )}

        {/* Show item details if we have an item */}
        {item && (
          <>
            <div className="card" style={{ marginBottom: '24px' }}>
              <h1 className="gradient-text" style={{ 
                fontSize: '32px', 
                marginBottom: '16px',
                fontWeight: 800
              }}>
                {item?.name || 'Unknown Item'}
              </h1>

              {item?.examine && (
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

              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                {item?.members && (
                  <span className="badge badge-members">
                    <span style={{ fontSize: '14px' }}>✓</span>
                    Members
                  </span>
                )}
                {item?.limit && (
                  <span className="badge badge-limit">
                    <span style={{ fontSize: '14px' }}>📦</span>
                    Limit: {item.limit.toLocaleString()}
                  </span>
                )}
              </div>

              <div className="divider" />

              <div className="section-title">Current Prices</div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                    Buy Price (High)
                  </div>
                  <div className="price-high" style={{ fontSize: '20px', marginBottom: '4px' }}>
                    {formatPrice(currentPrices.high?.avg_high_price)}
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>
                    Last updated: {formatTimestampWithRelative(currentPrices.high?.timestamp)}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                    Sell Price (Low)
                  </div>
                  <div className="price-low" style={{ fontSize: '20px', marginBottom: '4px' }}>
                    {formatPrice(currentPrices.low?.avg_low_price)}
                  </div>
                  <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>
                    Last updated: {formatTimestampWithRelative(currentPrices.low?.timestamp)}
                  </div>
                </div>

                {(() => {
                  const sellPrice = currentPrices.low?.avg_low_price;
                  if (!sellPrice || sellPrice < 50) return null;
                  
                  const tax = Math.min(Math.floor(sellPrice * 0.02), 5000000);
                  const isCapped = tax >= 5000000;
                  
                  return (
                    <div>
                      <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.5)', marginBottom: '4px' }}>
                        Tax
                      </div>
                      <div style={{ fontSize: '20px', marginBottom: '4px', color: '#fbbf24', fontWeight: 600 }}>
                        {formatPrice(tax)}
                        {isCapped && (
                          <span style={{ fontSize: '13px', marginLeft: '8px', opacity: 0.8, color: '#fbbf24' }}>
                            (capped at 5M)
                          </span>
                        )}
                        {!isCapped && sellPrice > 0 && (
                          <span style={{ fontSize: '13px', marginLeft: '8px', opacity: 0.8, color: '#fbbf24' }}>
                            (2%)
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.4)' }}>
                        2% tax on Grand Exchange sales
                      </div>
                    </div>
                  );
                })()}
              </div>

              {(() => {
                const highPrice = currentPrices.high?.avg_high_price;
                const lowPrice = currentPrices.low?.avg_low_price;
                if (highPrice && lowPrice) {
                  const margin = highPrice - lowPrice;
                  const marginPercent = (margin / lowPrice * 100).toFixed(1);
                  const isPositive = margin > 0;
                  
                  return (
                    <div style={{ 
                      marginTop: '16px',
                      padding: '12px 16px',
                      background: isPositive ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                      borderRadius: '8px',
                      border: `1px solid ${isPositive ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.7)' }}>Profit Margin</span>
                        <span style={{ fontSize: '18px', color: isPositive ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                          {margin.toLocaleString()} gp
                          <span style={{ fontSize: '13px', marginLeft: '8px', opacity: 0.8 }}>
                            ({marginPercent}%)
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="divider" />
              <div className="section-title">Item Details</div>
              
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
                gap: '12px',
                fontSize: '14px'
              }}>
                {item?.value && (
                  <div>
                    <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Value: </span>
                    <span style={{ color: '#fff' }}>{item.value.toLocaleString()} gp</span>
                  </div>
                )}
                {item?.highalch && (
                  <div>
                    <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>High Alch: </span>
                    <span style={{ color: '#fff' }}>{item.highalch.toLocaleString()} gp</span>
                  </div>
                )}
                {item?.lowalch && (
                  <div>
                    <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Low Alch: </span>
                    <span style={{ color: '#fff' }}>{item.lowalch.toLocaleString()} gp</span>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div className="section-title" style={{ margin: 0 }}>Price History</div>
                {lastUpdated && (
                  <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '13px' }}>
                    Last updated: {formatDistanceToNow(lastUpdated, { addSuffix: true })}
                  </div>
                )}
              </div>
              
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

              <PriceChart data={priceHistory} timeRange={timeRange} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ItemDetail;