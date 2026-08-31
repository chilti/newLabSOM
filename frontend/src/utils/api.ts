// Helper to resolve API URLs dynamically based on deployment environment
export const getApiUrl = (path: string): string => {
  // 1. Desktop protocol fallback (Photino loading via file:// or about:)
  const isFileProtocol = typeof window !== 'undefined' && window.location && (window.location.protocol === 'file:' || window.location.protocol === 'about:' || !window.location.host);
  if (isFileProtocol) {
    return `http://127.0.0.1:19080${path}`;
  }
  
  // 2. Production browser context served under a subdirectory path (e.g., /knoMap/ or /knomap/)
  if (typeof window !== 'undefined' && window.location) {
    const match = window.location.pathname.match(/^\/knomap/i);
    if (match) {
      return `${match[0]}${path}`;
    }
  }
  
  // 3. Standard relative API calls (Works for desktop webview2 on port 19080 and web server)
  return path;
};
