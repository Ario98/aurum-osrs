import React, { useState, useEffect } from 'react';
import { getItems } from '../services/api';

function ItemSearch({ onSelectItem, selectedItemId }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Fetch items when search term changes
  useEffect(() => {
    const fetchItems = async () => {
      if (searchTerm.length < 2) {
        setItems([]);
        return;
      }

      setLoading(true);
      try {
        const results = await getItems(searchTerm, null, 20);
        setItems(results);
      } catch (error) {
        console.error('Error fetching items:', error);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchItems, 300);
    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  const handleSelect = (item) => {
    onSelectItem(item);
    setSearchTerm(item.name);
    setShowDropdown(false);
  };

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search for an item..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          style={{
            flex: 1,
            padding: '12px 16px',
            borderRadius: '6px',
            border: '1px solid #444',
            backgroundColor: '#2a2a2a',
            color: '#fff',
            fontSize: '16px',
            outline: 'none',
          }}
        />
        {loading && (
          <div className="loading-spinner" style={{
            width: '20px',
            height: '20px',
            border: '3px solid #444',
            borderTop: '3px solid #4CAF50',
            borderRadius: '50%'
          }} />
        )}
      </div>

      {showDropdown && items.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '5px',
            backgroundColor: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: '6px',
            maxHeight: '300px',
            overflowY: 'auto',
            zIndex: 1000,
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
          }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => handleSelect(item)}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid #444',
                backgroundColor: selectedItemId === item.id ? '#3a3a3a' : 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#3a3a3a'}
              onMouseLeave={(e) => e.target.style.backgroundColor = selectedItemId === item.id ? '#3a3a3a' : 'transparent'}
            >
              <span>{item.name}</span>
              {item.members && (
                <span style={{ 
                  fontSize: '12px', 
                  color: '#888',
                  backgroundColor: '#1a1a1a',
                  padding: '2px 6px',
                  borderRadius: '4px'
                }}>
                  Members
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Click outside to close dropdown */}
      {showDropdown && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
          onClick={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
}

export default ItemSearch;