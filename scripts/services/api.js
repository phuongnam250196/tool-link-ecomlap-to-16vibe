/**
 * API Service Module
 * Handles all HTTP requests to the backend server
 */

import { SERVER_URL, API_ENDPOINTS } from '../config.js';

// API Configuration
const API_CONFIG = {
    BASE_URL: SERVER_URL,
    ENDPOINTS: API_ENDPOINTS
};

/**
 * Get authentication token from storage
 * @returns {Promise<string|null>} Token or null if not found
 */
async function getToken() {
    try {
        const result = await chrome.storage.local.get(['hmt-token']);
        return result['hmt-token'] || null;
    } catch (error) {
        console.error('Error getting token:', error);
        return null;
    }
}

/**
 * Save authentication token to storage
 * @param {string} token - JWT token
 * @returns {Promise<void>}
 */
async function saveToken(token) {
    try {
        await chrome.storage.local.set({ 'hmt-token': token });
    } catch (error) {
        console.error('Error saving token:', error);
        throw error;
    }
}

/**
 * Remove authentication token from storage
 * @returns {Promise<void>}
 */
async function removeToken() {
    try {
        await chrome.storage.local.remove(['hmt-token']);
    } catch (error) {
        console.error('Error removing token:', error);
    }
}

/**
 * Make HTTP request to API
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Response data
 */
async function makeRequest(endpoint, options = {}) {
    const token = await getToken();

    const defaultHeaders = {
        'Content-Type': 'application/json',
    };

    // Add token to headers if available
    if (token) {
        defaultHeaders['hmt-token'] = token;
    }

    const config = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    };

    try {
        const response = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, config);

        // Handle authentication errors
        if (response.status === 401 || response.status === 403) {
            await removeToken();
            throw new Error('Authentication failed. Please login again.');
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Request failed');
        }

        return data;
    } catch (error) {
        console.error('API Request Error:', error);
        throw error;
    }
}

/**
 * Upload file to server
 * @param {Blob} file - File blob
 * @param {string} endpoint - Upload endpoint
 * @returns {Promise<Object>} Upload response
 */
async function uploadFile(file, endpoint) {
    const token = await getToken();

    const formData = new FormData();
    formData.append('file', file);

    const headers = {};
    if (token) {
        headers['hmt-token'] = token;
    }

    try {
        const response = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: headers,
            body: formData,
        });

        if (response.status === 401 || response.status === 403) {
            await removeToken();
            throw new Error('Authentication failed. Please login again.');
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Upload failed');
        }

        return data;
    } catch (error) {
        console.error('Upload Error:', error);
        throw error;
    }
}

// Export functions
export {
    API_CONFIG,
    getToken,
    saveToken,
    removeToken,
    makeRequest,
    uploadFile
};
