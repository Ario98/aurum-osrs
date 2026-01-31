import React, { useState, useEffect } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  ComposedChart,
  Bar
} from 'recharts';
import { format, startOfDay } from 'date-fns';

// Smart number formatter for prices
const formatPrice = (value) => {
  if (!value || value === 0) return '0';
  if (value < 1000) return value.toString();
  if (value < 1000000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1000000).toFixed(1)}M`;
};

// Smart number formatter for volume
const formatVolume = (value) => {
  if (!value || value === 0) return '0';
  if (value < 1000) return value.toString();
  if (value < 1000000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1000000).toFixed(1)}M`;
};

// Toggle Switch Component
const ToggleSwitch = ({ label, checked, onChange }) => (
  <div style={{ 
    display: 'flex', 
    alignItems: 'center', 
    gap: '8px',
    cursor: 'pointer',
    userSelect: 'none'
  }} onClick={() => onChange(!checked)}>
    <span style={{ 
      fontSize: '13px', 
      color: checked ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.5)'
    }}>
      {label}
    </span>
    <div style={{
      width: '36px',
      height: '20px',
      background: checked ? 'rgba(139, 92, 246, 0.6)' : 'rgba(255, 255, 255, 0.2)',
      borderRadius: '10px',
      position: 'relative',
      transition: 'background 0.2s ease'
    }}>
      <div style={{
        width: '16px',
        height: '16px',
        background: '#fff',
        borderRadius: '50%',
        position: 'absolute',
        top: '2px',
        left: checked ? '18px' : '2px',
        transition: 'left 0.2s ease'
      }} />
    </div>
  </div>
);

