/**
 * Design Ideas Service Module
 * Handles all Design Ideas related API calls
 */

import { API_CONFIG, makeRequest, uploadFile } from './api.js';

/**
 * Get list of design ideas
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} List of design ideas
 */
async function getDesignIdeas(params = {}) {
    try {
        const queryString = new URLSearchParams({
            page: params.page || 1,
            limit: params.limit || 20,
            is_used: params.is_used !== undefined ? params.is_used : '',
            tags: params.tags || '',
            search: params.search || ''
        }).toString();

        const response = await makeRequest(`/api/design-ideas?${queryString}`, {
            method: 'GET'
        });

        return response;
    } catch (error) {
        console.error('Get design ideas error:', error);
        throw error;
    }
}

/**
 * Get design idea detail
 * @param {string} ideaId - Design idea ID
 * @returns {Promise<Object>} Design idea detail
 */
async function getDesignIdeaInfo(ideaId) {
    try {
        const response = await makeRequest(`/api/design-ideas/${ideaId}`, {
            method: 'GET'
        });

        return response;
    } catch (error) {
        console.error('Get design idea info error:', error);
        throw error;
    }
}

/**
 * Add new design idea
 * @param {Object} ideaData - Design idea data
 * @returns {Promise<Object>} Created design idea
 */
async function addDesignIdea(ideaData) {
    try {
        const response = await makeRequest('/api/design-ideas/add', {
            method: 'POST',
            body: JSON.stringify(ideaData)
        });

        return response;
    } catch (error) {
        console.error('Add design idea error:', error);
        throw error;
    }
}

/**
 * Update design idea
 * @param {string} ideaId - Design idea ID
 * @param {Object} updateData - Update data
 * @returns {Promise<Object>} Updated design idea
 */
async function updateDesignIdea(ideaId, updateData) {
    try {
        const response = await makeRequest(`/api/design-ideas/${ideaId}`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });

        return response;
    } catch (error) {
        console.error('Update design idea error:', error);
        throw error;
    }
}

/**
 * Delete multiple design ideas
 * @param {string[]} ideaIds - Array of idea IDs to delete
 * @returns {Promise<Object>} Delete result
 */
async function deleteManyIdeas(ideaIds) {
    try {
        const response = await makeRequest('/api/design-ideas/delete-many', {
            method: 'POST',
            body: JSON.stringify({ ids: ideaIds })
        });

        return response;
    } catch (error) {
        console.error('Delete ideas error:', error);
        throw error;
    }
}

/**
 * Clone design idea with AI
 * @param {Object} cloneData - Clone data
 * @returns {Promise<Object>} Cloned design
 */
async function cloneDesignIdea(cloneData) {
    try {
        const response = await makeRequest('/api/design-ideas/clone', {
            method: 'POST',
            body: JSON.stringify(cloneData)
        });

        return response;
    } catch (error) {
        console.error('Clone design idea error:', error);
        throw error;
    }
}

/**
 * Analyze design idea with AI (only analysis, no generation)
 * @param {Object} analyzeData - Analysis data (idea_id, prompt, cropped_image, ai_provider)
 * @returns {Promise<Object>} Analysis result with generated prompt
 */
async function analyzeDesignIdea(analyzeData) {
    try {
        const response = await makeRequest('/api/design-ideas/analyze', {
            method: 'POST',
            body: JSON.stringify(analyzeData)
        });

        return response;
    } catch (error) {
        console.error('Analyze design idea error:', error);
        throw error;
    }
}

/**
 * Upload image as design idea
 * @param {Blob} imageBlob - Image blob
 * @param {Object} metadata - Additional metadata (name, tags, etc.)
 * @returns {Promise<Object>} Created design idea
 */
async function uploadImageAsIdea(imageBlob, metadata = {}) {
    try {
        // First upload the image
        const formData = new FormData();
        formData.append('file', imageBlob, metadata.filename || `gemini-${Date.now()}.png`);

        // Upload image first
        const uploadResponse = await uploadFile(imageBlob, '/api/images/upload');

        if (!uploadResponse || !uploadResponse.url) {
            throw new Error('Upload failed - no URL returned');
        }

        // Then create design idea with uploaded image URL
        const ideaData = {
            name: metadata.name || `Gemini Idea ${new Date().toLocaleDateString()}`,
            tags: metadata.tags || ['gemini', 'extension'],
            image_url: uploadResponse.url,
            is_merch: false,
            ...metadata
        };

        const ideaResponse = await addDesignIdea(ideaData);

        return ideaResponse;
    } catch (error) {
        console.error('Upload image as idea error:', error);
        throw error;
    }
}

/**
 * Bulk update design ideas
 * @param {Object} bulkData - Bulk update data
 * @returns {Promise<Object>} Update result
 */
async function bulkUpdateIdeas(bulkData) {
    try {
        const response = await makeRequest('/api/design-ideas/bulk-update', {
            method: 'POST',
            body: JSON.stringify(bulkData)
        });

        return response;
    } catch (error) {
        console.error('Bulk update ideas error:', error);
        throw error;
    }
}

/**
 * Get design ideas statistics
 * @returns {Promise<Object>} Statistics
 */
async function getStatistics() {
    try {
        const response = await getDesignIdeas({ limit: 1000 });

        if (!response.ideas) {
            return {
                total: 0,
                used: 0,
                unused: 0,
                tags: []
            };
        }

        const total = response.ideas.length;
        const used = response.ideas.filter(idea => idea.is_used).length;
        const unused = total - used;

        // Get all unique tags
        const tagsSet = new Set();
        response.ideas.forEach(idea => {
            if (idea.tags && Array.isArray(idea.tags)) {
                idea.tags.forEach(tag => tagsSet.add(tag));
            }
        });

        return {
            total,
            used,
            unused,
            tags: Array.from(tagsSet)
        };
    } catch (error) {
        console.error('Get statistics error:', error);
        return {
            total: 0,
            used: 0,
            unused: 0,
            tags: []
        };
    }
}

// Export functions
export {
    getDesignIdeas,
    getDesignIdeaInfo,
    addDesignIdea,
    updateDesignIdea,
    deleteManyIdeas,
    cloneDesignIdea,
    analyzeDesignIdea,
    uploadImageAsIdea,
    bulkUpdateIdeas,
    getStatistics
};
