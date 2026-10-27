/**
 * 16vibe Assistant Configuration Module
 * Loads settings from .env file with fallbacks
 */

export const DEFAULT_CONFIG = {
    FRONTEND_URL: 'https://ecomlap.com',
    BACKEND_URL: 'https://api.16vibe.com',
    SERVER_URL: 'https://api.16vibe.com',
};

export const API_ENDPOINTS = {
    LOGIN: '/api/auth/login',
    INFO: '/api/auth/info',
    LOGOUT: '/api/auth/logout',
    IMAGES_UPLOAD: '/api/images/upload',
    DESIGNS_UPLOAD: '/api/designs/upload-from-extension',
    CATEGORIES_ALL: '/api/designs/categories/all',
    DESIGN_IDEAS: '/api/design-ideas',
    DESIGN_IDEAS_CLAIM_NEXT: '/api/design-ideas/extension/claim-next',
    DESIGN_IDEAS_STATS: '/api/design-ideas/extension/stats',
    DESIGN_IDEAS_RELEASE_STALE: '/api/design-ideas/extension/release-stale',
};

/**
 * Load and parse .env configuration file
 * @returns {Promise<Object>}
 */
export async function loadEnv() {
    try {
        const envUrl = chrome.runtime.getURL('.env');
        const res = await fetch(envUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const env = {};
        
        text.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx !== -1) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    const val = trimmed.slice(eqIdx + 1).trim();
                    env[key] = val;
                }
            }
        });

        return {
            ...DEFAULT_CONFIG,
            ...env,
            SERVER_URL: env.BACKEND_URL || DEFAULT_CONFIG.BACKEND_URL,
        };
    } catch (err) {
        console.warn('[16vibe Config] Could not load .env file, using default values:', err);
        return DEFAULT_CONFIG;
    }
}

// Current active server URL (defaults to localhost:9000 or loaded dynamically)
export let SERVER_URL = DEFAULT_CONFIG.SERVER_URL;

// Automatically initialize and sync SERVER_URL from .env
loadEnv().then(config => {
    SERVER_URL = config.SERVER_URL;
}).catch(() => {});