// Group data by time period based on timeRange
const groupDataByTimeRange = (data, timeRange) => {
  if (!data || data.length === 0) return [];
  
  // For live view, return data as-is without grouping
  if (timeRange === 'live') {
    return data.map(item => ({
      timestamp: item.timestamp,
      avgHighPrice: item.avg_high_price || null,
      avgLowPrice: item.avg_low_price || null,
      highVolume: item.high_price_volume || 0,
      lowVolume: item.low_price_volume || 0,
    })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
  
  // For week and month views, create 4 daily snapshots
  if (timeRange === 'week' || timeRange === 'month') {
    return createDailySnapshots(data);
  }
  
  // For year and all-time, data should already be weekly aggregated from backend
  return data.map(item => ({
    timestamp: item.timestamp,
    avgHighPrice: item.avg_high_price || null,
    avgLowPrice: item.avg_low_price || null,
    highVolume: item.high_price_volume || 0,
    lowVolume: item.low_price_volume || 0,
  })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

// Create 4 daily snapshots (00:00, 06:00, 12:00, 18:00) for week/month views
const createDailySnapshots = (data) => {
  const dailySnapshots = {};
  const snapshotHours = [0, 6, 12, 18];
  
  data.forEach(item => {
    if (!item.avg_high_price && !item.avg_low_price) return;
    
    const date = new Date(item.timestamp);
    const hour = date.getHours();
    const dayKey = startOfDay(date).toISOString();
    
    let closestHour = snapshotHours[0];
    let minDiff = Math.abs(hour - snapshotHours[0]);
    
    for (const snapshotHour of snapshotHours) {
      const diff = Math.abs(hour - snapshotHour);
      if (diff < minDiff) {
        minDiff = diff;
        closestHour = snapshotHour;
      }
    }
    
    if (minDiff > 3) return;
    
    const snapshotKey = `${dayKey}_${closestHour}`;
    
    if (!dailySnapshots[snapshotKey]) {
      dailySnapshots[snapshotKey] = {
        timestamp: new Date(new Date(dayKey).setHours(closestHour, 0, 0, 0)).toISOString(),
        highPrice: item.avg_high_price || null,
        lowPrice: item.avg_low_price || null,
        highVolume: item.high_price_volume || 0,
        lowVolume: item.low_price_volume || 0,
        count: 1
      };
    } else {
      if (item.avg_high_price) {
        dailySnapshots[snapshotKey].highPrice = dailySnapshots[snapshotKey].highPrice
          ? Math.max(dailySnapshots[snapshotKey].highPrice, item.avg_high_price)
          : item.avg_high_price;
      }
      if (item.avg_low_price) {
        dailySnapshots[snapshotKey].lowPrice = dailySnapshots[snapshotKey].lowPrice
          ? Math.min(dailySnapshots[snapshotKey].lowPrice, item.avg_low_price)
          : item.avg_low_price;
      }
      dailySnapshots[snapshotKey].highVolume += item.high_price_volume || 0;
      dailySnapshots[snapshotKey].lowVolume += item.low_price_volume || 0;
      dailySnapshots[snapshotKey].count += 1;
    }
  });
  
  return Object.values(dailySnapshots)
    .map(item => ({
      timestamp: item.timestamp,
      avgHighPrice: item.highPrice,
      avgLowPrice: item.lowPrice,
      highVolume: item.highVolume,
      lowVolume: item.lowVolume,
    }))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

// Format x-axis based on timeRange - returns format string and interval
const getXAxisFormat = (timeRange, dataLength) => {
  switch (timeRange) {
    case 'live':
      return { format: 'HH:mm', interval: 'preserveStartEnd' };
    case 'week':
      return { format: 'EEE d', interval: 3 };
    case 'month':
      // Calculate interval based on data length - aim for ~8-10 ticks
      // For month view with daily data, show roughly every 3-4 days
      if (dataLength > 0) {
        const targetTickCount = 8;
        const interval = Math.max(1, Math.floor(dataLength / targetTickCount));
        return { format: 'MMM d', interval };
      }
      return { format: 'MMM d', interval: 4 };
    case 'year':
    case 'all':
      // For weekly data, show roughly every month (4 weeks)
      if (dataLength > 0) {
        const targetTickCount = 6; // Aim for ~6 month labels
        const interval = Math.max(1, Math.floor(dataLength / targetTickCount));
        return { format: 'MMM yyyy', interval };
      }
      return { format: 'MMM yyyy', interval: 4 };
    default:
      return { format: 'MMM d HH:mm', interval: 'preserveStartEnd' };
  }
};

// Combined tooltip showing both price and volume
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload;
    const hasVolume = data?.highVolume !== undefined || data?.lowVolume !== undefined;
    
    return (
      <div style={{
        background: 'rgba(15, 15, 26, 0.95)',
        border: '1px solid rgba(139, 92, 246, 0.3)',
        borderRadius: '8px',
        padding: '12px',
        color: '#fff',
        backdropFilter: 'blur(10px)',
        minWidth: '200px'
      }}>
        <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#a78bfa' }}>
          {format(new Date(label), 'MMM dd, yyyy')}
        </p>
        
        {payload.map((entry, index) => {
          if (entry.dataKey === 'avgHighPrice') {
            return (
              <p key={index} style={{ margin: '4px 0', color: '#4ade80', fontSize: '14px' }}>
                High: {entry.value?.toLocaleString() || 'N/A'} GP
              </p>
            );
          }
          if (entry.dataKey === 'avgLowPrice') {
            return (
              <p key={index} style={{ margin: '4px 0', color: '#f87171', fontSize: '14px' }}>
                Low: {entry.value?.toLocaleString() || 'N/A'} GP
              </p>
            );
          }
          if (entry.dataKey === 'highVolume') {
            return (
              <p key={index} style={{ margin: '4px 0', color: 'rgba(74, 222, 128, 0.8)', fontSize: '14px' }}>
                Buy: {formatVolume(entry.value)}
              </p>
            );
          }
          if (entry.dataKey === 'lowVolume') {
            return (
              <p key={index} style={{ margin: '4px 0', color: 'rgba(248, 113, 113, 0.8)', fontSize: '14px' }}>
                Sell: {formatVolume(entry.value)}
              </p>
            );
          }
          return null;
        })}
        
        {hasVolume && (
          <p style={{ margin: '8px 0 0 0', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255, 255, 255, 0.7)', fontSize: '13px' }}>
            Total: {formatVolume((data?.highVolume || 0) + (data?.lowVolume || 0))}
          </p>
        )}
      </div>
    );
  }
  return null;
};

function PriceChart({ data, timeRange = 'live' }) {
  const [showHighPrice, setShowHighPrice] = useState(() => JSON.parse(localStorage.getItem('chartShowHighPrice') ?? 'true'));
  const [showLowPrice, setShowLowPrice] = useState(() => JSON.parse(localStorage.getItem('chartShowLowPrice') ?? 'true'));
  const [showHighVolume, setShowHighVolume] = useState(() => JSON.parse(localStorage.getItem('chartShowHighVolume') ?? 'true'));
  const [showLowVolume, setShowLowVolume] = useState(() => JSON.parse(localStorage.getItem('chartShowLowVolume') ?? 'true'));
  const [showVolumeChart, setShowVolumeChart] = useState(() => JSON.parse(localStorage.getItem('chartShowVolumeChart') ?? 'true'));
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  useEffect(() => localStorage.setItem('chartShowHighPrice', JSON.stringify(showHighPrice)), [showHighPrice]);
  useEffect(() => localStorage.setItem('chartShowLowPrice', JSON.stringify(showLowPrice)), [showLowPrice]);
  useEffect(() => localStorage.setItem('chartShowHighVolume', JSON.stringify(showHighVolume)), [showHighVolume]);
  useEffect(() => localStorage.setItem('chartShowLowVolume', JSON.stringify(showLowVolume)), [showLowVolume]);
  useEffect(() => localStorage.setItem('chartShowVolumeChart', JSON.stringify(showVolumeChart)), [showVolumeChart]);

  if (!data || data.length === 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', height: '350px',
        color: 'rgba(255, 255, 255, 0.5)', background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px', border: '1px dashed rgba(255, 255, 255, 0.2)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>📊</div>
          <p>No price data available</p>
        </div>
      </div>
    );
  }

  // Validate data structure
  const hasValidData = data.every(item => 
    item && typeof item === 'object' && item.timestamp
  );
  
  if (!hasValidData) {
    console.warn('PriceChart: Invalid data structure detected');
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', height: '350px',
        color: 'rgba(255, 255, 255, 0.5)', background: 'rgba(255, 255, 255, 0.03)',
        borderRadius: '12px', border: '1px dashed rgba(255, 255, 255, 0.2)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.3 }}>⚠️</div>
          <p>Invalid data format</p>
        </div>
      </div>
    );
  }

  const chartData = groupDataByTimeRange(data, timeRange);
  
  // Additional validation for chartData
  if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
    console.warn('PriceChart: No valid chart data after grouping');
    return (
      <div style={{ 
        display: 'flex', alignItems: 'center', justifyContent: 'center', 
        height: '350px', color: 'rgba(255, 255, 255, 0.5)' 
      }}>
        No valid price data
      </div>
    );
  }

  const allPrices = chartData.flatMap(d => [d.avgHighPrice, d.avgLowPrice].filter(Boolean));
  if (allPrices.length === 0) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '350px', color: 'rgba(255, 255, 255, 0.5)' }}>No price data</div>;
  }

  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  const padding = Math.max(priceRange * 0.1, minPrice * 0.05);
  const priceDomain = [Math.max(0, Math.floor(minPrice - padding)), Math.ceil(maxPrice + padding)];

  const allVolumes = chartData.flatMap(d => [d.highVolume, d.lowVolume].filter(Boolean));
  const maxVolume = allVolumes.length > 0 ? Math.max(...allVolumes) : 0;
  const volumeDomain = [0, maxVolume * 1.1];

  const needsAngledLabels = ['year', 'all'].includes(timeRange);
  const xAxisConfig = getXAxisFormat(timeRange, chartData.length);
  
  // Use identical margins for both charts to ensure proper alignment
  const chartMargins = { top: 10, right: 30, left: 20, bottom: needsAngledLabels ? 50 : 30 };

  return (
    <div style={{ width: '100%' }}>
      {/* Toggle Panel */}
      <div style={{ marginBottom: '16px' }}>
        <div 
          onClick={() => setIsPanelOpen(!isPanelOpen)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
            padding: '8px 12px', background: 'rgba(139, 92, 246, 0.1)',
            borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.2)',
            width: 'fit-content'
          }}
        >
          <span style={{ fontSize: '14px', color: '#a78bfa', fontWeight: 500 }}>Chart Settings</span>
          <span style={{ fontSize: '12px', color: '#a78bfa', transform: isPanelOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>▼</span>
        </div>
        
        {isPanelOpen && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '12px', marginTop: '12px', padding: '16px',
            background: 'rgba(139, 92, 246, 0.05)', borderRadius: '8px',
            border: '1px solid rgba(139, 92, 246, 0.1)'
          }}>
            <ToggleSwitch label="High Price" checked={showHighPrice} onChange={setShowHighPrice} />
            <ToggleSwitch label="Low Price" checked={showLowPrice} onChange={setShowLowPrice} />
            <ToggleSwitch label="Buy Volume" checked={showHighVolume} onChange={setShowHighVolume} />
            <ToggleSwitch label="Sell Volume" checked={showLowVolume} onChange={setShowLowVolume} />
            <ToggleSwitch label="Volume Chart" checked={showVolumeChart} onChange={setShowVolumeChart} />
          </div>
        )}
      </div>

      {/* Price Chart (Top) - No syncId */}
      <div style={{ width: '100%', height: showVolumeChart ? '280px' : '350px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={chartMargins}>
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
            
            {/* X-axis always shown on price chart */}
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
              domain={priceDomain}
              tickFormatter={formatPrice}
              stroke="rgba(255, 255, 255, 0.3)"
              tick={{ fill: 'rgba(255, 255, 255, 0.7)', fontSize: 12 }}
              tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              width={60}
            />
            
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.15)" vertical={false} />
            <Tooltip content={<CustomTooltip />} />
            
            {(showHighPrice || showLowPrice) && (
              <Legend 
                verticalAlign="top"
                align="left"
                wrapperStyle={{ paddingBottom: '10px' }}
                iconType="circle"
                payload={[
                  ...(showHighPrice ? [{ value: 'High Price', type: 'circle', color: '#4ade80', id: 'highPrice' }] : []),
                  ...(showLowPrice ? [{ value: 'Low Price', type: 'circle', color: '#f87171', id: 'lowPrice' }] : [])
                ]}
              />
            )}
            
            {showHighPrice && (
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
            )}
            {showLowPrice && (
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
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume Chart (Bottom) - No syncId, identical margins */}
      {showVolumeChart && (
        <div style={{ width: '100%', height: '150px', marginTop: '4px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart 
              data={chartData} 
              margin={chartMargins}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" vertical={false} />
              
              {/* X-axis hidden on volume chart - shown on price chart instead */}
              <XAxis dataKey="timestamp" hide={true} />
              
              <YAxis 
                yAxisId="volume"
                orientation="right"
                domain={volumeDomain}
                hide={true}
              />
              
              <Tooltip content={<CustomTooltip />} />
              
              {(showHighVolume || showLowVolume) && (
                <Legend 
                  verticalAlign="bottom"
                  align="right"
                  wrapperStyle={{ paddingTop: '5px' }}
                  iconType="rect"
                  payload={[
                    ...(showHighVolume ? [{ value: 'Buy Vol', type: 'rect', color: 'rgba(74, 222, 128, 0.6)', id: 'highVolume' }] : []),
                    ...(showLowVolume ? [{ value: 'Sell Vol', type: 'rect', color: 'rgba(248, 113, 113, 0.6)', id: 'lowVolume' }] : [])
                  ]}
                />
              )}
              
              {showHighVolume && (
                <Bar
                  yAxisId="volume"
                  dataKey="highVolume"
                  stackId="volume"
                  fill="rgba(74, 222, 128, 0.6)"
                  stroke="rgba(74, 222, 128, 0.8)"
                  strokeWidth={1}
                  name="Buy Volume"
                  barSize={20}
                />
              )}
              {showLowVolume && (
                <Bar
                  yAxisId="volume"
                  dataKey="lowVolume"
                  stackId="volume"
                  fill="rgba(248, 113, 113, 0.6)"
                  stroke="rgba(248, 113, 113, 0.8)"
                  strokeWidth={1}
                  name="Sell Volume"
                  barSize={20}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default PriceChart;
