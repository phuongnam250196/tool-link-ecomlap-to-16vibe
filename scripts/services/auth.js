/**
 * Authentication Service Module
 * Handles user authentication and session management
 */

import { API_CONFIG, makeRequest, saveToken, removeToken, getToken } from './api.js';

/**
 * Login user with email and password
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {boolean} rememberMe - Remember login credentials
 * @returns {Promise<Object>} Login response with token and userId
 */
async function login(email, password, rememberMe = false) {
    try {
        const response = await makeRequest(API_CONFIG.ENDPOINTS.LOGIN, {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });

        
        // Save token
        if (response.token) {
            await saveToken(response.token);

            // Save credentials if remember me is checked
            if (rememberMe) {
                await chrome.storage.local.set({
                    'saved-email': email,
                    'saved-password': password,
                    'remember-me': true
                });
            } else {
                // Clear saved credentials
                await chrome.storage.local.remove(['saved-email', 'saved-password', 'remember-me']);
            }

            // Save user ID
            if (response.userId) {
                await chrome.storage.local.set({ 'user-id': response.userId });
            }
        }

        return response;
    } catch (error) {
        console.error('Login error:', error);
        throw error;
    }
}

/**
 * Logout user
 * @returns {Promise<void>}
 */
async function logout() {
    try {
        await removeToken();
        await chrome.storage.local.remove(['user-id', 'user-info']);
    } catch (error) {
        console.error('Logout error:', error);
    }
}

/**
 * Check if user is authenticated
 * @returns {Promise<boolean>} True if authenticated
 */
async function isAuthenticated() {
    const token = await getToken();
    return !!token;
}

/**
 * Get current user info
 * @returns {Promise<Object|null>} User info or null
 */
async function getUserInfo() {
    try {
        const token = await getToken();
        if (!token) {
            return null;
        }

        // Check if user info is cached
        const cached = await chrome.storage.local.get(['user-info']);
        if (cached['user-info']) {
            return cached['user-info'];
        }

        // Fetch user info from server
        const response = await makeRequest(API_CONFIG.ENDPOINTS.INFO, {
            method: 'POST',
        });

        if (response.info) {
            // Cache user info
            await chrome.storage.local.set({ 'user-info': response.info });
            return response.info;
        }

        return null;
    } catch (error) {
        console.error('Get user info error:', error);
        return null;
    }
}

/**
 * Get saved login credentials
 * @returns {Promise<Object>} Saved credentials
 */
async function getSavedCredentials() {
    try {
        const result = await chrome.storage.local.get(['saved-email', 'saved-password', 'remember-me']);
        return {
            email: result['saved-email'] || '',
            password: result['saved-password'] || '',
            rememberMe: result['remember-me'] || false
        };
    } catch (error) {
        console.error('Get saved credentials error:', error);
        return { email: '', password: '', rememberMe: false };
    }
}

/**
 * Validate token and refresh if needed
 * @returns {Promise<boolean>} True if token is valid
 */
async function validateToken() {
    try {
        const userInfo = await getUserInfo();
        return !!userInfo;
    } catch (error) {
        await removeToken();
        return false;
    }
}

// Export functions
export {
    login,
    logout,
    isAuthenticated,
    getUserInfo,
    getSavedCredentials,
    validateToken
};
