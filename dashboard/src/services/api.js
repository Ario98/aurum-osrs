// API service for communicating with the backend
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Generic fetch wrapper with error handling
async function fetchFromAPI(endpoint) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}

// Get items with search, pagination, and sorting
export async function getItems(
  search = '', 
  membersOnly = null, 
  sortBy = 'name', 
  sortOrder = 'asc',
  page = 1,
  pageSize = 25
) {
  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (membersOnly !== null) params.append('members_only', membersOnly);
  params.append('sort_by', sortBy);
  params.append('sort_order', sortOrder);
  params.append('page', page);
  params.append('page_size', pageSize);
  
  return fetchFromAPI(`/api/items?${params}`);
}

// Get count of items for pagination
export async function getItemsCount(search = '', membersOnly = null) {
  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (membersOnly !== null) params.append('members_only', membersOnly);
  
  return fetchFromAPI(`/api/items/count?${params}`);
}

// Get specific item by ID
export async function getItem(itemId) {
  return fetchFromAPI(`/api/items/${itemId}`);
}

// Get price history for an item
export async function getPriceHistory(itemId, startDate = null, endDate = null, limit = 1000) {
  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate.toISOString());
  if (endDate) params.append('end_date', endDate.toISOString());
  params.append('limit', limit);
  
  return fetchFromAPI(`/api/prices/${itemId}?${params}`);
}

// Get weekly aggregated price history (for year/all-time views)
export async function getWeeklyPriceHistory(itemId, weeks = 52) {
  const params = new URLSearchParams();
  params.append('weeks', weeks);
  
  return fetchFromAPI(`/api/prices/${itemId}/weekly?${params}`);
}

// Get latest prices for all items
export async function getLatestPrices(limit = 100) {
  const params = new URLSearchParams();
  params.append('limit', limit);
  
  return fetchFromAPI(`/api/prices/latest?${params}`);
}

// Health check
export async function healthCheck() {
  return fetchFromAPI('/health');
}

// Search items suggestions
export async function searchItemsSuggestions(query) {
  const params = new URLSearchParams();
  params.append('q', query);
  return fetchFromAPI(`/api/items/search?${params}`);
}
