import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import ItemDetail from './components/ItemDetail';
import { getItems, getItemsCount, searchItemsSuggestions } from './services/api';

// Format GP (gold pieces) with commas
const formatGP = (value) => {
  if (value === null || value === undefined) return null;
  return value.toLocaleString();
};

// Format K/M notation for large numbers (handles negative values)
const formatCompact = (value) => {
  if (value === null || value === undefined) return null;
  const absValue = Math.abs(value);
  if (absValue >= 1000000) {
    return (value / 1000000).toFixed(2) + 'M';
  }
  if (absValue >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  return value.toLocaleString();
};

// Format relative time
const formatRelativeTime = (timestamp) => {
  if (!timestamp) return null;
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch (e) {
    return 'Unknown';
  }
};

  // Check if data is old (> 24 hours)
const isDataOld = (timestamp) => {
  if (!timestamp) return true;
  const hours = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
  return hours > 24;
};

// Search Suggestions Component
function SearchSuggestions({ query, onSelect, onClose }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    debounceTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchItemsSuggestions(query);
        setSuggestions(results.items || []);
      } catch (error) {
        console.error('Error fetching suggestions:', error);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [query]);

  const handleSelect = (item) => {
    onSelect(item.id);
    navigate(`/item/${item.id}`);
    onClose();
  };

  if (query.length < 2 || (suggestions.length === 0 && !loading)) {
    return null;
  }

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        marginTop: '4px',
        background: 'rgba(30, 30, 50, 0.95)',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
        maxHeight: '300px',
        overflowY: 'auto',
        backdropFilter: 'blur(10px)'
      }}
    >
      {loading ? (
        <div style={{ padding: '12px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
          Loading...
        </div>
      ) : (
        suggestions.map((item) => (
          <div
            key={item.id}
            onClick={() => handleSelect(item)}
            style={{
              padding: '12px 16px',
              cursor: 'pointer',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              transition: 'background 0.2s ease',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ fontWeight: 500, color: '#fff' }}>{item.name}</span>
            <div style={{ display: 'flex', gap: '12px', fontSize: '13px' }}>
              <span style={{ color: '#4ade80' }}>
                B: {formatCompact(item.buy_price)} GP
              </span>
              <span style={{ color: '#f87171' }}>
                S: {formatCompact(item.sell_price)} GP
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// Dashboard component with table, sorting, and pagination
function Dashboard({ searchTerm, setSearchTerm }) {
  const navigate = useNavigate();
  const location = useLocation();
  
  // State
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [tableSearch, setTableSearch] = useState('');
  const [tableSearchLoading, setTableSearchLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  // Debounce timer ref
  const searchTimeoutRef = useRef(null);
  const tableSearchTimeoutRef = useRef(null);

  // Parse URL query params on mount
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlSearch = params.get('search') || '';
    const urlPage = parseInt(params.get('page'), 10) || 1;
    const urlSortBy = params.get('sort_by') || 'name';
    const urlSortOrder = params.get('sort_order') || 'asc';
    
    if (urlSearch !== searchTerm) {
      setSearchTerm(urlSearch);
      setTableSearch(urlSearch);
    }
    setPage(urlPage);
    setSortBy(urlSortBy);
    setSortOrder(urlSortOrder);
  }, []);

  // Update URL when state changes
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchTerm) params.set('search', searchTerm);
    if (page > 1) params.set('page', page);
    if (sortBy !== 'name') params.set('sort_by', sortBy);
    if (sortOrder !== 'asc') params.set('sort_order', sortOrder);
    
    const newUrl = `${location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState(null, '', newUrl);
  }, [searchTerm, page, sortBy, sortOrder, location.pathname]);

  // Fetch items
  const fetchItems = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setSearching(true);
    }
    try {
      const response = await getItems(searchTerm, null, sortBy, sortOrder, page, pageSize);
      setItems(response.items);
      setTotal(response.total);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching items:', error);
      if (!silent) {
        setItems([]);
        setTotal(0);
      }
    } finally {
      if (!silent) {
        setLoading(false);
        setSearching(false);
      }
    }
  }, [searchTerm, sortBy, sortOrder, page, pageSize]);

  // Debounced table search
  useEffect(() => {
    if (tableSearchTimeoutRef.current) {
      clearTimeout(tableSearchTimeoutRef.current);
    }
    
    if (tableSearch !== searchTerm) {
      setTableSearchLoading(true);
      tableSearchTimeoutRef.current = setTimeout(() => {
        setSearchTerm(tableSearch);
        setPage(1);
      }, 300);
    }

    return () => {
      if (tableSearchTimeoutRef.current) {
        clearTimeout(tableSearchTimeoutRef.current);
      }
    };
  }, [tableSearch]);

  // Fetch items when dependencies change
  useEffect(() => {
    fetchItems();
  }, [searchTerm, sortBy, sortOrder, page, fetchItems]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchItems(true); // Silent refresh
    }, 300000); // 5 minutes

    return () => clearInterval(interval);
  }, [fetchItems]);

  // Handle sort click
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
    setPage(1);
  };

  // Calculate pagination
  const totalPages = Math.ceil(total / pageSize);
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  // Render sort indicator
  const renderSortIndicator = (column) => {
    if (sortBy !== column) return null;
    return sortOrder === 'asc' ? ' ▲' : ' ▼';
  };

  // Handle row click
  const handleRowClick = (itemId) => {
    navigate(`/item/${itemId}`);
  };

  return (
    <div>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2 className="gradient-text" style={{
          fontSize: '28px',
          fontWeight: 700,
          margin: 0
        }}>
          Market Overview
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {lastUpdated && (
            <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '13px' }}>
              Last updated: {formatRelativeTime(lastUpdated)}
            </div>
          )}
          <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '14px' }}>
            {searching ? 'Searching...' : `${total.toLocaleString()} items found`}
          </div>
        </div>
      </div>

      {/* Table Search Filter */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ position: 'relative', maxWidth: '400px' }}>
          <input
            type="text"
            placeholder="Search items..."
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 40px 12px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              color: '#fff',
              fontSize: '14px',
              outline: 'none',
              transition: 'all 0.3s ease'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'rgba(139, 92, 246, 0.5)';
              e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
              e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
            }}
          />
          {tableSearchLoading && (
            <div style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'rgba(255, 255, 255, 0.5)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              <span className="loading-spinner" style={{
                width: '14px',
                height: '14px',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                borderTop: '2px solid #8B5CF6',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              Filtering...
            </div>
          )}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px'
        }}>
          <div className="loading-spinner" style={{
            width: '50px',
            height: '50px',
            border: '4px solid rgba(139, 92, 246, 0.3)',
            borderTop: '4px solid #8B5CF6',
            borderRadius: '50%'
          }} />
          <p style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Loading market data...</p>
        </div>
      ) : items.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '60px',
          color: 'rgba(255, 255, 255, 0.5)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>🔍</div>
          <p>No items found{searchTerm ? ` matching "${searchTerm}"` : ''}</p>
        </div>
      ) : (
        <>
          {/* Table Container */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            overflow: 'hidden',
            overflowX: 'auto'
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px'
            }}>
              <thead>
                <tr style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                  <th 
                    onClick={() => handleSort('name')}
                    style={{
                      padding: '16px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Name{renderSortIndicator('name')}
                  </th>
                  <th 
                    onClick={() => handleSort('buy_price')}
                    style={{
                      padding: '16px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Buy Price{renderSortIndicator('buy_price')}
                  </th>
                  <th 
                    onClick={() => handleSort('buy_timestamp')}
                    style={{
                      padding: '16px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Buy Updated{renderSortIndicator('buy_timestamp')}
                  </th>
                  <th 
                    onClick={() => handleSort('sell_price')}
                    style={{
                      padding: '16px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Sell Price{renderSortIndicator('sell_price')}
                  </th>
                  <th 
                    onClick={() => handleSort('sell_timestamp')}
                    style={{
                      padding: '16px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Sell Updated{renderSortIndicator('sell_timestamp')}
                  </th>
                  <th 
                    onClick={() => handleSort('margin')}
                    style={{
                      padding: '16px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Margin{renderSortIndicator('margin')}
                  </th>
                  <th 
                    onClick={() => handleSort('tax')}
                    style={{
                      padding: '16px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Tax{renderSortIndicator('tax')}
                  </th>
                  <th 
                    onClick={() => handleSort('profit')}
                    style={{
                      padding: '16px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Profit{renderSortIndicator('profit')}
                  </th>
                  <th 
                    onClick={() => handleSort('roi')}
                    style={{
                      padding: '16px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    ROI{renderSortIndicator('roi')}
                  </th>
                  <th 
                    onClick={() => handleSort('high_volume')}
                    style={{
                      padding: '16px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    High Vol{renderSortIndicator('high_volume')}
                  </th>
                  <th 
                    onClick={() => handleSort('low_volume')}
                    style={{
                      padding: '16px',
                      textAlign: 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontWeight: 600,
                      color: '#a78bfa',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Low Vol{renderSortIndicator('low_volume')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const hasNoData = !item.buy_price && !item.sell_price;
                  
                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleRowClick(item.id)}
                      style={{
                        background: index % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
                        cursor: 'pointer',
                        transition: 'background 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = index % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)';
                      }}
                    >
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        fontWeight: 500
                      }}>
                        {item.name}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        color: hasNoData ? '#fbbf24' : '#4ade80',
                        fontWeight: 600
                      }}>
                        {hasNoData ? 'No data' : formatCompact(item.buy_price)}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        color: isDataOld(item.buy_timestamp) ? '#fbbf24' : 'rgba(255, 255, 255, 0.6)',
                        fontSize: '13px'
                      }}>
                        {item.buy_timestamp ? formatRelativeTime(item.buy_timestamp) : '—'}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        color: hasNoData ? '#fbbf24' : '#f87171',
                        fontWeight: 600
                      }}>
                        {hasNoData ? '—' : formatCompact(item.sell_price)}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        color: isDataOld(item.sell_timestamp) ? '#fbbf24' : 'rgba(255, 255, 255, 0.6)',
                        fontSize: '13px'
                      }}>
                        {item.sell_timestamp ? formatRelativeTime(item.sell_timestamp) : '—'}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        color: item.margin > 0 ? '#4ade80' : item.margin < 0 ? '#f87171' : 'rgba(255, 255, 255, 0.5)',
                        fontWeight: 600
                      }}>
                        {item.margin !== null ? formatCompact(item.margin) : '—'}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        color: '#fbbf24',
                        fontWeight: 600,
                        fontSize: '13px'
                      }}>
                        {(() => {
                          if (item.tax_status === 'none') {
                            return '0 GP (under 50 GP)';
                          } else if (item.tax_status === 'capped') {
                            return '5M GP (capped)';
                          } else {
                            return `${formatCompact(item.tax)} (2%)`;
                          }
                        })()}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        color: item.profit > 0 ? '#4ade80' : item.profit < 0 ? '#f87171' : 'rgba(255, 255, 255, 0.5)',
                        fontWeight: 600
                      }}>
                        {item.profit !== null ? formatCompact(item.profit) : '—'}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        color: item.roi > 0 ? '#4ade80' : item.roi < 0 ? '#f87171' : 'rgba(255, 255, 255, 0.5)',
                        fontWeight: 600
                      }}>
                        {item.roi !== null ? `${item.roi.toFixed(2)}%` : '—'}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        color: 'rgba(255, 255, 255, 0.6)'
                      }}>
                        {item.high_volume ? formatCompact(item.high_volume) : '—'}
                      </td>
                      <td style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        color: 'rgba(255, 255, 255, 0.6)'
                      }}>
                        {item.low_volume ? formatCompact(item.low_volume) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '24px',
            padding: '16px',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '14px' }}>
              Showing {startItem.toLocaleString()}-{endItem.toLocaleString()} of {total.toLocaleString()} items
            </div>
            
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: page === 1 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.1)',
                  color: page === 1 ? 'rgba(255, 255, 255, 0.4)' : '#fff',
                  cursor: page === 1 ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.2s ease'
                }}
              >
                First
              </button>
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: page === 1 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.1)',
                  color: page === 1 ? 'rgba(255, 255, 255, 0.4)' : '#fff',
                  cursor: page === 1 ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.2s ease'
                }}
              >
                ← Prev
              </button>
              
              <span style={{
                padding: '8px 16px',
                color: 'rgba(255, 255, 255, 0.8)',
                fontSize: '14px',
                fontWeight: 500
              }}>
                Page {page} of {totalPages}
              </span>
              
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: page >= totalPages ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.1)',
                  color: page >= totalPages ? 'rgba(255, 255, 255, 0.4)' : '#fff',
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.2s ease'
                }}
              >
                Next →
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  background: page >= totalPages ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.1)',
                  color: page >= totalPages ? 'rgba(255, 255, 255, 0.4)' : '#fff',
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.2s ease'
                }}
              >
                Last
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Main App component
function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const navigate = useNavigate();

  const handleNavSearchChange = (e) => {
    setNavSearchQuery(e.target.value);
    setShowSuggestions(true);
  };

  const handleNavSearchSelect = (itemId) => {
    setNavSearchQuery('');
    setShowSuggestions(false);
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)'
    }}>
      {/* Header */}
      <header style={{
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '24px 20px',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ 
          maxWidth: '1400px', 
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <h1 className="gradient-text" style={{ 
              margin: 0, 
              fontSize: '24px',
              fontWeight: 700
            }}>
              OSRS Trading Dashboard
            </h1>
          </Link>
          <nav style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Search Bar with Suggestions */}
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search items by name..."
                value={navSearchQuery}
                onChange={handleNavSearchChange}
                style={{
                  width: '250px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#fff',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'all 0.3s ease',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                  e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                  setShowSuggestions(true);
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                }}
              />
              {showSuggestions && (
                <SearchSuggestions
                  query={navSearchQuery}
                  onSelect={handleNavSearchSelect}
                  onClose={() => setShowSuggestions(false)}
                />
              )}
            </div>
            <Link 
              to="/" 
              className="btn-secondary"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center'
              }}
            >
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '40px 20px'
      }}>
        <Routes>
          <Route path="/" element={<Dashboard searchTerm={searchTerm} setSearchTerm={setSearchTerm} />} />
          <Route path="/item/:id" element={<ItemDetail />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;