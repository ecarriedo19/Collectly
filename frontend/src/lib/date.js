// Date formatting utilities with timezone support

/**
 * Format date as MM/DD/YYYY
 * @param {string|Date} date - Date to format
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns {string} Formatted date string
 */
export const formatDate = (date, timezone = 'UTC') => {
  if (!date) return '-';
  
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    
    return d.toLocaleDateString('en-US', {
      timeZone: timezone,
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    });
  } catch (e) {
    // Fallback if timezone is invalid
    const d = new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  }
};

/**
 * Format date and time as MM/DD/YYYY HH:MM AM/PM
 * @param {string|Date} date - Date to format
 * @param {string} timezone - IANA timezone string
 * @returns {string} Formatted datetime string
 */
export const formatDateTime = (date, timezone = 'UTC') => {
  if (!date) return '-';
  
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    
    return d.toLocaleDateString('en-US', {
      timeZone: timezone,
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    // Fallback
    const d = new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    const hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${month}/${day}/${year} ${hour12}:${minutes} ${ampm}`;
  }
};

/**
 * Get days difference between two dates
 * @param {string|Date} date1 
 * @param {string|Date} date2 
 * @returns {number} Days difference (positive if date1 > date2)
 */
export const getDaysDiff = (date1, date2 = new Date()) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  // Reset time to compare dates only
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);
  
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
};
