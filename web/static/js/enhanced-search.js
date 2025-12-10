/**
 * Enhanced Search JavaScript
 * Handles full-text search, sorting, filters, history, and saved searches
 */

(function() {
    'use strict';

    // State management
    const searchState = {
        currentQuery: '',
        currentFilters: {},
        currentSort: { by: 'relevance', order: 'desc' },
        currentPage: 1,
        perPage: 50,
        results: [],
        totalResults: 0,
        totalPages: 0,
        loading: false
    };
    
    //  OPTIMIZATION: Request cancellation for concurrent searches
    let currentSearchController = null;

    // Initialize on page load
    document.addEventListener('DOMContentLoaded', function() {
        initializeSearch();
        loadSearchHistory();
        loadSavedSearches();
    });

    /**
     * Initialize search interface
     */
    function initializeSearch() {
        const searchForm = document.getElementById('enhancedSearchForm');
        const searchInput = document.getElementById('searchQuery');
        const sortSelect = document.getElementById('sortBy');
        const sortOrderSelect = document.getElementById('sortOrder');
        const exportBtn = document.getElementById('exportResultsBtn');
        const saveSearchBtn = document.getElementById('saveSearchBtn');

        if (searchForm) {
            searchForm.addEventListener('submit', handleSearchSubmit);
        }

        if (searchInput) {
            //  OPTIMIZED: Debounced search with request cancellation
            // Reduced debounce time from 500ms to 300ms for better responsiveness
            let searchTimeout;
            searchInput.addEventListener('input', function() {
                // Cancel any pending search
                if (currentSearchController) {
                    currentSearchController.abort();
                    currentSearchController = null;
                }
                
                clearTimeout(searchTimeout);
                
                // Clear results immediately if query is too short
                if (this.value.trim().length < 2) {
                    clearResults();
                    return;
                }
                
                searchTimeout = setTimeout(() => {
                    if (this.value.trim().length >= 2) {
                        performSearch();
                    }
                }, 300); // Reduced from 500ms for faster response
            });
        }

        if (sortSelect) {
            sortSelect.addEventListener('change', function() {
                searchState.currentSort.by = this.value;
                performSearch();
            });
        }

        if (sortOrderSelect) {
            sortOrderSelect.addEventListener('change', function() {
                searchState.currentSort.order = this.value;
                performSearch();
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', handleExport);
        }

        if (saveSearchBtn) {
            saveSearchBtn.addEventListener('click', showSaveSearchModal);
        }

        // Filter change handlers
        setupFilterHandlers();
    }

    /**
     * Setup filter change handlers
     */
    function setupFilterHandlers() {
        const filterInputs = document.querySelectorAll('.search-filter');
        filterInputs.forEach(input => {
            input.addEventListener('change', function() {
                updateFilters();
                performSearch();
            });
        });
    }

    /**
     * Update filters from form
     */
    function updateFilters() {
        searchState.currentFilters = {
            file_type: document.getElementById('filterFileType')?.value || '',
            source_id: document.getElementById('filterSourceId')?.value || '',
            side_id: document.getElementById('filterSideId')?.value || '',
            date_from: document.getElementById('filterDateFrom')?.value || '',
            date_to: document.getElementById('filterDateTo')?.value || '',
            category_id: document.getElementById('filterCategoryId')?.value || ''
        };
    }

    /**
     * Handle search form submission
     */
    function handleSearchSubmit(e) {
        e.preventDefault();
        searchState.currentPage = 1;
        performSearch();
    }

    /**
     * Perform search using enhanced API
     */
    async function performSearch() {
        const searchInput = document.getElementById('searchQuery');
        if (!searchInput) return;

        const query = searchInput.value.trim();
        if (!query || query.length < 2) {
            clearResults();
            return;
        }

        searchState.currentQuery = query;
        updateFilters();
        searchState.loading = true;

        showLoading();

        try {
            //  OPTIMIZATION: Cancel previous search request if still pending
            if (currentSearchController) {
                currentSearchController.abort();
            }
            
            // Create new AbortController for this search
            currentSearchController = new AbortController();
            const signal = currentSearchController.signal;
            
            //  NEW: Check if comprehensive search is enabled
            const searchAllData = document.getElementById('searchAllData')?.checked || false;
            
            const params = new URLSearchParams({
                query: query,
                page: searchState.currentPage,
                per_page: searchState.perPage,
                sort_by: searchState.currentSort.by,
                sort_order: searchState.currentSort.order,
                use_fulltext: searchAllData ? 'false' : 'true',  // Use comprehensive search instead of fulltext when searching all data
                search_all_data: searchAllData ? 'true' : 'false',
                ...Object.fromEntries(
                    Object.entries(searchState.currentFilters)
                        .filter(([_, v]) => v !== '')
                )
            });

            const response = await fetch(`/api/search?${params}`, { signal });
            
            // Clear controller after successful fetch
            currentSearchController = null;
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            searchState.results = data.results || [];
            searchState.totalResults = data.pagination?.total || 0;
            searchState.totalPages = data.pagination?.total_pages || 0;

            displayResults(data);
            updatePagination(data.pagination);

        } catch (error) {
            // Don't show error if request was aborted (user typed new query)
            if (error.name === 'AbortError') {
                console.log('Search request cancelled');
                return;
            }
            
            console.error('Search error:', error);
            if (window.showError) {
                window.showError('Error performing search: ' + error.message);
            } else {
                showError('Error performing search: ' + error.message);
            }
        } finally {
            searchState.loading = false;
            hideLoading();
            // Clear controller reference
            if (currentSearchController) {
                currentSearchController = null;
            }
        }
    }

    /**
     * Display search results
     */
    function displayResults(data) {
        const resultsContainer = document.getElementById('searchResults');
        if (!resultsContainer) return;

        if (!data.results || data.results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="bi bi-search display-4 d-block mb-3"></i>
                    <p>No results found for "${searchState.currentQuery}"</p>
                </div>
            `;
            return;
        }

        let html = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <div>
                    <strong>${data.pagination.total}</strong> results found
                </div>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary" onclick="window.enhancedSearch.exportResults('csv')">
                        <i class="bi bi-file-earmark-spreadsheet me-1"></i>CSV
                    </button>
                    <button class="btn btn-sm btn-outline-primary" onclick="window.enhancedSearch.exportResults('excel')">
                        <i class="bi bi-file-earmark-excel me-1"></i>Excel
                    </button>
                    <button class="btn btn-sm btn-outline-primary" onclick="window.enhancedSearch.exportResults('json')">
                        <i class="bi bi-file-earmark-code me-1"></i>JSON
                    </button>
                </div>
            </div>
        `;

        //  NEW: Group results by type for better organization
        const resultsByType = {};
        data.results.forEach(result => {
            const resultType = result.result_type || 'file';
            if (!resultsByType[resultType]) {
                resultsByType[resultType] = [];
            }
            resultsByType[resultType].push(result);
        });
        
        // Display results grouped by type
        const typeLabels = {
            'file': { icon: 'bi-file-earmark', label: 'Files', color: 'primary' },
            'category': { icon: 'bi-tags', label: 'Categories', color: 'success' },
            'keyword': { icon: 'bi-key', label: 'Keywords', color: 'warning' },
            'source': { icon: 'bi-building', label: 'Sources', color: 'info' },
            'side': { icon: 'bi-diagram-3', label: 'Sides', color: 'secondary' },
            'word': { icon: 'bi-text-paragraph', label: 'Words', color: 'dark' },
            'title': { icon: 'bi-heading', label: 'Titles', color: 'primary' }
        };
        
        Object.keys(resultsByType).forEach(resultType => {
            const typeInfo = typeLabels[resultType] || { icon: 'bi-circle', label: resultType, color: 'secondary' };
            const typeResults = resultsByType[resultType];
            
            html += `
                <div class="mb-4">
                    <h5 class="mb-3">
                        <i class="bi ${typeInfo.icon} me-2"></i>
                        ${typeInfo.label} (${typeResults.length})
                    </h5>
            `;
            
            typeResults.forEach(result => {
                const resultType = result.result_type || 'file';
                
                // Build result HTML based on type
                let resultHtml = '';
                let resultName = result.name || result.file_name || 'Unknown';
                let resultLink = '#';
                let resultDetails = '';
                
                switch(resultType) {
                    case 'file':
                        resultLink = `/file/${result.id}`;
                        resultDetails = `
                            <small class="text-muted d-block mb-1">
                                <span class="me-3">
                                    <i class="bi bi-building me-1"></i>${escapeHtml(result.source_name || 'Unknown')}
                                </span>
                                <span class="me-3">
                                    <i class="bi bi-diagram-3 me-1"></i>${escapeHtml(result.side_name || 'Unknown')}
                                </span>
                                <span class="me-3">
                                    <i class="bi bi-calendar me-1"></i>${result.date || 'N/A'}
                                </span>
                            </small>
                            <div class="d-flex gap-2 mt-2">
                                <button class="btn btn-sm btn-outline-secondary" onclick="window.enhancedSearch.previewFile(${result.id})">
                                    <i class="bi bi-eye me-1"></i>Preview
                                </button>
                                <span class="badge bg-secondary">${result.type || 'Unknown'}</span>
                            </div>
                        `;
                        break;
                    case 'category':
                        resultLink = `/category/${result.id}`;
                        resultDetails = `
                            <small class="text-muted d-block mb-1">
                                <span class="me-3">
                                    <i class="bi bi-file-earmark me-1"></i>${result.file_count || 0} files
                                </span>
                            </small>
                        `;
                        break;
                    case 'keyword':
                        resultLink = `/keywords/${result.id}`;
                        resultDetails = `
                            <small class="text-muted d-block mb-1">
                                <span class="me-3">
                                    <i class="bi bi-file-earmark me-1"></i>Used in ${result.usage_count || 0} files
                                </span>
                            </small>
                        `;
                        break;
                    case 'source':
                        resultLink = `/source/${result.id}`;
                        resultDetails = `
                            <small class="text-muted d-block mb-1">
                                <span class="me-3">
                                    <i class="bi bi-briefcase me-1"></i>${escapeHtml(result.job || 'N/A')}
                                </span>
                                <span class="me-3">
                                    <i class="bi bi-geo-alt me-1"></i>${escapeHtml(result.country || 'N/A')}
                                </span>
                                <span class="me-3">
                                    <i class="bi bi-hash me-1"></i>${result.hash_count || 0} hashes
                                </span>
                            </small>
                        `;
                        break;
                    case 'side':
                        resultLink = `/side/${result.id}`;
                        resultDetails = `
                            <small class="text-muted d-block mb-1">
                                <span class="me-3">
                                    <i class="bi bi-hash me-1"></i>${result.hash_count || 0} hashes
                                </span>
                                <span class="me-3">
                                    <i class="bi bi-calendar me-1"></i>${result.date_creation || 'N/A'}
                                </span>
                            </small>
                        `;
                        break;
                    case 'word':
                        resultLink = `/word/${result.id}`;
                        resultDetails = `
                            <small class="text-muted d-block mb-1">
                                <span class="me-3">
                                    <i class="bi bi-file-earmark me-1"></i>${result.file_count || 0} files
                                </span>
                            </small>
                        `;
                        break;
                    case 'title':
                        resultLink = result.path_id ? `/file/${result.path_id}` : '#';
                        resultDetails = `
                            <small class="text-muted d-block mb-1">
                                ${result.file_name ? `<span class="me-3"><i class="bi bi-file-earmark me-1"></i>${escapeHtml(result.file_name)}</span>` : ''}
                                <span class="badge bg-secondary">${result.status || 'Main'}</span>
                            </small>
                        `;
                        break;
                }
                
                html += `
                    <div class="list-group-item list-group-item-action">
                        <div class="d-flex justify-content-between align-items-start">
                            <div class="flex-grow-1">
                                <h6 class="mb-1">
                                    <i class="bi ${typeInfo.icon} me-2"></i>
                                    <a href="${resultLink}" class="text-decoration-none">
                                        ${escapeHtml(resultName)}
                                    </a>
                                    <span class="badge bg-${typeInfo.color} ms-2">${typeInfo.label}</span>
                                </h6>
                                ${resultDetails}
                                ${result.relevance !== undefined ? `<span class="badge bg-info mt-2">Relevance: ${result.relevance.toFixed(2)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
        });
        
        // If no results by type, show empty message
        if (Object.keys(resultsByType).length === 0) {
            html = `
                <div class="text-center text-muted py-5">
                    <i class="bi bi-search display-4 d-block mb-3"></i>
                    <p>No results found for "${searchState.currentQuery}"</p>
                </div>
            `;
        }
        
        resultsContainer.innerHTML = html;
    }

    /**
     * Update pagination UI
     */
    function updatePagination(pagination) {
        const paginationContainer = document.getElementById('searchPagination');
        if (!paginationContainer || !pagination) return;

        let html = '<nav><ul class="pagination justify-content-center">';

        // Previous button
        if (pagination.has_prev) {
            html += `
                <li class="page-item">
                    <a class="page-link" href="#" onclick="window.enhancedSearch.goToPage(${pagination.page - 1}); return false;">
                        Previous
                    </a>
                </li>
            `;
        }

        // Page numbers
        for (let i = 1; i <= pagination.total_pages; i++) {
            if (i === 1 || i === pagination.total_pages || (i >= pagination.page - 2 && i <= pagination.page + 2)) {
                html += `
                    <li class="page-item ${i === pagination.page ? 'active' : ''}">
                        <a class="page-link" href="#" onclick="window.enhancedSearch.goToPage(${i}); return false;">
                            ${i}
                        </a>
                    </li>
                `;
            } else if (i === pagination.page - 3 || i === pagination.page + 3) {
                html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
            }
        }

        // Next button
        if (pagination.has_next) {
            html += `
                <li class="page-item">
                    <a class="page-link" href="#" onclick="window.enhancedSearch.goToPage(${pagination.page + 1}); return false;">
                        Next
                    </a>
                </li>
            `;
        }

        html += '</ul></nav>';
        paginationContainer.innerHTML = html;
    }

    /**
     * Go to specific page
     */
    function goToPage(page) {
        searchState.currentPage = page;
        performSearch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * Export search results
     */
    async function exportResults(format) {
        if (!searchState.results || searchState.results.length === 0) {
            if (window.showWarning) {
                window.showWarning('No results to export');
            } else {
                alert('No results to export');
            }
            return;
        }

        try {
            const response = await fetch('/api/search/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    results: searchState.results,
                    format: format,
                    filename: `search_results_${new Date().toISOString().split('T')[0]}`
                })
            });

            if (!response.ok) {
                throw new Error('Export failed');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `search_results.${format === 'excel' ? 'xlsx' : format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

        } catch (error) {
            console.error('Export error:', error);
            if (window.showError) {
                window.showError('Error exporting results: ' + error.message);
            } else {
                alert('Error exporting results: ' + error.message);
            }
        }
    }

    /**
     * Preview file
     */
    async function previewFile(fileId) {
        try {
            const response = await fetch(`/api/preview/${fileId}?max_width=1200&max_height=800`);
            const data = await response.json();

            if (data.preview_type === 'error') {
                if (window.showError) {
                    window.showError('Preview error: ' + (data.error || 'Unknown error'));
                } else {
                    alert('Preview error: ' + (data.error || 'Unknown error'));
                }
                return;
            }

            showPreviewModal(data);

        } catch (error) {
            console.error('Preview error:', error);
            if (window.showError) {
                window.showError('Error loading preview: ' + error.message);
            } else {
                alert('Error loading preview: ' + error.message);
            }
        }
    }

    /**
     * Show preview modal
     */
    function showPreviewModal(previewData) {
        // Create or get modal
        let modal = document.getElementById('filePreviewModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'filePreviewModal';
            modal.className = 'modal fade';
            modal.innerHTML = `
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">File Preview</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body" id="previewModalBody"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const body = document.getElementById('previewModalBody');
        let content = '';

        if (previewData.preview_type === 'image') {
            content = `<img src="${previewData.data}" class="img-fluid" alt="Preview">`;
        } else if (previewData.preview_type === 'pdf' || previewData.preview_type === 'document' || previewData.preview_type === 'text') {
            const text = typeof previewData.data === 'string' ? previewData.data : JSON.stringify(previewData.data, null, 2);
            content = `<pre class="bg-light p-3" style="max-height: 500px; overflow-y: auto;">${escapeHtml(text)}</pre>`;
        } else {
            content = `<p class="text-muted">${previewData.message || 'Preview not available'}</p>`;
        }

        body.innerHTML = content;

        // Show modal using Bootstrap
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    }

    /**
     * Load search history
     */
    async function loadSearchHistory() {
        try {
            const response = await fetch('/api/search/history?limit=10');
            const data = await response.json();

            const historyContainer = document.getElementById('searchHistory');
            if (!historyContainer) return;

            if (!data.history || data.history.length === 0) {
                historyContainer.innerHTML = '<p class="text-muted small">No search history</p>';
                return;
            }

            let html = '<ul class="list-group list-group-flush">';
            data.history.forEach(item => {
                html += `
                    <li class="list-group-item">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <a href="#" onclick="window.enhancedSearch.loadHistorySearch('${escapeHtml(item.query)}'); return false;" class="text-decoration-none">
                                    ${escapeHtml(item.query)}
                                </a>
                                <small class="text-muted d-block">${new Date(item.timestamp).toLocaleString()}</small>
                            </div>
                            <span class="badge bg-secondary">${item.result_count} results</span>
                        </div>
                    </li>
                `;
            });
            html += '</ul>';

            historyContainer.innerHTML = html;

        } catch (error) {
            console.error('Error loading search history:', error);
        }
    }

    /**
     * Load saved searches
     */
    async function loadSavedSearches() {
        try {
            const response = await fetch('/api/search/saved');
            const data = await response.json();

            const savedContainer = document.getElementById('savedSearches');
            if (!savedContainer) return;

            if (!data.searches || data.searches.length === 0) {
                savedContainer.innerHTML = '<p class="text-muted small">No saved searches</p>';
                return;
            }

            let html = '<ul class="list-group list-group-flush">';
            data.searches.forEach(search => {
                html += `
                    <li class="list-group-item">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <a href="#" onclick="window.enhancedSearch.loadSavedSearch(${search.id}); return false;" class="text-decoration-none fw-bold">
                                    ${escapeHtml(search.name)}
                                </a>
                                <small class="text-muted d-block">${escapeHtml(search.query)}</small>
                            </div>
                            <div class="btn-group btn-group-sm">
                                // <button class="btn btn-outline-danger btn-sm" onclick="window.enhancedSearch.deleteSavedSearch(${search.id})">
                                //     <i class="bi bi-trash"></i>
                                // </button>
                            </div>
                        </div>
                    </li>
                `;
            });
            html += '</ul>';

            savedContainer.innerHTML = html;

        } catch (error) {
            console.error('Error loading saved searches:', error);
        }
    }

    /**
     * Load history search
     */
    function loadHistorySearch(query) {
        document.getElementById('searchQuery').value = query;
        searchState.currentPage = 1;
        performSearch();
    }

    /**
     * Load saved search
     */
    async function loadSavedSearch(searchId) {
        try {
            const response = await fetch(`/api/search/saved/${searchId}`);
            const data = await response.json();

            if (data.search) {
                document.getElementById('searchQuery').value = data.search.query;
                if (data.search.filters) {
                    Object.entries(data.search.filters).forEach(([key, value]) => {
                        const input = document.getElementById(`filter${key.charAt(0).toUpperCase() + key.slice(1)}`);
                        if (input) input.value = value;
                    });
                }
                searchState.currentPage = 1;
                performSearch();
            }

        } catch (error) {
            console.error('Error loading saved search:', error);
            if (window.showError) {
                window.showError('Error loading saved search: ' + error.message);
            } else {
                alert('Error loading saved search: ' + error.message);
            }
        }
    }

    /**
     * Delete saved search
     */
    async function deleteSavedSearch(searchId) {
        if (!confirm('Delete this saved search?')) return;

        try {
            const response = await fetch(`/api/search/saved/${searchId}`, {
                method: 'DELETE',
                headers: {
                    'X-CSRFToken': getCSRFToken()
                }
            });

            if (response.ok) {
                loadSavedSearches();
            } else {
                throw new Error('Delete failed');
            }

        } catch (error) {
            console.error('Error deleting saved search:', error);
            if (window.showError) {
                window.showError('Error deleting saved search: ' + error.message);
            } else {
                alert('Error deleting saved search: ' + error.message);
            }
        }
    }

    /**
     * Show save search modal
     */
    function showSaveSearchModal() {
        const query = document.getElementById('searchQuery')?.value.trim();
        if (!query) {
            if (window.showWarning) {
                window.showWarning('Please enter a search query first');
            } else {
                alert('Please enter a search query first');
            }
            return;
        }

        const name = prompt('Enter a name for this search:', query);
        if (!name) return;

        saveSearch(name, query);
    }

    /**
     * Save search
     */
    async function saveSearch(name, query) {
        try {
            const response = await fetch('/api/search/saved', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken()
                },
                body: JSON.stringify({
                    name: name,
                    query: query,
                    filters: searchState.currentFilters
                })
            });

            if (response.ok) {
                loadSavedSearches();
                if (window.showSuccess) {
                    window.showSuccess('Search saved successfully');
                } else {
                    alert('Search saved successfully');
                }
            } else {
                throw new Error('Save failed');
            }

        } catch (error) {
            console.error('Error saving search:', error);
            if (window.showError) {
                window.showError('Error saving search: ' + error.message);
            } else {
                alert('Error saving search: ' + error.message);
            }
        }
    }

    /**
     * Clear results
     */
    function clearResults() {
        const resultsContainer = document.getElementById('searchResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = '';
        }
        const paginationContainer = document.getElementById('searchPagination');
        if (paginationContainer) {
            paginationContainer.innerHTML = '';
        }
    }

    /**
     * Show loading indicator
     */
    function showLoading() {
        const resultsContainer = document.getElementById('searchResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div></div>';
        }
    }

    /**
     * Hide loading indicator
     */
    function hideLoading() {
        // Loading is replaced by results
    }

    /**
     * Show error message
     */
    function showError(message) {
        const resultsContainer = document.getElementById('searchResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = `<div class="alert alert-danger">${escapeHtml(message)}</div>`;
        }
    }

    /**
     * Get CSRF token
     */
    function getCSRFToken() {
        const token = document.querySelector('meta[name="csrf-token"]');
        return token ? token.getAttribute('content') : '';
    }

    /**
     * Escape HTML
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Expose API
    window.enhancedSearch = {
        performSearch,
        goToPage,
        exportResults,
        previewFile,
        loadHistorySearch,
        loadSavedSearch,
        deleteSavedSearch,
        saveSearch,
        showSaveSearchModal
    };

})();

