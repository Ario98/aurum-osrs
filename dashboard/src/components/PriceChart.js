import React from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  ComposedChart
} from 'recharts';
import { format, startOfDay, startOfMonth } from 'date-fns';

// Smart number formatter
const formatPrice = (value) => {
  if (!value || value === 0) return '0';
  if (value < 1000) return value.toString();
  if (value < 1000000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1000000).toFixed(1)}M`;
};

// Group data by time period based on timeRange
const groupDataByTimeRange = (data, timeRange) => {
  if (!data || data.length === 0) return [];
  
  // For live view, return data as-is without grouping
  if (timeRange === 'live') {
    return data.map(item => ({
      timestamp: item.timestamp,
      avgHighPrice: item.avg_high_price || null,
      avgLowPrice: item.avg_low_price || null,
    })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
  
  const grouped = {};
  
  data.forEach(item => {
    // Skip items with no valid prices - don't average them
    if (!item.avg_high_price && !item.avg_low_price) return;
    
    const date = new Date(item.timestamp);
    let key;
    
    switch (timeRange) {
      case 'week':
      case 'month':
        // Group by day
        key = startOfDay(date).toISOString();
        break;
      case 'year':
      case 'all':
        // Group by month
        key = startOfMonth(date).toISOString();
        break;
      default:
        key = date.toISOString();
    }
    
    if (!grouped[key]) {
      // Initialize with first values - track min/max separately
      grouped[key] = {
        timestamp: key,
        highPrice: item.avg_high_price || null,
        lowPrice: item.avg_low_price || null,
        totalHighVolume: item.high_price_volume || 0,
        totalLowVolume: item.low_price_volume || 0,
        count: 1
      };
    } else {
      // Track the actual high and low for this period
      if (item.avg_high_price) {
        grouped[key].highPrice = grouped[key].highPrice 
          ? Math.max(grouped[key].highPrice, item.avg_high_price)
          : item.avg_high_price;
      }
      if (item.avg_low_price) {
        grouped[key].lowPrice = grouped[key].lowPrice
          ? Math.min(grouped[key].lowPrice, item.avg_low_price)
          : item.avg_low_price;
      }
      grouped[key].totalHighVolume += item.high_price_volume || 0;
      grouped[key].totalLowVolume += item.low_price_volume || 0;
      grouped[key].count += 1;
    }
  });
  
  // Convert to array and ensure high >= low
  return Object.values(grouped)
    .map(item => ({
      timestamp: item.timestamp,
      avgHighPrice: item.highPrice,
      avgLowPrice: item.lowPrice,
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

// Format x-axis based on timeRange
const getXAxisFormat = (timeRange, dataLength = 0) => {
  switch (timeRange) {
    case 'live':
      // For live view, show fewer labels based on data density
      // Show approximately every 2-3 hours (assuming 5-min intervals = 12 data points/hour)
      const liveInterval = dataLength > 288 ? 36 : dataLength > 144 ? 24 : 12;
      return { format: 'HH:mm', interval: liveInterval };
    case 'week':
      return { format: 'EEE d', interval: 0 };
    case 'month':
      return { format: 'MMM d', interval: 2 };
    case 'year':
      return { format: 'MMM', interval: 0 };
    case 'all':
      return { format: 'MMM yyyy', interval: 0 };
    default:
      return { format: 'MMM d HH:mm', interval: 'preserveStartEnd' };
  }
};

// Custom tooltip for the chart
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: 'rgba(15, 15, 26, 0.95)',
        border: '1px solid rgba(139, 92, 246, 0.3)',
        borderRadius: '8px',
        padding: '12px',
        color: '#fff',
        backdropFilter: 'blur(10px)'
      }}>
        <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#a78bfa' }}>
          {format(new Date(label), 'MMM dd, yyyy HH:mm')}
        </p>
        {payload.map((entry, index) => (
          <p key={index} style={{ margin: '4px 0', color: entry.color, fontSize: '14px' }}>
            {entry.name}: {entry.value?.toLocaleString() || 'N/A'} GP
          </p>
        ))}
      </div>
    );
  }
  return null;
};

function PriceChart({ data, timeRange = 'live' }) {
  if (!data || data.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '350px',
        color: 'rgba(255, 255, 255, 0.5)',
        background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px',
        border: '1px dashed rgba(255, 255, 255, 0.2)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>📊</div>
          <p>No price data available for this time range</p>
        </div>
      </div>
    );
  }

  // Group data based on timeRange
  const chartData = groupDataByTimeRange(data, timeRange);

  if (chartData.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '350px',
        color: 'rgba(255, 255, 255, 0.5)'
      }}>
        No valid price data available
      </div>
    );
  }

  // Calculate adaptive domain with padding
  const allPrices = chartData.flatMap(d => [d.avgHighPrice, d.avgLowPrice].filter(Boolean));
  
  if (allPrices.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '350px',
        color: 'rgba(255, 255, 255, 0.5)'
      }}>
        No price data available
      </div>
    );
  }

  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const range = maxPrice - minPrice;
  
  // Add 10% padding on each side, but don't go below 0
  const padding = Math.max(range * 0.1, minPrice * 0.05);
  const yDomain = [
    Math.max(0, Math.floor(minPrice - padding)),
    Math.ceil(maxPrice + padding)
  ];

  // Get x-axis formatting based on timeRange
  const xAxisConfig = getXAxisFormat(timeRange, chartData.length);
  const needsAngledLabels = ['month', 'year', 'all'].includes(timeRange);

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart 
          data={chartData} 
          margin={{ top: 10, right: 30, left: 20, bottom: needsAngledLabels ? 50 : 30 }}
        >
          <defs>
            <linearGradient id="colorHigh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#4ade80" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="colorLow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f87171" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
            </linearGradient>
          </defs>
          
          {/* Grid - both horizontal and vertical */}
          <CartesianGrid 
            strokeDasharray="3 3" 
            stroke="rgba(139, 92, 246, 0.15)" 
            vertical={true}
            horizontal={true}
          />
          
          <XAxis 
            dataKey="timestamp"
            tickFormatter={(timestamp) => format(new Date(timestamp), xAxisConfig.format)}
            stroke="rgba(255, 255, 255, 0.3)"
            tick={{ fill: 'rgba(255, 255, 255, 0.7)', fontSize: 11 }}
            tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            interval={xAxisConfig.interval}
            angle={needsAngledLabels ? -30 : 0}
            textAnchor={needsAngledLabels ? 'end' : 'middle'}
            height={needsAngledLabels ? 50 : 30}
          />
          
          <YAxis 
            yAxisId="price"
            domain={yDomain}
            tickFormatter={formatPrice}
            stroke="rgba(255, 255, 255, 0.3)"
            tick={{ fill: 'rgba(255, 255, 255, 0.7)', fontSize: 12 }}
            tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            width={60}
          />
          
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="circle"
          />
          
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="avgHighPrice"
            stroke="#4ade80"
            strokeWidth={2}
            fill="url(#colorHigh)"
            name="High Price"
            connectNulls={false}
            dot={timeRange !== 'live'}
            activeDot={{ r: 4, stroke: '#4ade80', strokeWidth: 2, fill: '#0f0f1a' }}
          />
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="avgLowPrice"
            stroke="#f87171"
            strokeWidth={2}
            fill="url(#colorLow)"
            name="Low Price"
            connectNulls={false}
            dot={timeRange !== 'live'}
            activeDot={{ r: 4, stroke: '#f87171', strokeWidth: 2, fill: '#0f0f1a' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default PriceChart;