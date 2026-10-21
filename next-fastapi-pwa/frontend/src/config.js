export const API = (import.meta.env?.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
export const CONNECTION_INTERVAL = 500;
export const SYNC_INTERVAL = 15000;
