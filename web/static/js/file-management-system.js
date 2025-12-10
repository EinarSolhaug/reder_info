    // ==================== Navigation State Management ====================
    const navigationState = {
        history: [],
        currentIndex: -1,
        currentView: 'grid',
        searchQuery: '',
        sortBy: 'file_count_desc', // Default sort: file count descending
        activeFilters: {}, //  NEW: Store active filters (category, source, side, dates)
        filePagination: {
            currentPage: 1,
            perPage: 50,
            total: 0,
            totalPages: 0,
            totalSize: 0,
            has_prev: false,
            has_next: false
        },
        sectionPagination: {
            currentPage: 1,
            perPage: 50,
            total: 0,
            totalPages: 0,
            has_prev: false,
            has_next: false
        },
        currentFileSection: null,
        currentFileItemId: null,
        currentSection: null
    };

    // Translation strings for JavaScript - loaded from window.appData
    const translations = window.appData?.translations || {
        pageNavigation: 'Page Navigation',
        previousPage: 'Previous Page',
        previous: 'Previous',
        goToPage: 'Go to page',
        home: 'Home',
        items: 'items',
        loading: 'Loading...',
        loadingFiles: 'Loading files...',
        noItemsFound: 'No items found in this section',
        errorLoadingFiles: 'Error loading files',
        files: 'Files',
        searchFiles: 'Search files...',
        searchDisplayedFiles: 'Search displayed files',
        selectAllFiles: 'Select All Files',
        selectAll: 'Select All',
        deselectAllFiles: 'Deselect All Files',
        deselectAll: 'Deselect All',
        exportSelectedFiles: 'Export Selected Files',
        exportSelected: 'Export Selected',
        selected: 'selected',
        noFilesFound: 'No files found',
        showing: 'Showing',
        of: 'of',
        next: 'Next',
        nextPage: 'Next Page',
        currentPage: 'Current page',
        category: 'Category',
        keywords: 'Keywords',
        titles: 'Titles',
        sources: 'Sources',
        sides: 'Sides',
        hash: 'Hash',
        invalidNavigation: 'Invalid navigation parameters',
        fileCount: 'File Count',
        topCategories: 'Top Categories by File Count',
        topSources: 'Top Sources Distribution',
        dataDistribution: 'Data Distribution',
        categories: 'Categories',
        keywords: 'Keywords',
        sources: 'Sources',
        sides: 'Sides',
        hashes: 'Hashes',
        selectFile: 'Select file',
        viewDetails: 'View Details',
        viewDetailsFor: 'View Details for',
        openFullView: 'Open Full View in New Tab',
        openFullViewFor: 'Open Full View in New Tab for',
        fullView: 'Full View',
        exportFile: 'Export File',
        export: 'Export',
        errorLoadingItems: 'Error loading items'
    };
    
    // ✅ FIXED: Expose translations on window so other scripts can extend it
    window.translations = translations;

    // ✅ CURSOR PAGINATION: Section data cache is now optional
    // Used only for filters and initial display, not for pagination
    // All section views now use cursor-based pagination APIs
    const sectionDataCache = window.appData?.data || {
        category: [],
        keywords: [],
        titles: [],
        sources: [],
        sides: [],
        hash: []
    };
    
    // ✅ CURSOR PAGINATION: Check if cursor pagination is enabled
    const cursorPaginationEnabled = window.appData?.cursorPaginationEnabled === true;

    // File navigation state for modal
    const fileNavigationState = {
        currentFiles: [],
        currentIndex: -1,
        currentPage: 1,
        totalPages: 1
    };

    // Modal configuration - set to false to disable modal and use direct navigation
    const MODAL_ENABLED = true; // Change to false to disable modal pop-up

    // Section labels - loaded from window.appData
    const sectionLabels = window.appData?.sectionLabels || {
        category: translations.category || 'Category',
        keywords: translations.keywords || 'Keywords',
        titles: translations.titles || 'Titles',
        sources: translations.sources || 'Sources',
        sides: translations.sides || 'Sides',
        hash: translations.hash || 'Hash'
    };

    // Initialize navigation
    function initNavigation() {
        console.log('Initializing navigation...');
        // Wait a bit to ensure DOM is fully ready
        setTimeout(() => {
            navigateToRoot();
        }, 100);
    }

    // Navigate to root (home)
    function navigateToRoot() {
        const state = { type: 'root', section: null, itemId: null, itemName: null };
        addToHistory(state);
        updateBreadcrumb([{ name: translations.home || 'Home', state: state }]);
        loadRootView();
        updateNavButtons();
        updateSidebarActiveState(null); // Clear active state when at root
    }

    // Handle sort change
    function handleSortChange() {
        const sortSelect = document.getElementById('sortBy');
        if (!sortSelect) return;
        
        const newSort = sortSelect.value;
        if (navigationState.sortBy !== newSort) {
            navigationState.sortBy = newSort;
            
            // Reset to page 1 when sort changes and clear cursor state
            navigationState.sectionPagination.currentPage = 1;
            Object.keys(sectionCursorState).forEach(section => {
                const state = sectionCursorState[section];
                if (state) {
                    state.pageToCursor.clear();
                    state.cursorToPage.clear();
                    state.pageToCursor.set(1, null);
                    state.cursorToPage.set(null, 1);
                }
            });
            
            // Reload current section with new sort
            if (navigationState.currentSection) {
                loadSectionView(navigationState.currentSection, 1);
            } else {
                // If at root, reload root view
                loadRootView();
            }
        }
    }
    
    // Expose handleSortChange globally for HTML onclick
    window.handleSortChange = handleSortChange;

    // Navigate to a section
    function navigateToSection(section) {
        console.log('Navigating to section:', section);
        
        if (!section) {
            console.error('Section parameter is missing');
            return;
        }
        
        // Reset pagination when navigating to a new section
        navigationState.sectionPagination.currentPage = 1;
        
        const state = { type: 'section', section: section, itemId: null, itemName: null };
        addToHistory(state);
        updateBreadcrumb([
            { name: translations.home || 'Home', state: { type: 'root' } },
            { name: sectionLabels[section] || section, state: state }
        ]);
        loadSectionView(section, 1);
        updateNavButtons();
        updateSidebarActiveState(section);
    }
    
    // Update sidebar active state
    function updateSidebarActiveState(activeSection) {
        const sidebarItems = document.querySelectorAll('.sidebar-item');
        sidebarItems.forEach(item => {
            const section = item.getAttribute('data-section');
            if (section === activeSection) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }
    
    // Add keyboard navigation support for sidebar items
    function setupSidebarKeyboardNavigation() {
        // Use event delegation for dynamically added items
        const sidebar = document.getElementById('fileManagerSidebar');
        if (sidebar) {
            sidebar.addEventListener('keydown', function(e) {
                if (e.target.classList.contains('sidebar-item') && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    const section = e.target.getAttribute('data-section');
                    if (section) {
                        navigateToSection(section);
                    }
                }
            });
        }
    }
    
    // Setup keyboard navigation when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupSidebarKeyboardNavigation);
    } else {
        setupSidebarKeyboardNavigation();
    }
    
    // Expose navigateToSection globally for HTML onclick
    window.navigateToSection = navigateToSection;

    // Navigate to an item (shows files
    function navigateToItem(section, itemId, itemName) {
        console.log('Navigating to item:', { section, itemId, itemName });
        
        // ✅ FIX: Enhanced validation - check for valid section and numeric itemId
        if (!section) {
            console.error('Invalid navigation parameters: missing section', { section, itemId });
            if (window.showError) {
                window.showError(translations.invalidNavigation || 'Invalid navigation parameters');
            } else if (window.alert) {
                window.alert(translations.invalidNavigation || 'Invalid navigation parameters');
            }
            return;
        }
        
        // ✅ FIX: Validate itemId is a valid number (not NaN, not null, not undefined)
        if (itemId === null || itemId === undefined || isNaN(itemId) || itemId <= 0) {
            console.error('Invalid navigation parameters: invalid itemId', { section, itemId, itemIdType: typeof itemId });
            // Don't show alert for grouped items - they're handled gracefully
            if (itemId !== null && itemId !== undefined) {
                if (window.showError) {
                    window.showError(translations.invalidNavigation || 'Invalid navigation parameters');
                } else if (window.alert) {
                    window.alert(translations.invalidNavigation || 'Invalid navigation parameters');
                }
            }
            return;
        }
        
        const state = { type: 'item', section: section, itemId: itemId, itemName: itemName };
        addToHistory(state);
        const sectionState = { type: 'section', section: section };
        updateBreadcrumb([
            { name: translations.home || 'Home', state: { type: 'root' } },
            { name: sectionLabels[section] || section, state: sectionState },
            { name: itemName || 'Item', state: state }
        ]);
        loadItemView(section, itemId, itemName);
        updateNavButtons();
    }

    // History management
    function addToHistory(state) {
        // Remove any future history if we're not at the end
        if (navigationState.currentIndex < navigationState.history.length - 1) {
            navigationState.history = navigationState.history.slice(0, navigationState.currentIndex + 1);
        }
        navigationState.history.push(JSON.parse(JSON.stringify(state)));
        navigationState.currentIndex = navigationState.history.length - 1;
    }

    function navigateBack() {
        if (navigationState.currentIndex > 0) {
            navigationState.currentIndex--;
            const state = navigationState.history[navigationState.currentIndex];
            restoreState(state);
            updateNavButtons();
        }
    }

    function navigateForward() {
        if (navigationState.currentIndex < navigationState.history.length - 1) {
            navigationState.currentIndex++;
            const state = navigationState.history[navigationState.currentIndex];
            restoreState(state);
            updateNavButtons();
        }
    }

    function restoreState(state) {
        if (state.type === 'root') {
            navigateToRoot();
        } else if (state.type === 'section') {
            const page = state.page || 1;
            navigationState.sectionPagination.currentPage = page;
            loadSectionView(state.section, page);
        } else if (state.type === 'item') {
            navigateToItem(state.section, state.itemId, state.itemName);
        } else if (state.type === 'file') {
            showFileDetails(state.fileId, state.fileName);
        }
    }

    function updateNavButtons() {
        const backBtn = document.getElementById('navBackBtn');
        const forwardBtn = document.getElementById('navForwardBtn');
        
        if (backBtn) {
            backBtn.disabled = navigationState.currentIndex <= 0;
        }
        if (forwardBtn) {
            forwardBtn.disabled = navigationState.currentIndex >= navigationState.history.length - 1;
        }
    }

    // Breadcrumb management
    function updateBreadcrumb(path) {
        const breadcrumbNav = document.getElementById('breadcrumbNav');
        if (!breadcrumbNav) return;

        breadcrumbNav.innerHTML = '';
        path.forEach((item, index) => {
            const breadcrumbItem = document.createElement('div');
            breadcrumbItem.className = 'breadcrumb-item';
            
            if (index < path.length - 1) {
                const link = document.createElement('span');
                link.className = 'breadcrumb-link';
                link.textContent = item.name;
                link.onclick = () => restoreState(item.state);
                breadcrumbItem.appendChild(link);
                
                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.textContent = '›';
                breadcrumbItem.appendChild(separator);
            } else {
                const current = document.createElement('span');
                current.className = 'breadcrumb-current';
                current.textContent = item.name;
                breadcrumbItem.appendChild(current);
            }
            
            breadcrumbNav.appendChild(breadcrumbItem);
        });
    }

    // Load views
    function loadRootView() {
        console.log('Loading root view');
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) {
            console.error('unifiedContentView element not found!');
            return;
        }

        // Hide navigation item count for root view
        updateNavItemCount(0, 0, 0);

        // Ensure data cache is available
        // ✅ FIX: Use actual database totals from stats, not array lengths
        const categoryCount = window.appData?.stats?.totalCategories || (sectionDataCache.category || []).length;
        const keywordsCount = window.appData?.stats?.totalKeywords || (sectionDataCache.keywords || []).length;
        const titlesCount = window.appData?.stats?.totalTitles || (sectionDataCache.titles || []).length;
        const sourcesCount = window.appData?.stats?.totalSources || (sectionDataCache.sources || []).length;
        const sidesCount = window.appData?.stats?.totalSides || (sectionDataCache.sides || []).length;
        const hashCount = window.appData?.stats?.totalHashes || (sectionDataCache.hash || []).length;

        console.log('Root view counts:', {
            category: categoryCount,
            keywords: keywordsCount,
            titles: titlesCount,
            sources: sourcesCount,
            sides: sidesCount,
            hash: hashCount
        });

        contentView.innerHTML = `
            <div class="explorer-grid" id="contentGrid">
                <div class="explorer-item" data-section="category" style="cursor: pointer;" role="button" tabindex="0" title="${sectionLabels.category || 'Category'}" aria-label="${sectionLabels.category || 'Category'}: ${categoryCount} ${translations.items || 'items'}">
                    <div class="explorer-item-icon"><i class="bi bi-folder" aria-hidden="true"></i></div>
                    <div class="explorer-item-name">${sectionLabels.category || 'Category'}</div>
                    <div class="explorer-item-details">${categoryCount} ${translations.items || 'items'}</div>
                </div>
                <div class="explorer-item" data-section="keywords" style="cursor: pointer;" role="button" tabindex="0" title="${sectionLabels.keywords || 'Keywords'}" aria-label="${sectionLabels.keywords || 'Keywords'}: ${keywordsCount} ${translations.items || 'items'}">
                    <div class="explorer-item-icon"><i class="bi bi-tags" aria-hidden="true"></i></div>
                    <div class="explorer-item-name">${sectionLabels.keywords || 'Keywords'}</div>
                    <div class="explorer-item-details">${keywordsCount} ${translations.items || 'items'}</div>
                </div>
                <div class="explorer-item" data-section="titles" style="cursor: pointer;" role="button" tabindex="0" title="${sectionLabels.titles || 'Titles'}" aria-label="${sectionLabels.titles || 'Titles'}: ${titlesCount} ${translations.items || 'items'}">
                    <div class="explorer-item-icon"><i class="bi bi-file-text" aria-hidden="true"></i></div>
                    <div class="explorer-item-name">${sectionLabels.titles || 'Titles'}</div>
                    <div class="explorer-item-details">${titlesCount} ${translations.items || 'items'}</div>
                </div>
                <div class="explorer-item" data-section="sources" style="cursor: pointer;" role="button" tabindex="0" title="${sectionLabels.sources || 'Sources'}" aria-label="${sectionLabels.sources || 'Sources'}: ${sourcesCount} ${translations.items || 'items'}">
                    <div class="explorer-item-icon"><i class="bi bi-people" aria-hidden="true"></i></div>
                    <div class="explorer-item-name">${sectionLabels.sources || 'Sources'}</div>
                    <div class="explorer-item-details">${sourcesCount} ${translations.items || 'items'}</div>
                </div>
                <div class="explorer-item" data-section="sides" style="cursor: pointer;" role="button" tabindex="0" title="${sectionLabels.sides || 'Sides'}" aria-label="${sectionLabels.sides || 'Sides'}: ${sidesCount} ${translations.items || 'items'}">
                    <div class="explorer-item-icon"><i class="bi bi-diagram-3" aria-hidden="true"></i></div>
                    <div class="explorer-item-name">${sectionLabels.sides || 'Sides'}</div>
                    <div class="explorer-item-details">${sidesCount} ${translations.items || 'items'}</div>
                </div>
                <div class="explorer-item" data-section="hash" style="cursor: pointer;" role="button" tabindex="0" title="${sectionLabels.hash || 'Hash'}" aria-label="${sectionLabels.hash || 'Hash'}: ${hashCount} ${translations.items || 'items'}">
                    <div class="explorer-item-icon"><i class="bi bi-hash" aria-hidden="true"></i></div>
                    <div class="explorer-item-name">${sectionLabels.hash || 'Hash'}</div>
                    <div class="explorer-item-details">${hashCount} ${translations.items || 'items'}</div>
                </div>
            </div>
        `;
        applyViewMode();
    }

    // ✅ NEW: Cursor pagination state for sections
    // Track cursors for each page to enable direct navigation
    const sectionCursorState = {
        category: { 
            pageToCursor: new Map(), // Map page number to cursor
            cursorToPage: new Map(), // Map cursor to page number
            currentPage: 1,
            total: 0
        },
        keywords: { 
            pageToCursor: new Map(),
            cursorToPage: new Map(),
            currentPage: 1,
            total: 0
        },
        titles: { 
            pageToCursor: new Map(),
            cursorToPage: new Map(),
            currentPage: 1,
            total: 0
        },
        sources: { 
            pageToCursor: new Map(),
            cursorToPage: new Map(),
            currentPage: 1,
            total: 0
        },
        sides: { 
            pageToCursor: new Map(),
            cursorToPage: new Map(),
            currentPage: 1,
            total: 0
        },
        hash: { 
            pageToCursor: new Map(),
            cursorToPage: new Map(),
            currentPage: 1,
            total: 0
        }
    };

    // ✅ NEW: Toggle similar titles display
    function toggleSimilarTitles(element, groupId) {
        const listElement = document.getElementById(`similar-titles-${groupId}`);
        if (listElement) {
            const isVisible = listElement.style.display !== 'none';
            listElement.style.display = isVisible ? 'none' : 'block';
            const icon = element.querySelector('i');
            if (icon) {
                icon.className = isVisible ? 'bi bi-arrow-down-circle' : 'bi bi-arrow-up-circle';
            }
        }
    }
    
    function loadSectionView(section, page = 1) {
        console.log('Loading section view:', section, 'page:', page);
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) {
            console.error('unifiedContentView element not found!');
            return;
        }

        // Store current section
        navigationState.currentSection = section;
        navigationState.sectionPagination.currentPage = page;

        // Show loading
        contentView.innerHTML = `<div class="content-loading"><i class="bi bi-arrow-repeat"></i><div>${translations.loading || 'Loading...'}</div></div>`;

        // ✅ NEW: Use cursor-based pagination API instead of cache
        const perPage = navigationState.sectionPagination.perPage;
        const search = navigationState.searchQuery || '';
        
        // Map section names to API endpoints
        const sectionApiMap = {
            'category': '/api/archives/categories',
            'keywords': '/api/archives/keywords',
            'titles': '/api/archives/titles',
            'sources': '/api/archives/sources',
            'sides': '/api/archives/sides',
            'hash': '/api/archives/hashs'
        };
        
        const apiUrl = sectionApiMap[section];
        if (!apiUrl) {
            console.error(`Unknown section: ${section}`);
            contentView.innerHTML = `<div class="empty-state">${translations.errorLoadingItems || 'Error loading items'}</div>`;
            return;
        }
        
        // Build URL with cursor pagination
        const urlParams = new URLSearchParams();
        urlParams.set('limit', perPage);
        if (search) {
            urlParams.set('search', search);
        }
        
        // ✅ NEW: Add sort parameters
        const sortBy = navigationState.sortBy || 'file_count_desc';
        const sortParts = sortBy.split('_');
        const sortField = sortParts.slice(0, -1).join('_');
        const sortDir = sortParts[sortParts.length - 1];
        
        // For file_count sorting, we'll do client-side sorting after fetching
        // For other sorts, pass to API if supported
        if (sortField !== 'file_count') {
            urlParams.set('sort_by', sortField);
            urlParams.set('sort_dir', sortDir);
        }
        
        // ✅ NEW: Enable similarity grouping for titles section
        if (section === 'titles') {
            urlParams.set('group_similar', 'true');
            urlParams.set('similarity_threshold', '0.8'); // 80% similarity threshold
        }
        
        // ✅ NEW: Get cursor for the requested page
        // Page 1 always uses null cursor
        let cursor = null;
        const state = sectionCursorState[section];
        
        if (page === 1) {
            // First page - reset state
            if (state) {
                state.pageToCursor.clear();
                state.cursorToPage.clear();
                state.pageToCursor.set(1, null);
                state.cursorToPage.set(null, 1);
                state.currentPage = 1;
            }
            cursor = null;
        } else if (state && state.pageToCursor.has(page)) {
            // We have the cursor for this page - use it directly
            cursor = state.pageToCursor.get(page);
            console.log(`Using stored cursor for page ${page}: ${cursor}`);
        } else {
            // Don't have cursor for this page - need to load sequentially
            // For now, start from page 1 and load pages until we reach the target
            console.log(`No cursor stored for page ${page}, loading sequentially from page 1`);
            loadSectionPageSequentially(section, page, apiUrl, urlParams, perPage, search);
            return; // Exit early, sequential loading will handle rendering
        }
        
        if (cursor !== null) {
            urlParams.set('cursor', cursor);
        }
        
        // Fetch data from API
        fetch(`${apiUrl}?${urlParams.toString()}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data.success) {
                    throw new Error(data.error || 'Unknown error');
                }
                
                let items = data.data || [];
                console.log(`Loaded ${items.length} items for section ${section} from API`);
                
                // ✅ NEW: Handle grouped titles (similarity groups)
                if (data.grouped && section === 'titles') {
                    // For grouped titles, show groups with expandable similar titles
                    items = items.map(item => {
                        if (item.is_group) {
                            // Add group indicator to name
                            item.name_display = `${item.name_display} (${item.group_count} ${item.is_identical ? 'identical' : 'similar'})`;
                        }
                        return item;
                    });
                }
                
                // ✅ NEW: Apply client-side sorting for file_count or other computed fields
                const sortBy = navigationState.sortBy || 'file_count_desc';
                const sortParts = sortBy.split('_');
                const sortField = sortParts.slice(0, -1).join('_');
                const sortDir = sortParts[sortParts.length - 1];
                
                if (sortField === 'file_count') {
                    items.sort((a, b) => {
                        const aCount = a.file_count || 0;
                        const bCount = b.file_count || 0;
                        if (sortDir === 'desc') {
                            return bCount - aCount;
                        } else {
                            return aCount - bCount;
                        }
                    });
                } else if (sortField === 'name') {
                    items.sort((a, b) => {
                        const aName = (a.name || a.name_display || '').toLowerCase();
                        const bName = (b.name || b.name_display || '').toLowerCase();
                        if (sortDir === 'desc') {
                            return bName.localeCompare(aName);
                        } else {
                            return aName.localeCompare(bName);
                        }
                    });
                } else if (sortField === 'id') {
                    items.sort((a, b) => {
                        const aId = a.id || 0;
                        const bId = b.id || 0;
                        if (sortDir === 'desc') {
                            return bId - aId;
                        } else {
                            return aId - bId;
                        }
                    });
                }
                
                // ✅ NEW: Update cursor state with page tracking
                if (state) {
                    state.total = data.total_estimated || 0;
                    state.currentPage = page;
                    
                    // Store cursor for current page
                    state.pageToCursor.set(page, cursor);
                    state.cursorToPage.set(cursor, page);
                    
                    // Store next page cursor if available
                    if (data.next_cursor !== null && data.next_cursor !== undefined) {
                        const nextPage = page + 1;
                        state.pageToCursor.set(nextPage, data.next_cursor);
                        state.cursorToPage.set(data.next_cursor, nextPage);
                    }
                    
                    // Store prev page cursor if available
                    if (data.prev_cursor !== null && data.prev_cursor !== undefined) {
                        const prevPage = Math.max(1, page - 1);
                        state.pageToCursor.set(prevPage, data.prev_cursor);
                        state.cursorToPage.set(data.prev_cursor, prevPage);
                    }
                }
                
                if (items.length === 0) {
                    contentView.innerHTML = `<div class="empty-state">${translations.noItemsFound || 'No items found in this section'}</div>`;
                    updateNavItemCount(0, 0, 0);
                    return;
                }
                
                // Calculate pagination info
                const total = data.total_estimated || items.length;
                const totalPages = Math.ceil(total / perPage);
                const startIndex = (page - 1) * perPage + 1;
                const endIndex = Math.min(startIndex + items.length - 1, total);
                
                // Update pagination state
                navigationState.sectionPagination = {
                    currentPage: page,
                    perPage: perPage,
                    total: total,
                    totalPages: totalPages,
                    has_prev: data.has_prev || false,
                    has_next: data.has_next || false
                };
                
                // Update navigation bar item count
                updateNavItemCount(startIndex, endIndex, total);
                
                // Render items with pagination controls
                setTimeout(() => {
                    let html = '';
                    if (navigationState.currentView === 'grid') {
                        html = renderGridView(items, section, false); // Don't add pagination yet
                    } else {
                        html = renderListView(items, section, false); // Don't add pagination yet
                    }
                    
                    // Add pagination controls
                    html += renderSectionPaginationControls(section);
                    
                    contentView.innerHTML = html;
                    
                    // Note: Chart buttons will be attached automatically by the MutationObserver
                    // in chart-export.js, so no manual attachment needed here
                }, 10);
            })
            .catch(error => {
                console.error(`Error loading section ${section}:`, error);
                contentView.innerHTML = `<div class="empty-state">${translations.errorLoadingItems || 'Error loading items'}: ${error.message}</div>`;
                updateNavItemCount(0, 0, 0);
            });
    }
    
    // ✅ NEW: Load section page sequentially (for pages without stored cursors)
    async function loadSectionPageSequentially(section, targetPage, apiUrl, baseParams, perPage, search) {
        const state = sectionCursorState[section];
        if (!state) {
            console.error(`No state found for section: ${section}`);
            return;
        }
        
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) {
            console.error('unifiedContentView not found');
            return;
        }
        
        console.log(`Sequentially loading section ${section} from page 1 to page ${targetPage}`);
        
        try {
            let currentPage = 1;
            let currentCursor = null;
            
            // Load pages one by one until we reach the target
            while (currentPage < targetPage) {
                const urlParams = new URLSearchParams(baseParams);
                if (currentCursor !== null) {
                    urlParams.set('cursor', currentCursor);
                }
                
                const response = await fetch(`${apiUrl}?${urlParams.toString()}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                if (!data.success) {
                    throw new Error(data.error || 'Unknown error');
                }
                
                // Store cursor for this page
                state.pageToCursor.set(currentPage, currentCursor);
                state.cursorToPage.set(currentCursor, currentPage);
                
                // Get cursor for next page
                currentCursor = data.next_cursor;
                if (!currentCursor) {
                    throw new Error(`Cannot navigate to page ${targetPage}: reached end of data at page ${currentPage}`);
                }
                
                currentPage++;
            }
            
            // Now load the target page
            const urlParams = new URLSearchParams(baseParams);
            if (currentCursor !== null) {
                urlParams.set('cursor', currentCursor);
            }
            
            // Store cursor for target page
            state.pageToCursor.set(targetPage, currentCursor);
            state.cursorToPage.set(currentCursor, targetPage);
            
            // Load target page
            const response = await fetch(`${apiUrl}?${urlParams.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Unknown error');
            }
            
            const items = data.data || [];
            
            if (items.length === 0) {
                contentView.innerHTML = `<div class="empty-state">${translations.noItemsFound || 'No items found in this section'}</div>`;
                updateNavItemCount(0, 0, 0);
                return;
            }
            
            // Update state
            state.total = data.total_estimated || 0;
            state.currentPage = targetPage;
            
            // Store next/prev cursors
            if (data.next_cursor !== null && data.next_cursor !== undefined) {
                state.pageToCursor.set(targetPage + 1, data.next_cursor);
                state.cursorToPage.set(data.next_cursor, targetPage + 1);
            }
            if (data.prev_cursor !== null && data.prev_cursor !== undefined) {
                const prevPage = Math.max(1, targetPage - 1);
                state.pageToCursor.set(prevPage, data.prev_cursor);
                state.cursorToPage.set(data.prev_cursor, prevPage);
            }
            
            // Calculate pagination info
            const total = data.total_estimated || items.length;
            const totalPages = Math.ceil(total / perPage);
            const startIndex = (targetPage - 1) * perPage + 1;
            const endIndex = Math.min(startIndex + items.length - 1, total);
            
            // Update pagination state
            navigationState.sectionPagination = {
                currentPage: targetPage,
                perPage: perPage,
                total: total,
                totalPages: totalPages,
                has_prev: data.has_prev || false,
                has_next: data.has_next || false
            };
            
            // Update navigation bar item count
            updateNavItemCount(startIndex, endIndex, total);
            
            // Render items
            let html = '';
            if (navigationState.currentView === 'grid') {
                html = renderGridView(items, section, false);
            } else {
                html = renderListView(items, section, false);
            }
            
            // Add pagination controls
            html += renderSectionPaginationControls(section);
            
            contentView.innerHTML = html;
            
            // Note: Chart buttons will be attached automatically by the MutationObserver
            // in chart-export.js, so no manual attachment needed here
            
        } catch (error) {
            console.error(`Error in sequential loading for section ${section}:`, error);
            contentView.innerHTML = `<div class="empty-state">${translations.errorLoadingItems || 'Error loading items'}: ${error.message}</div>`;
            updateNavItemCount(0, 0, 0);
        }
    }

    // Load files for grouped titles (multiple title IDs)
    function loadGroupedTitleFiles(titleIdsString, groupName) {
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) return;
        
        // Parse title IDs from comma-separated string
        const titleIds = titleIdsString.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id) && id > 0);
        
        if (titleIds.length === 0) {
            contentView.innerHTML = `<div class="empty-state">${translations.errorLoadingFiles || 'Error loading files'}: No valid title IDs</div>`;
            return;
        }
        
        // Show loading
        contentView.innerHTML = `<div class="content-loading"><i class="bi bi-arrow-repeat"></i><div>${translations.loadingFiles || 'Loading files...'}</div></div>`;
        
        // Store navigation state
        navigationState.currentFileSection = 'titles';
        navigationState.currentFileItemId = titleIds.join(',');
        navigationState.filePagination.currentPage = 1;
        
        // Fetch files for all titles in parallel
        const filePromises = titleIds.map(titleId => 
            fetch(`/api/archives/files?section=titles&id=${titleId}&page=1&limit=1000`)
                .then(response => response.json())
                .then(data => data.success ? (data.files || []) : [])
                .catch(error => {
                    console.error(`Error loading files for title ${titleId}:`, error);
                    return [];
                })
        );
        
        Promise.all(filePromises)
            .then(allFilesArrays => {
                // Combine and deduplicate files by file ID
                const filesMap = new Map();
                allFilesArrays.forEach(files => {
                    files.forEach(file => {
                        if (!filesMap.has(file.id)) {
                            filesMap.set(file.id, file);
                        }
                    });
                });
                
                const allFiles = Array.from(filesMap.values());
                
                // Sort by file date (newest first)
                allFiles.sort((a, b) => {
                    const dateA = a.file_date ? new Date(a.file_date) : new Date(0);
                    const dateB = b.file_date ? new Date(b.file_date) : new Date(0);
                    return dateB - dateA;
                });
                
                // Update navigation state
                const state = { type: 'item', section: 'titles', itemId: titleIds.join(','), itemName: groupName };
                addToHistory(state);
                updateBreadcrumb([
                    { name: translations.home || 'Home', state: { type: 'root' } },
                    { name: sectionLabels.titles || 'Titles', state: { type: 'section', section: 'titles' } },
                    { name: groupName || 'Grouped Titles', state: state }
                ]);
                
                // Render files using the same format as loadItemView
                renderFilesView(allFiles, 'titles', groupName, {
                    total: allFiles.length,
                    total_size: allFiles.reduce((sum, f) => sum + (f.size || 0), 0),
                    page: 1,
                    per_page: allFiles.length,
                    total_pages: 1,
                    has_prev: false,
                    has_next: false
                });
                
                updateNavButtons();
            })
            .catch(error => {
                console.error('Error loading grouped title files:', error);
                contentView.innerHTML = `<div class="empty-state">${translations.errorLoadingFiles || 'Error loading files'}: ${error.message}</div>`;
            });
    }
    
    // Helper function to render files view (extracted from loadItemView)
    function renderFilesView(files, section, itemName, pagination) {
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) return;
        
        let html = '';
        
        // Show header with section and item name
        const sectionLabel = sectionLabels[section] || section;
        html += '<div class="section" style="margin-bottom: 1.5rem;">';
        html += '<div class="section-header">';
        html += `<div class="section-label"><i class="bi bi-${getSectionIcon(section)}"></i> ${escapeHtml(sectionLabel)}: ${escapeHtml(itemName || 'Item')}</div>`;
        html += '</div>';
        html += '</div>';
        
        // Update pagination state
        if (pagination) {
            navigationState.filePagination = {
                currentPage: pagination.page,
                perPage: pagination.per_page,
                total: pagination.total,
                totalPages: pagination.total_pages,
                totalSize: pagination.total_size,
                has_prev: pagination.has_prev,
                has_next: pagination.has_next
            };
            
            // Update navigation bar item count
            const startItem = (pagination.page - 1) * pagination.per_page + 1;
            const endItem = Math.min(pagination.page * pagination.per_page, pagination.total);
            updateNavItemCount(startItem, endItem, pagination.total);
        }
        
        // Show files
        if (files && files.length > 0) {
            html += '<div class="section">';
            html += '<div class="section-header">';
            html += `<div class="section-label">${translations.files || 'Files'}</div>`;
            html += '<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">';
            // File search input
            html += '<div style="position: relative; flex: 1; min-width: 200px; max-width: 300px;">';
            html += `<input type="text" id="fileSearchInput" placeholder="${translations.searchFiles || 'Search files...'}" oninput="filterDisplayedFiles(this.value)" style="width: 100%; padding: 0.5rem 2.5rem 0.5rem 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.375rem; font-size: 0.875rem;" title="${translations.searchDisplayedFiles || 'Search displayed files'}" aria-label="${translations.searchDisplayedFiles || 'Search displayed files'}">`;
            html += '<i class="bi bi-search" style="position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%); color: #94a3b8; pointer-events: none;"></i>';
            html += '</div>';
            html += `<button class="action-btn" onclick="selectAllFiles()" style="background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0;" title="${translations.selectAllFiles || 'Select All Files'}" aria-label="${translations.selectAllFiles || 'Select All Files'}">${translations.selectAll || 'Select All'}</button>`;
            html += `<button class="action-btn" onclick="deselectAllFiles()" style="background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0;" title="${translations.deselectAllFiles || 'Deselect All Files'}" aria-label="${translations.deselectAllFiles || 'Deselect All Files'}">${translations.deselectAll || 'Deselect All'}</button>`;
            html += `<button class="action-btn export-btn" onclick="exportSelectedFiles()" style="background: #10b981;" title="${translations.exportSelectedFiles || 'Export Selected Files'}" aria-label="${translations.exportSelectedFiles || 'Export Selected Files'}">${translations.exportSelected || 'Export Selected'}</button>`;
            html += `<span id="selectedCount" style="font-size: 0.875rem; color: #64748b; margin-left: 0.5rem;" aria-live="polite">0 ${translations.selected || 'selected'}</span>`;
            html += '</div>';
            html += '</div>';
            html += '<div class="files-list-view" id="filesListView" style="max-height: 70vh; overflow-y: auto; overflow-x: hidden;">';
            
            // Store files list for navigation
            const filesList = files.map(file => ({
                id: file.id,
                name: file.name
            }));
            
            files.forEach((file, index) => {
                const fileSize = formatFileSize(file.size);
                const fileDate = file.file_date ? new Date(file.file_date).toLocaleDateString() : 'N/A';
                
                const safeFileName = escapeHtml(file.name).replace(/"/g, '&quot;');
                html += `
                    <div class="file-row-item" 
                         data-file-id="${file.id}" 
                         data-file-name="${safeFileName}" 
                         data-file-type="${escapeHtml(file.type)}"
                         data-file-size="${file.size}"
                         data-file-date="${escapeHtml(fileDate)}"
                         data-file-source="${escapeHtml(file.source)}"
                         data-file-index="${index}" 
                         style="cursor: pointer; position: relative;"
                         onclick="event.preventDefault(); event.stopPropagation(); const fileId = ${file.id}; const fileName = '${safeFileName.replace(/'/g, "\\'")}'; const fileIndex = ${index}; const fileRows = document.querySelectorAll('.file-row-item[data-file-id]'); const filesList = Array.from(fileRows).map(row => ({ id: parseInt(row.getAttribute('data-file-id')), name: row.getAttribute('data-file-name') || 'File' })); showFileDetails(fileId, fileName, filesList, fileIndex); return false;">
                        <input type="checkbox" class="file-select-checkbox" value="${file.id}" id="file-checkbox-${file.id}" onchange="updateSelectedFiles()" onclick="event.stopPropagation(); event.stopImmediatePropagation();" style="margin-right: 0.75rem; cursor: pointer; flex-shrink: 0;" aria-label="${translations.selectFile || 'Select file'}: ${escapeHtml(file.name)}" title="${translations.selectFile || 'Select file'}: ${escapeHtml(file.name)}">
                        <div class="file-row-info" style="cursor: pointer; flex: 1;">
                            <div class="file-row-icon"><i class="bi bi-file-earmark" aria-hidden="true"></i></div>
                            <div class="file-row-details" style="flex: 1;">
                                <div class="file-row-name" contenteditable="false" data-editable="true" data-file-id="${file.id}" data-field="name" onblur="saveFileField(this)" ondblclick="enableFileEdit(this)" style="padding: 2px 4px; border-radius: 2px; min-height: 1.2em;">${escapeHtml(file.name)}</div>
                                <div class="file-row-meta">
                                    <span><i class="bi bi-file-earmark" aria-hidden="true"></i> <span contenteditable="false" data-editable="true" data-file-id="${file.id}" data-field="type" onblur="saveFileField(this)" ondblclick="enableFileEdit(this)" style="padding: 2px 4px; border-radius: 2px;">${escapeHtml(file.type)}</span></span>
                                    <span><i class="bi bi-hdd" aria-hidden="true"></i> ${escapeHtml(fileSize)}</span>
                                    <span><i class="bi bi-calendar" aria-hidden="true"></i> <span contenteditable="false" data-editable="true" data-file-id="${file.id}" data-field="date" onblur="saveFileField(this)" ondblclick="enableFileEdit(this)" style="padding: 2px 4px; border-radius: 2px;">${escapeHtml(fileDate)}</span></span>
                                    <span><i class="bi bi-person" aria-hidden="true"></i> <span contenteditable="false" data-editable="true" data-file-id="${file.id}" data-field="source" onblur="saveFileField(this)" ondblclick="enableFileEdit(this)" style="padding: 2px 4px; border-radius: 2px;">${escapeHtml(file.source)}</span></span>
                                </div>
                            </div>
                        </div>
                        <div class="file-row-actions" onclick="event.stopPropagation(); event.stopImmediatePropagation();">
                            <button class="action-btn preview-btn" data-file-id="${file.id}" data-file-name="${safeFileName}" data-file-index="${index}" title="${translations.viewDetails || 'View Details'}" aria-label="${translations.viewDetailsFor || 'View Details for'}: ${escapeHtml(file.name)}" onclick="event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); const fileId = ${file.id}; const fileName = '${safeFileName.replace(/'/g, "\\'")}'; const fileIndex = ${index}; const fileRows = document.querySelectorAll('.file-row-item[data-file-id]'); const filesList = Array.from(fileRows).map(row => ({ id: parseInt(row.getAttribute('data-file-id')), name: row.getAttribute('data-file-name') || 'File' })); showFileDetails(fileId, fileName, filesList, fileIndex); return false;">
                                <i class="bi bi-eye" aria-hidden="true"></i>
                                <span class="sr-only">${translations.viewDetails || 'View Details'}</span>
                            </button>
                            <a href="/file/${file.id}" class="action-btn view-btn" target="_blank" title="${translations.openFullView || 'Open Full View in New Tab'}" aria-label="${translations.openFullViewFor || 'Open Full View in New Tab for'}: ${escapeHtml(file.name)}" onclick="event.stopPropagation(); event.stopImmediatePropagation();">
                                <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
                                <span class="sr-only">${translations.fullView || 'Full View'}</span>
                            </a>
                            <button class="action-btn export-btn" onclick="exportFile(${file.id}); event.stopPropagation(); event.stopImmediatePropagation();" title="${translations.exportFile || 'Export File'}" aria-label="${translations.export || 'Export'}: ${escapeHtml(file.name)}">
                                <i class="bi bi-download" aria-hidden="true"></i>
                                <span class="sr-only">${translations.export || 'Export'}</span>
                            </button>
                        </div>
                    </div>
                `;
            });
            
            // Store files list in navigation state
            fileNavigationState.currentFiles = filesList;
            
            html += '</div>';
            
            // Add pagination controls and statistics
            html += renderPaginationControls();
            
            html += '</div>';
        } else {
            html += `<div class="section"><div class="empty-state">${translations.noFilesFound || 'No files found'}</div></div>`;
        }
        
        contentView.innerHTML = html;
    }

    function loadItemView(section, itemId, itemName, page = 1) {
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) return;

        // Store current file navigation state
        navigationState.currentFileSection = section;
        navigationState.currentFileItemId = itemId;
        navigationState.filePagination.currentPage = page;

        // Show loading
        contentView.innerHTML = `<div class="content-loading"><i class="bi bi-arrow-repeat"></i><div>${translations.loadingFiles || 'Loading files...'}</div></div>`;

        // Load files directly with pagination (skip item details)
        const apiUrl = `/api/archives/files?section=${section}&id=${itemId}&page=${page}&limit=${navigationState.filePagination.perPage}`;
        console.log('Loading files from:', apiUrl);
        
        fetch(apiUrl)
        .then(response => {
            console.log('API Response status:', response.status);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(filesData => {
            console.log('Files data received:', filesData);

            // Check for errors first
            if (!filesData.success) {
                contentView.innerHTML = `<div class="empty-state">${escapeHtml(filesData.error || translations.errorLoadingFiles || 'Error loading files')}</div>`;
                return;
            }

            // Update navigation state
            const state = { type: 'item', section: section, itemId: itemId, itemName: itemName };
            addToHistory(state);
            updateBreadcrumb([
                { name: translations.home || 'Home', state: { type: 'root' } },
                { name: sectionLabels[section] || section, state: { type: 'section', section: section } },
                { name: itemName || 'Item', state: state }
            ]);

            // Render files using the shared renderFilesView function
            renderFilesView(filesData.files || [], section, itemName, filesData.pagination);
            updateNavButtons();
        })
        .catch(error => {
            console.error('Error loading files:', error);
            console.error('Error details:', {
                section: section,
                itemId: itemId,
                itemName: itemName,
                page: page
            });
            contentView.innerHTML = `<div class="empty-state">${translations.errorLoadingFiles || 'Error loading files'}: ${escapeHtml(error.message)}</div>`;
        });
    }

    // Update navigation bar item count display
    function updateNavItemCount(startItem, endItem, total) {
        const navItemCount = document.getElementById('navItemCount');
        const navItemCountText = document.getElementById('navItemCountText');
        
        if (navItemCount && navItemCountText) {
            if (total > 0) {
                navItemCountText.textContent = `${translations.showing || 'Showing'} ${startItem}-${endItem} ${translations.of || 'of'} ${total}`;
                navItemCount.style.display = 'block';
            } else {
                navItemCount.style.display = 'none';
            }
        }
    }

    // Render pagination controls for section views
    function renderSectionPaginationControls(section) {
        const pag = navigationState.sectionPagination;
        const startItem = (pag.currentPage - 1) * pag.perPage + 1;
        const endItem = Math.min(pag.currentPage * pag.perPage, pag.total);
        
        if (pag.totalPages <= 1) {
            return ''; // No pagination needed
        }
        
        let html = '<div class="pagination-container">';
        
        // Statistics on the left
        html += '<div class="pagination-stats">';
        html += `<div class="pagination-stats-item"><i class="bi bi-list-ol" aria-hidden="true"></i> ${translations.showing || 'Showing'} ${startItem}-${endItem} ${translations.of || 'of'} ${pag.total}</div>`;
        html += '</div>';
        
        // Pagination controls on the right
        html += '<div class="pagination-controls">';
        
        // Previous button
        html += `<button class="pagination-btn" onclick="loadSectionPage('${section}', ${pag.currentPage - 1})" ${!pag.has_prev ? 'disabled' : ''} title="${translations.previousPage || 'Previous Page'}" aria-label="${translations.previousPage || 'Previous Page'}">
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
            <span class="sr-only">${translations.previous || 'Previous'}</span>
        </button>`;
        
        // Page numbers
        html += '<div class="pagination-page-numbers" role="group" aria-label="' + translations.pageNavigation + '">';
        const maxPages = pag.totalPages;
        const currentPage = pag.currentPage;
        
        // Show first page
        if (currentPage > 3) {
            html += `<button class="pagination-btn" onclick="loadSectionPage('${section}', 1)" title="${translations.goToPage || 'Go to page'} 1" aria-label="${translations.goToPage || 'Go to page'} 1">1</button>`;
            if (currentPage > 4) {
                html += '<span class="pagination-ellipsis" aria-hidden="true">...</span>';
            }
        }
        
        // Show pages around current
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(maxPages, currentPage + 2);
        
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === currentPage;
            html += `<button class="pagination-btn ${isActive ? 'active' : ''}" onclick="loadSectionPage('${section}', ${i})" title="${translations.goToPage || 'Go to page'} ${i}" aria-label="${isActive ? (translations.currentPage || 'Current page') : (translations.goToPage || 'Go to page')} ${i}" ${isActive ? 'aria-current="page"' : ''}>${i}</button>`;
        }
        
        // Show last page
        if (currentPage < maxPages - 2) {
            if (currentPage < maxPages - 3) {
                html += '<span class="pagination-ellipsis" aria-hidden="true">...</span>';
            }
            html += `<button class="pagination-btn" onclick="loadSectionPage('${section}', ${maxPages})" title="${translations.goToPage || 'Go to page'} ${maxPages}" aria-label="${translations.goToPage || 'Go to page'} ${maxPages}">${maxPages}</button>`;
        }
        
        html += '</div>';
        
        // Next button
        html += `<button class="pagination-btn" onclick="loadSectionPage('${section}', ${pag.currentPage + 1})" ${!pag.has_next ? 'disabled' : ''} title="${translations.nextPage || 'Next Page'}" aria-label="${translations.nextPage || 'Next Page'}">
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
            <span class="sr-only">${translations.next || 'Next'}</span>
        </button>`;
        
        html += '</div>'; // Close pagination-controls
        html += '</div>'; // Close pagination-container
        
        return html;
    }

    // Load a specific page for section view
    function loadSectionPage(section, page) {
        if (page < 1) page = 1;
        const state = { type: 'section', section: section, itemId: null, itemName: null, page: page };
        addToHistory(state);
        loadSectionView(section, page);
        updateNavButtons();
    }

    function renderPaginationControls() {
        const pag = navigationState.filePagination;
        const startItem = (pag.currentPage - 1) * pag.perPage + 1;
        const endItem = Math.min(pag.currentPage * pag.perPage, pag.total);
        
        // Update navigation bar count for files view
        updateNavItemCount(startItem, endItem, pag.total);
        
        let html = '<div class="pagination-container">';
        
        // Statistics on the left
        html += '<div class="pagination-stats">';
        html += `<div class="pagination-stats-item"><i class="bi bi-files" aria-hidden="true"></i> <strong>${pag.total}</strong> ${translations.files || 'files'}</div>`;
        html += `<div class="pagination-stats-item"><i class="bi bi-hdd" aria-hidden="true"></i> <strong>${formatFileSize(pag.totalSize)}</strong></div>`;
        html += `<div class="pagination-stats-item"><i class="bi bi-list-ol" aria-hidden="true"></i> ${translations.showing || 'Showing'} ${startItem}-${endItem} ${translations.of || 'of'} ${pag.total}</div>`;
        html += '</div>';
        
        // Pagination controls on the right
        html += '<div class="pagination-controls">';
        
        // Previous button
        html += `<button class="pagination-btn" onclick="loadFilePage(${pag.currentPage - 1})" ${!pag.has_prev ? 'disabled' : ''} title="${translations.previousPage || 'Previous Page'}" aria-label="${translations.previousPage || 'Previous Page'}">
            <i class="bi bi-chevron-left" aria-hidden="true"></i>
            <span class="sr-only">${translations.previous || 'Previous'}</span>
        </button>`;
        
        // Page numbers
        html += '<div class="pagination-page-numbers" role="group" aria-label="' + translations.pageNavigation + '">';
        const maxPages = pag.totalPages;
        const currentPage = pag.currentPage;
        
        // Show first page
        if (currentPage > 3) {
            html += `<button class="pagination-btn" onclick="loadFilePage(1)" title="${translations.goToPage || 'Go to page'} 1" aria-label="${translations.goToPage || 'Go to page'} 1">1</button>`;
            if (currentPage > 4) {
                html += '<span class="pagination-ellipsis" aria-hidden="true">...</span>';
            }
        }
        
        // Show pages around current
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(maxPages, currentPage + 2);
        
        for (let i = startPage; i <= endPage; i++) {
            const isActive = i === currentPage;
            html += `<button class="pagination-btn ${isActive ? 'active' : ''}" onclick="loadFilePage(${i})" title="${translations.goToPage || 'Go to page'} ${i}" aria-label="${isActive ? (translations.currentPage || 'Current page') : (translations.goToPage || 'Go to page')} ${i}" ${isActive ? 'aria-current="page"' : ''}>${i}</button>`;
        }
        
        // Show last page
        if (currentPage < maxPages - 2) {
            if (currentPage < maxPages - 3) {
                html += '<span class="pagination-ellipsis" aria-hidden="true">...</span>';
            }
            html += `<button class="pagination-btn" onclick="loadFilePage(${maxPages})" title="${translations.goToPage || 'Go to page'} ${maxPages}" aria-label="${translations.goToPage || 'Go to page'} ${maxPages}">${maxPages}</button>`;
        }
        
        html += '</div>';
        
        // Next button
        html += `<button class="pagination-btn" onclick="loadFilePage(${pag.currentPage + 1})" ${!pag.has_next ? 'disabled' : ''} title="${translations.nextPage || 'Next Page'}" aria-label="${translations.nextPage || 'Next Page'}">
            <i class="bi bi-chevron-right" aria-hidden="true"></i>
            <span class="sr-only">${translations.next || 'Next'}</span>
        </button>`;
        
        html += '</div>';
        html += '</div>';
        
        return html;
    }

    function loadFilePage(page) {
        if (navigationState.currentFileSection && navigationState.currentFileItemId) {
            const currentState = navigationState.history[navigationState.currentIndex];
            if (currentState && currentState.type === 'item') {
                loadItemView(
                    navigationState.currentFileSection,
                    navigationState.currentFileItemId,
                    currentState.itemName,
                    page
                );
            }
        }
    }

    function showFileDetails(fileId, fileName, fileList = null, fileIndex = -1) {
        console.log('Showing file details for:', { fileId, fileName, fileList, fileIndex, MODAL_ENABLED });
        
        // If modal is disabled, open in new tab instead
        if (!MODAL_ENABLED) {
            console.log('Modal disabled - opening in new tab');
            window.open(`/file/${fileId}`, '_blank');
            return;
        }
        
        // Store file list context if provided
        if (fileList && Array.isArray(fileList)) {
            fileNavigationState.currentFiles = fileList;
            fileNavigationState.currentIndex = fileIndex >= 0 ? fileIndex : fileList.findIndex(f => f.id === fileId);
        } else {
            // Try to get file list from current page
            const fileRows = document.querySelectorAll('.file-row-item[data-file-id]');
            if (fileRows.length > 0) {
                fileNavigationState.currentFiles = Array.from(fileRows).map(row => ({
                    id: parseInt(row.getAttribute('data-file-id')),
                    name: row.getAttribute('data-file-name') || 'File'
                }));
                fileNavigationState.currentIndex = fileNavigationState.currentFiles.findIndex(f => f.id === fileId);
            }
        }
        
        // Open modal
        const modal = document.getElementById('fileModal');
        if (!modal) {
            console.error('File modal not found in DOM');
            if (window.showError) {
                window.showError('Modal element not found. Please refresh the page.');
            } else if (window.alert) {
                window.alert('Modal element not found. Please refresh the page.');
            }
            // Fallback: open in new tab
            window.open(`/file/${fileId}`, '_blank');
            return;
        }
        
        console.log('Modal element found:', modal);
        
        // Update navigation buttons
        updateFileNavigationButtons();
        
        // Set modal title
        const modalTitle = document.getElementById('modalTitle');
        if (modalTitle) {
            modalTitle.textContent = fileName || (translations.fileDetails || 'File Details');
        }
        
        // Show loading state
        const contentSection = document.getElementById('fileContentSection');
        const analysisSection = document.getElementById('fileAnalysisSection');
        const metadataSection = document.getElementById('fileMetadataSection');
        
        if (contentSection) {
            contentSection.innerHTML = `<div class="content-loading">${translations.loadingContent || 'Loading content...'}</div>`;
        }
        if (analysisSection) {
            analysisSection.innerHTML = `<div class="content-loading">${translations.loadingAnalysis || 'Loading analysis...'}</div>`;
        }
        if (metadataSection) {
            metadataSection.innerHTML = `<div class="content-loading">${translations.loadingMetadata || 'Loading metadata...'}</div>`;
        }
        
        // Show modal - force display with multiple methods
        modal.classList.add('active');
        modal.style.display = 'flex';
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
        modal.style.zIndex = '99999';
        
        console.log('Modal classes:', modal.className);
        console.log('Modal style:', modal.style.cssText);
        console.log('Modal computed style:', window.getComputedStyle(modal).display);
        
        // Prevent body scroll when modal is open
        document.body.style.overflow = 'hidden';
        
        // Load file details from API
        loadFileDetailsContent(fileId, fileName);
    }
    
    // Test function to manually open modal (for debugging)
    function testModal() {
        console.log('Testing modal...');
        const modal = document.getElementById('fileModal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
            modal.style.visibility = 'visible';
            modal.style.opacity = '1';
            console.log('Modal should be visible now');
        } else {
            console.error('Modal not found');
        }
    }
    
    // Make testModal available globally for console testing
    window.testModal = testModal;

    function loadFileDetailsContent(fileId, fileName) {
        fetch(`/api/file/${fileId}/details`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('=== FILE DETAILS API RESPONSE ===');
            console.log('Full response:', JSON.stringify(data, null, 2));
            console.log('File details object:', data.details);
            console.log('All keys in details:', Object.keys(data.details || {}));
            console.log('Content key exists?', 'content' in (data.details || {}));
            console.log('Categories key exists?', 'categories' in (data.details || {}));
            console.log('Content:', data.details?.content);
            console.log('Content type:', typeof data.details?.content);
            console.log('Content length:', data.details?.content?.length);
            console.log('Categories:', data.details?.categories);
            console.log('Categories type:', typeof data.details?.categories);
            console.log('Categories length:', data.details?.categories?.length);
            console.log('Is categories array?', Array.isArray(data.details?.categories));
            console.log('=== END FILE DETAILS ===');
            
            if (!data.success || !data.details) {
                const errorMsg = escapeHtml(data.error || (translations.errorLoadingFileDetails || 'Error loading file details'));
                const contentSection = document.getElementById('fileContentSection');
                const analysisSection = document.getElementById('fileAnalysisSection');
                const metadataSection = document.getElementById('fileMetadataSection');
                
                if (contentSection) contentSection.innerHTML = `<div class="empty-state">${errorMsg}</div>`;
                if (analysisSection) analysisSection.innerHTML = `<div class="empty-state">${errorMsg}</div>`;
                if (metadataSection) metadataSection.innerHTML = `<div class="empty-state">${errorMsg}</div>`;
                return;
            }

            const file = data.details;
            
            // Store file ID for export functionality
            window.currentModalFileId = fileId;
            
            console.log('Processing file:', {
                hasContent: !!file.content,
                contentLength: file.content?.length,
                contentValue: file.content,
                hasCategories: !!file.categories,
                categoriesCount: file.categories?.length,
                categoriesValue: file.categories,
                wordCount: file.word_count,
                allKeys: Object.keys(file)
            });
            
            // Debug: Check if fields exist with different access methods
            console.log('Direct access - file.content:', file.content);
            console.log('Direct access - file["content"]:', file['content']);
            console.log('Direct access - file.categories:', file.categories);
            console.log('Direct access - file["categories"]:', file['categories']);
            
            // Populate Content Section (Left)
            const contentSection = document.getElementById('fileContentSection');
            console.log('Content section element:', contentSection);
            
            if (!contentSection) {
                console.error('fileContentSection element not found!');
            } else {
                // Try multiple ways to access content
                const contentValue = file.content || file['content'] || '';
                console.log('Content value retrieved:', typeof contentValue, contentValue ? contentValue.substring(0, 100) : 'EMPTY');
                
                if (contentValue && typeof contentValue === 'string' && contentValue.trim()) {
                    // Limit content display to prevent overwhelming the UI
                    const maxContentLength = 500000; // ~500KB
                    let displayContent = contentValue;
                    const isTruncated = displayContent.length > maxContentLength;
                    if (isTruncated) {
                        displayContent = displayContent.substring(0, maxContentLength) + '\n\n... ' + (translations.contentTruncated || '(Content truncated for display)');
                    }
                    
                    // Store original content for search and copy functionality
                    window.currentModalFileContent = contentValue; // Store full content
                    window.currentModalFileName = fileName || 'file';
                    
                    // Create content element with ID for search functionality
                    contentSection.innerHTML = `<pre id="modalContentText" style="margin: 0; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(displayContent)}</pre>`;
                    
                    // Store original HTML for search highlighting
                    const contentElement = document.getElementById('modalContentText');
                    if (contentElement) {
                        contentElement.setAttribute('data-original-content', contentElement.innerHTML);
                        contentElement.setAttribute('data-full-content', escapeHtml(contentValue));
                    }
                    
                    console.log('Content section populated with', displayContent.length, 'characters', isTruncated ? '(truncated)' : '(full)');
                } else {
                    window.currentModalFileContent = '';
                    window.currentModalFileName = fileName || 'file';
                    contentSection.innerHTML = `<div class="empty-state">${translations.noContentAvailable || 'No content available'}</div>`;
                    console.log('No content available for file - contentValue:', contentValue);
                }
            }
            
            // Populate Analysis Section (Right Top) with Classification Charts and Title Analysis
            const analysisSection = document.getElementById('fileAnalysisSection');
            console.log('Analysis section element:', analysisSection);
            
            if (!analysisSection) {
                console.error('fileAnalysisSection element not found!');
            } else {
                let analysisHtml = '';
                
                // ✅ NEW: Title-based analysis
                if (file.title) {
                    analysisHtml += `
                        <div class="analysis-section-title">
                            <h4><i class="bi bi-file-text me-2"></i>${translations.titleAnalysis || 'Title Analysis'}</h4>
                        </div>
                        <div class="analysis-item">
                            <div class="analysis-label">${translations.fileTitle || 'File Title'}:</div>
                            <div class="analysis-value">${escapeHtml(file.title)}</div>
                        </div>
                    `;
                    
                    // Show similar titles if available
                    if (file.similar_titles && file.similar_titles.length > 0) {
                        analysisHtml += `
                            <div class="analysis-item">
                                <div class="analysis-label">${translations.similarTitles || 'Similar Titles'}:</div>
                                <div class="similar-titles-list">
                        `;
                        
                        file.similar_titles.forEach(similar => {
                            analysisHtml += `
                                <div class="similar-title-item">
                                    <span class="similarity-badge">${similar.similarity_percent || 0}%</span>
                                    <span class="similar-title-text">${escapeHtml(similar.name || 'Unknown')}</span>
                                    ${similar.file_count ? `<span class="file-count-badge">${similar.file_count} files</span>` : ''}
                                </div>
                            `;
                        });
                        
                        analysisHtml += `
                                </div>
                            </div>
                        `;
                    }
                    
                    analysisHtml += '<hr style="margin: 1rem 0; border-color: #e2e8f0;">';
                }
                
                // Load classification chart data
                analysisHtml += '<div id="classificationChartsContainer"></div>';
                analysisSection.innerHTML = analysisHtml;
                
                // Load charts after HTML is set
                loadClassificationCharts(file.id);
            }
            
            // Populate Metadata Section (Right Bottom)
            const metadataSection = document.getElementById('fileMetadataSection');
            console.log('Metadata section element:', metadataSection);
            
            if (!metadataSection) {
                console.error('fileMetadataSection element not found!');
            } else {
                let metadataHtml = '';
                
                const metadataItems = [
                    { label: translations.fileName || 'File Name', value: file.name || 'N/A' },
                    { label: translations.fileType || 'File Type', value: file.type || 'Unknown' },
                    { label: translations.fileSize || 'File Size', value: formatFileSize(file.size) },
                    { label: translations.status || 'Status', value: file.status || 'Unknown' },
                    { label: translations.fileDate || 'File Date', value: file.file_date ? new Date(file.file_date).toLocaleDateString() : 'N/A' },
                    { label: translations.dateCreated || 'Date Created', value: file.date_creation ? new Date(file.date_creation).toLocaleDateString() : 'N/A' },
                    { label: translations.source || 'Source', value: file.source || 'Unknown' },
                    { label: translations.side || 'Side', value: file.side || 'Unknown' },
                    { label: translations.wordCount || 'Word Count', value: (file.word_count || 0).toLocaleString() },
                    { label: translations.contentChunks || 'Content Chunks', value: (file.content_chunks || 0).toLocaleString() }
                ];
                
                if (file.path) {
                    metadataItems.push({ label: translations.filePath || 'File Path', value: file.path });
                }
                
                if (file.hash) {
                    metadataItems.push({ label: translations.hash || 'Hash', value: file.hash });
                }
                
                metadataItems.forEach(item => {
                    metadataHtml += `
                        <div class="metadata-item">
                            <div class="metadata-label">${escapeHtml(item.label)}</div>
                            <div class="metadata-value">${escapeHtml(String(item.value))}</div>
                        </div>
                    `;
                });
                
                metadataSection.innerHTML = metadataHtml || `<div class="empty-state">${translations.noMetadataAvailable || 'No metadata available'}</div>`;
                console.log('Metadata section populated with', metadataItems.length, 'items');
            }
        })
        .catch(error => {
            console.error('Error loading file details:', error);
            console.error('Error stack:', error.stack);
            const errorMsg = escapeHtml(error.message);
            
            const contentSection = document.getElementById('fileContentSection');
            const analysisSection = document.getElementById('fileAnalysisSection');
            const metadataSection = document.getElementById('fileMetadataSection');
            
            if (contentSection) {
                contentSection.innerHTML = `<div class="empty-state">${translations.errorLoadingFileDetails || 'Error loading file details'}: ${errorMsg}</div>`;
            }
            if (analysisSection) {
                analysisSection.innerHTML = `<div class="empty-state">${translations.errorLoadingAnalysis || 'Error loading analysis'}: ${errorMsg}</div>`;
            }
            if (metadataSection) {
                metadataSection.innerHTML = `<div class="empty-state">${translations.errorLoadingMetadata || 'Error loading metadata'}: ${errorMsg}</div>`;
            }
        });
    }

    function navigateFileInModal(direction) {
        const files = fileNavigationState.currentFiles;
        if (!files || files.length === 0) {
            console.warn('No file list available for navigation');
            return;
        }
        
        const currentIndex = fileNavigationState.currentIndex;
        const newIndex = currentIndex + direction;
        
        if (newIndex < 0 || newIndex >= files.length) {
            console.warn('Cannot navigate: index out of bounds');
            return;
        }
        
        const nextFile = files[newIndex];
        if (nextFile && nextFile.id) {
            fileNavigationState.currentIndex = newIndex;
            updateFileNavigationButtons();
            
            // Update title immediately
            const modalTitle = document.getElementById('modalTitle');
            if (modalTitle) {
                modalTitle.textContent = nextFile.name || (translations.fileDetails || 'File Details');
            }
            
            // Load new file content
            loadFileDetailsContent(nextFile.id, nextFile.name);
        }
    }

    function updateFileNavigationButtons() {
        const files = fileNavigationState.currentFiles;
        const currentIndex = fileNavigationState.currentIndex;
        const totalFiles = files ? files.length : 0;
        
        const prevBtn = document.getElementById('prevFileBtn');
        const nextBtn = document.getElementById('nextFileBtn');
        const counter = document.getElementById('fileNavCounter');
        
        if (prevBtn) {
            prevBtn.disabled = totalFiles === 0 || currentIndex <= 0;
        }
        
        if (nextBtn) {
            nextBtn.disabled = totalFiles === 0 || currentIndex >= totalFiles - 1;
        }
        
        if (counter && totalFiles > 0) {
            counter.textContent = `${currentIndex + 1} / ${totalFiles}`;
            counter.style.display = 'inline-block';
        } else if (counter) {
            counter.style.display = 'none';
        }
    }

    function closeFileModal() {
        const modal = document.getElementById('fileModal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';
            // Restore body scroll
            document.body.style.overflow = '';
            
            // Clear search state
            clearModalSearch();
            
            // Clear stored content and file ID
            window.currentModalFileContent = '';
            window.currentModalFileName = '';
            window.currentModalFileId = null;
        }
    }
    
    // Close modal when clicking outside
    document.addEventListener('click', function(e) {
        const modal = document.getElementById('fileModal');
        if (modal && modal.classList.contains('active')) {
            // Check if click is on the modal backdrop (not on the content)
            if (e.target === modal) {
                closeFileModal();
            }
        }
    });

    // Keyboard navigation for file modal
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('fileModal');
        if (!modal || !modal.classList.contains('active')) {
            return;
        }
        
        // Close modal with Escape key
        if (e.key === 'Escape') {
            closeFileModal();
            return;
        }
        
        // Navigate with arrow keys
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const prevBtn = document.getElementById('prevFileBtn');
            if (prevBtn && !prevBtn.disabled) {
                navigateFileInModal(-1);
            }
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            const nextBtn = document.getElementById('nextFileBtn');
            if (nextBtn && !nextBtn.disabled) {
                navigateFileInModal(1);
            }
        }
    });

    // File selection functions
    function updateSelectedFiles() {
        const checkboxes = document.querySelectorAll('.file-select-checkbox:checked');
        const count = checkboxes.length;
        const selectedCountEl = document.getElementById('selectedCount');
        if (selectedCountEl) {
            selectedCountEl.textContent = count + ' ' + (translations.selected || 'selected');
        }
    }

    function selectAllFiles() {
        const checkboxes = document.querySelectorAll('.file-select-checkbox');
        checkboxes.forEach(cb => cb.checked = true);
        updateSelectedFiles();
    }

    function deselectAllFiles() {
        const checkboxes = document.querySelectorAll('.file-select-checkbox');
        checkboxes.forEach(cb => cb.checked = false);
        updateSelectedFiles();
    }

    function exportSelectedFiles() {
        const checkboxes = document.querySelectorAll('.file-select-checkbox:checked');
        if (checkboxes.length === 0) {
            if (window.showWarning) {
                window.showWarning(translations.pleaseSelectAtLeastOneFileToExport || 'Please select at least one file to export');
            } else if (window.alert) {
                window.alert(translations.pleaseSelectAtLeastOneFileToExport || 'Please select at least one file to export');
            }
            return;
        }

        const fileIds = Array.from(checkboxes).map(cb => cb.value);
        
        // Export each selected file
        fileIds.forEach((fileId, index) => {
            setTimeout(() => {
                exportFile(parseInt(fileId));
            }, index * 100); // Stagger downloads slightly
        });
    }

    // Filter displayed files based on search query
    //  OPTIMIZED: Faster file filtering with better keyword matching
    function filterDisplayedFiles(searchQuery) {
        const fileRows = document.querySelectorAll('.file-row-item[data-file-id]');
        const query = searchQuery.toLowerCase().trim();
        
        if (!query) {
            // Show all if no query
            fileRows.forEach(row => row.style.display = '');
            return;
        }
        
        // Split query into keywords for better matching
        const keywords = query.split(/\s+/).filter(k => k.length > 0);
        const lowerQuery = query.toLowerCase();
        
        let visibleCount = 0;
        fileRows.forEach(row => {
            const fileName = (row.getAttribute('data-file-name') || '').toLowerCase();
            const fileType = (row.getAttribute('data-file-type') || '').toLowerCase();
            const fileSource = (row.getAttribute('data-file-source') || '').toLowerCase();
            const fileDate = (row.getAttribute('data-file-date') || '').toLowerCase();
            
            // Check if all keywords match (AND logic) or any part matches (OR logic)
            let matches = false;
            if (keywords.length > 1) {
                // All keywords must be found (AND logic)
                matches = keywords.every(keyword => 
                    fileName.includes(keyword) || 
                    fileType.includes(keyword) || 
                    fileSource.includes(keyword) || 
                    fileDate.includes(keyword)
                );
            } else {
                // Single keyword or phrase match
                matches = fileName.includes(lowerQuery) || 
                         fileType.includes(lowerQuery) || 
                         fileSource.includes(lowerQuery) || 
                         fileDate.includes(lowerQuery);
            }
            
            if (matches) {
                row.style.display = '';
                visibleCount++;
            } else {
                row.style.display = 'none';
            }
        });
        
        // Update selected count display if it exists
        const selectedCountEl = document.getElementById('selectedCount');
        if (selectedCountEl && query) {
            const checkedCount = document.querySelectorAll('.file-select-checkbox:checked:not([style*="display: none"])').length;
            selectedCountEl.textContent = `${checkedCount} ${translations.selected || 'selected'} (${visibleCount} ${translations.visible || 'visible'})`;
        }
    }

    // Enable file field editing
    function enableFileEdit(element) {
        if (element.getAttribute('data-editable') === 'true') {
            element.contentEditable = 'true';
            element.style.backgroundColor = '#f0f9ff';
            element.style.border = '1px solid #3b82f6';
            element.style.outline = 'none';
            element.focus();
            
            // Select all text for easy editing
            if (window.getSelection && document.createRange) {
                const range = document.createRange();
                range.selectNodeContents(element);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
    }

    // Save file field changes
    function saveFileField(element) {
        const fileId = element.getAttribute('data-file-id');
        const field = element.getAttribute('data-field');
        const newValue = element.textContent.trim();
        
        if (!fileId || !field) return;
        
        // Disable editing
        element.contentEditable = 'false';
        element.style.backgroundColor = '';
        element.style.border = '';
        
        // Update data attribute
        if (field === 'name') {
            element.closest('.file-row-item').setAttribute('data-file-name', newValue);
        } else if (field === 'type') {
            element.closest('.file-row-item').setAttribute('data-file-type', newValue);
        } else if (field === 'source') {
            element.closest('.file-row-item').setAttribute('data-file-source', newValue);
        } else if (field === 'date') {
            element.closest('.file-row-item').setAttribute('data-file-date', newValue);
        }
        
        // Save to server (you can implement API call here)
        console.log(`Saving file ${fileId}, field ${field}, value: ${newValue}`);
        
        // Optional: Make API call to save changes
        // fetch(`/api/file/${fileId}/update`, {
        //     method: 'POST',
        //     headers: {'Content-Type': 'application/json'},
        //     body: JSON.stringify({field: field, value: newValue})
        // }).then(response => response.json())
        //   .then(data => {
        //       if (!data.success) {
        //           alert(translations.errorSavingChanges || 'Error saving changes');
        //           // Revert value
        //       }
        //   });
    }

    //  OPTIMIZED: Faster section item filtering with keyword matching
    function filterSectionItems(searchQuery) {
        const itemRows = document.querySelectorAll('.file-row-item[data-item-id]');
        const query = searchQuery.toLowerCase().trim();
        
        if (!query) {
            // Show all if no query
            itemRows.forEach(row => row.style.display = '');
            return;
        }
        
        // Split query into keywords for better matching
        const keywords = query.split(/\s+/).filter(k => k.length > 0);
        const lowerQuery = query.toLowerCase();
        
        let visibleCount = 0;
        itemRows.forEach(row => {
            const itemName = (row.getAttribute('data-item-name') || '').toLowerCase();
            const itemDetails = (row.textContent || '').toLowerCase();
            
            // Check if all keywords match (AND logic) or any part matches (OR logic)
            let matches = false;
            if (keywords.length > 1) {
                // All keywords must be found (AND logic)
                matches = keywords.every(keyword => 
                    itemName.includes(keyword) || 
                    itemDetails.includes(keyword)
                );
            } else {
                // Single keyword or phrase match
                matches = itemName.includes(lowerQuery) || 
                         itemDetails.includes(lowerQuery);
            }
            
            if (matches) {
                row.style.display = '';
                visibleCount++;
            } else {
                row.style.display = 'none';
            }
        });
        
        return visibleCount;
    }

    // Enable item field editing
    function enableItemEdit(element) {
        if (element.getAttribute('data-editable') === 'true') {
            element.contentEditable = 'true';
            element.style.backgroundColor = '#f0f9ff';
            element.style.border = '1px solid #3b82f6';
            element.style.outline = 'none';
            element.focus();
            
            // Select all text for easy editing
            if (window.getSelection && document.createRange) {
                const range = document.createRange();
                range.selectNodeContents(element);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
    }

    // Save item field changes
    function saveItemField(element) {
        const itemId = element.getAttribute('data-item-id');
        const section = element.getAttribute('data-section');
        const field = element.getAttribute('data-field');
        const newValue = element.textContent.trim();
        
        if (!itemId || !section || !field) return;
        
        // Disable editing
        element.contentEditable = 'false';
        element.style.backgroundColor = '';
        element.style.border = '';
        
        // Update data attribute
        if (field === 'name') {
            element.closest('.file-row-item').setAttribute('data-item-name', escapeHtml(newValue).replace(/"/g, '&quot;'));
        }
        
        // Save to server (you can implement API call here)
        console.log(`Saving ${section} item ${itemId}, field ${field}, value: ${newValue}`);
        
        // Optional: Make API call to save changes
        // fetch(`/api/${section}/${itemId}/update`, {
        //     method: 'POST',
        //     headers: {'Content-Type': 'application/json'},
        //     body: JSON.stringify({field: field, value: newValue})
        // }).then(response => response.json())
        //   .then(data => {
        //       if (!data.success) {
        //           alert(translations.errorSavingChanges || 'Error saving changes');
        //           // Revert value
        //       }
        //   });
    }

    function renderGridView(items, section, showPagination = false) {
        console.log(`Rendering grid view for ${section} with ${items.length} items`);
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) {
            console.error('unifiedContentView not found in renderGridView');
            return;
        }

        const sectionLabel = sectionLabels[section] || section;
        const addButtonHtml = getAddButtonHtml(section);
        
        let html = '<div class="section">';
        html += '<div class="section-header">';
        html += `<div class="section-label"><i class="bi bi-${getSectionIcon(section)}"></i> ${sectionLabel}</div>`;
        html += addButtonHtml;
        html += '</div>';
        // Add search for section items if in grid view
        html += '<div class="explorer-grid" id="contentGrid" style="max-height: 70vh; overflow-y: auto; overflow-x: hidden;">';
        
        if (items.length === 0) {
            html += `<div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #64748b;">${translations.noItemsFound || 'No items found'}</div>`;
        } else {
            let renderedCount = 0;
            
            items.forEach((item, index) => {
            try {
                // ✅ NEW: Handle grouped titles
                const displayName = item.name_display || (
                    section === 'hash' && item.name && item.name.length > 32 
                        ? item.name.substring(0, 32) + '...' 
                        : (item.name || 'Unnamed')
                );
                const details = getItemDetails(item, section);
                
                // Ensure item.id exists and is valid
                const itemId = item.id || item.ID || null;
                if (!itemId) {
                    console.warn(`Item ${index} missing ID:`, item);
                    return; // Skip items without ID
                }
                
                // Use data attributes for event delegation
                const safeDisplayName = escapeHtml(displayName);
                
                const sectionLabel = sectionLabels[section] || section;
                
                // ✅ NEW: Add group indicator for grouped titles
                let groupIndicator = '';
                if (item.is_group && section === 'titles') {
                    groupIndicator = `<span class="badge bg-info ms-2" title="${item.is_identical ? 'Identical' : 'Similar'} titles group">${item.group_count}</span>`;
                }
                
                // Store group data for titles if it's a group
                let groupDataAttr = '';
                if (item.is_group && section === 'titles' && item.similar_titles) {
                    const titleIds = item.similar_titles.map(st => st.id).filter(id => id).join(',');
                    groupDataAttr = `data-group-title-ids="${titleIds}"`;
                }
                
                html += `
                    <div class="explorer-item" 
                         data-section="${section}" 
                         data-item-id="${itemId}" 
                         data-item-name="${safeDisplayName.replace(/"/g, '&quot;')}"
                         ${item.is_group ? 'data-is-group="true"' : ''}
                         ${groupDataAttr}
                         style="cursor: pointer; position: relative;"
                         role="button"
                         tabindex="0"
                         title="${sectionLabel}: ${safeDisplayName}"
                         aria-label="${sectionLabel}: ${safeDisplayName}">
                        <div class="explorer-item-icon"><i class="bi bi-${getSectionIcon(section)}" aria-hidden="true"></i></div>
                        <div class="explorer-item-name" contenteditable="false" data-editable="true" data-item-id="${itemId}" data-section="${section}" data-field="name" onblur="saveItemField(this)" ondblclick="enableItemEdit(this)" style="padding: 2px 4px; border-radius: 2px; min-height: 1.2em;">
                            ${safeDisplayName}${groupIndicator}
                        </div>
                        <div class="explorer-item-details" contenteditable="false" data-editable="true" data-item-id="${itemId}" data-section="${section}" data-field="details" onblur="saveItemField(this)" ondblclick="enableItemEdit(this)" style="padding: 2px 4px; border-radius: 2px;">${escapeHtml(details)}</div>
                        ${item.is_group && item.similar_titles ? `
                            <div class="similar-titles-preview" style="margin-top: 0.5rem; font-size: 0.75rem; color: #64748b;">
                                <i class="bi bi-arrow-down-circle" style="cursor: pointer;" onclick="toggleSimilarTitles(this, ${item.group_id})"></i>
                                <span>${item.group_count} ${item.is_identical ? 'identical' : 'similar'} titles</span>
                                <div class="similar-titles-list" id="similar-titles-${item.group_id}" style="display: none; margin-top: 0.5rem; padding-left: 1rem;">
                                    ${item.similar_titles.map(st => `
                                        <div style="margin: 0.25rem 0;">
                                            <span class="badge bg-secondary">${st.file_count || 0}</span>
                                            ${escapeHtml(st.name || 'Unknown')}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
                renderedCount++;
            } catch (error) {
                console.error(`Error rendering item ${index}:`, error);
            }
            });
            
            console.log(`Rendered ${renderedCount} items in grid view`);
        }
        
        html += '</div>'; // Close explorer-grid
        
        // Add pagination controls if needed
        if (showPagination) {
            html += renderSectionPaginationControls(section);
        }
        
        html += '</div>'; // Close section
        
        // ✅ FIX: Return HTML instead of setting innerHTML directly
        if (showPagination) {
            contentView.innerHTML = html;
            return '';
        }
        return html;
    }

    function renderListView(items, section, showPagination = false) {
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) return;

        const sectionLabel = sectionLabels[section] || section;
        const addButtonHtml = getAddButtonHtml(section);
        
        let html = '<div class="section">';
        html += '<div class="section-header">';
        html += `<div class="section-label"><i class="bi bi-${getSectionIcon(section)}"></i> ${sectionLabel}</div>`;
        html += addButtonHtml;
        html += '</div>';
        // Add search for section items if in list view
        html += '<div class="files-list-view" style="max-height: 70vh; overflow-y: auto; overflow-x: hidden;">';
        
        if (items.length === 0) {
            html += `<div class="empty-state" style="text-align: center; padding: 3rem; color: #64748b;">${translations.noItemsFound || 'No items found'}</div>`;
        } else {
            items.forEach(item => {
            // ✅ NEW: Handle grouped titles
            const displayName = item.name_display || (
                section === 'hash' && item.name && item.name.length > 32 
                    ? item.name.substring(0, 32) + '...' 
                    : (item.name || 'Unnamed')
            );
            const details = getItemDetails(item, section);
            
            // Ensure item.id exists and is valid
            const itemId = item.id || item.ID || null;
            if (!itemId) {
                console.warn('Item missing ID:', item);
                return; // Skip items without ID
            }
            
            const sectionLabel = sectionLabels[section] || section;
            const safeDisplayName = escapeHtml(displayName).replace(/"/g, '&quot;');
            
            // ✅ NEW: Add group indicator for grouped titles
            let groupIndicator = '';
            if (item.is_group && section === 'titles') {
                groupIndicator = `<span class="badge bg-info ms-2" title="${item.is_identical ? 'Identical' : 'Similar'} titles group">${item.group_count}</span>`;
            }
            
            // Store group data for titles if it's a group
            let groupDataAttr = '';
            if (item.is_group && section === 'titles' && item.similar_titles) {
                const titleIds = item.similar_titles.map(st => st.id).filter(id => id).join(',');
                groupDataAttr = `data-group-title-ids="${titleIds}"`;
            }
            
            html += `
                <div class="file-row-item" 
                     data-section="${section}" 
                     data-item-id="${itemId}" 
                     data-item-name="${safeDisplayName}"
                     ${item.is_group ? 'data-is-group="true"' : ''}
                     ${groupDataAttr}
                     style="cursor: pointer; position: relative;"
                     role="button"
                     tabindex="0"
                     title="${sectionLabel}: ${escapeHtml(displayName)}"
                     aria-label="${sectionLabel}: ${escapeHtml(displayName)}">
                    <div class="file-row-info" style="flex: 1;">
                        <div class="file-row-icon"><i class="bi bi-${getSectionIcon(section)}" aria-hidden="true"></i></div>
                        <div class="file-row-details" style="flex: 1;">
                            <div class="file-row-name" contenteditable="false" data-editable="true" data-item-id="${itemId}" data-section="${section}" data-field="name" onblur="saveItemField(this)" ondblclick="enableItemEdit(this)" style="padding: 2px 4px; border-radius: 2px; min-height: 1.2em;">
                                ${escapeHtml(displayName)}${groupIndicator}
                            </div>
                            <div class="file-row-meta" contenteditable="false" data-editable="true" data-item-id="${itemId}" data-section="${section}" data-field="details" onblur="saveItemField(this)" ondblclick="enableItemEdit(this)" style="padding: 2px 4px; border-radius: 2px;">${escapeHtml(details)}</div>
                            ${item.is_group && item.similar_titles ? `
                                <div class="similar-titles-preview" style="margin-top: 0.5rem; font-size: 0.75rem; color: #64748b;">
                                    <i class="bi bi-arrow-down-circle" style="cursor: pointer;" onclick="toggleSimilarTitles(this, ${item.group_id})"></i>
                                    <span>${item.group_count} ${item.is_identical ? 'identical' : 'similar'} titles</span>
                                    <div class="similar-titles-list" id="similar-titles-${item.group_id}" style="display: none; margin-top: 0.5rem; padding-left: 1rem;">
                                        ${item.similar_titles.map(st => `
                                            <div style="margin: 0.25rem 0;">
                                                <span class="badge bg-secondary">${st.file_count || 0}</span>
                                                ${escapeHtml(st.name || 'Unknown')}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
            });
        }
        html += '</div>'; // Close files-list-view
        
        // Add pagination controls if needed
        if (showPagination) {
            html += renderSectionPaginationControls(section);
        }
        
        html += '</div>'; // Close section
        
        // ✅ FIX: Return HTML instead of setting innerHTML directly
        if (showPagination) {
            contentView.innerHTML = html;
            return '';
        }
        return html;
    }

    // Get Add Button HTML for a section
    function getAddButtonHtml(section) {
        const modalMap = {
            'sources': 'addSourceModal',
            'sides': 'addSideModal',
            'keywords': 'addKeywordModal',
            'category': 'addCategoryModal'
        };
        
        const modalId = modalMap[section];
        if (!modalId) return '';
        
        const buttonLabels = {
            'sources': translations.addSource || 'Add Source',
            'sides': translations.addSide || 'Add Side',
            'keywords': translations.addKeyword || 'Add Keyword',
            'category': translations.addCategory || 'Add Category'
        };
        
        const icons = {
            'sources': 'bi-people',
            'sides': 'bi-diagram-3',
            'keywords': 'bi-key',
            'category': 'bi-tags'
        };
        
        // Special handling for category section - show two buttons
        if (section === 'category') {
            return `<div style="display: flex; gap: 0.5rem;">
                <button class="add-item-btn" onclick="openAddItemModal('addCategoryModal', 'category')" title="${translations.addCategory || 'Add Category'}" aria-label="${translations.addCategory || 'Add Category'}">
                    <i class="bi bi-tags"></i>
                    <span>${translations.addCategory || 'Add Category'}</span>
                </button>
                <button class="add-item-btn" onclick="openAddItemModal('addWordsCategorysModal', 'words_categorys')" title="${translations.addWordCategory || 'Add Word-Category'}" aria-label="${translations.addWordCategory || 'Add Word-Category'}" style="background-color: #7c3aed;">
                    <i class="bi bi-link-45deg"></i>
                    <span>${translations.addWordCategory || 'Add Word-Category'}</span>
                </button>
            </div>`;
        }
        
        // Special handling for keywords section - show Add and Update buttons
        if (section === 'keywords') {
            return `<div style="display: flex; gap: 0.5rem;">
                <button class="add-item-btn" onclick="openAddItemModal('${modalId}', '${section}')" title="${buttonLabels[section] || 'Add'}" aria-label="${buttonLabels[section] || 'Add'}">
                    <i class="bi ${icons[section] || 'bi-plus-circle'}"></i>
                    <span>${buttonLabels[section] || 'Add'}</span>
                </button>
                <button class="add-item-btn" onclick="updateKeywordAssociations()" id="updateKeywordsBtn" title="${translations.updateKeywordAssociations || 'Update keyword associations for all files'}" aria-label="${translations.updateKeywordAssociations || 'Update keyword associations for all files'}" style="background-color: #10b981;">
                    <i class="bi bi-arrow-repeat"></i>
                    <span>${translations.updateKeywords || 'Update Keywords'}</span>
                </button>
            </div>`;
        }
        
        return `<button class="add-item-btn" onclick="openAddItemModal('${modalId}', '${section}')" title="${buttonLabels[section] || 'Add'}" aria-label="${buttonLabels[section] || 'Add'}">
            <i class="bi ${icons[section] || 'bi-plus-circle'}"></i>
            <span>${buttonLabels[section] || 'Add'}</span>
        </button>`;
    }

    function getItemDetails(item, section) {
        if (section === 'category') {
            const fileCount = (item.file_count || 0) + ' ' + (translations.files || 'Files');
            const wordCount = (item.word_count || 0) + ' ' + (translations.words || 'Words');
            return fileCount + ' • ' + wordCount;
        } else if (section === 'keywords' || section === 'hash') {
            return (item.file_count || 0) + ' ' + (translations.files || 'files');
        } else if (section === 'sources') {
            return (item.job || '') + ' - ' + (item.country || '') + ' (' + (item.file_count || 0) + ' ' + (translations.files || 'files') + ')';
        } else if (section === 'sides') {
            return translations.importance + ': ' + (item.importance ? item.importance.toFixed(2) : '0.00') + ' (' + (item.file_count || 0) + ' ' + (translations.files || 'files') + ')';
        } else if (section === 'titles') {
            return item.status || '';
        }
        return '';
    }

    function getSectionIcon(section) {
        const icons = {
            category: 'folder',
            keywords: 'tags',
            titles: 'file-text',
            sources: 'people',
            sides: 'diagram-3',
            hash: 'hash'
        };
        return icons[section] || 'file';
    }

    function filterItems(items, query) {
        if (!query) return items;
        const lowerQuery = query.toLowerCase();
        return items.filter(item => {
            const name = (item.name || '').toLowerCase();
            return name.includes(lowerQuery);
        });
    }

    //  OPTIMIZED: Debounced global search with client-side filtering
    let globalSearchTimeout = null;
    let lastGlobalSearchQuery = '';
    
    function handleGlobalSearch(query) {
        navigationState.searchQuery = query;
        const trimmedQuery = query.trim();
        
        // Clear previous timeout
        if (globalSearchTimeout) {
            clearTimeout(globalSearchTimeout);
        }
        
        // If query is empty, clear filters and restore view
        if (!trimmedQuery) {
            clearGlobalSearch();
            return;
        }
        
        // Debounce search for better performance (300ms delay)
        globalSearchTimeout = setTimeout(() => {
            performGlobalSearch(trimmedQuery);
        }, 300);
    }
    
    function performGlobalSearch(query) {
        // Avoid duplicate searches
        if (query === lastGlobalSearchQuery) {
            return;
        }
        lastGlobalSearchQuery = query;
        
        const currentState = navigationState.history[navigationState.currentIndex];
        
        // First, try quick client-side filtering for already-loaded items
        const quickFiltered = performQuickClientSideFilter(query);
        
        if (quickFiltered) {
            // Client-side filtering worked, update UI
            updateSearchResultsCount();
            return;
        }
        
        // Always use comprehensive search API to search across all data types
        // This works from any section/view (root, categories, keywords, sources, sides, etc.)
        performComprehensiveSearch(query);
    }
    
    function performComprehensiveSearch(query) {
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) return;
        
        if (!query || query.trim() === '') {
            // If query is empty, restore normal view
            const currentState = navigationState.history[navigationState.currentIndex];
            if (currentState && currentState.type === 'section') {
                loadSectionView(currentState.section);
            } else {
                loadRootView();
            }
            return;
        }
        
        // Show loading
        contentView.innerHTML = `<div class="content-loading"><i class="bi bi-arrow-repeat"></i><div>${translations.searching || 'Searching...'}</div></div>`;
        
        // Use comprehensive search API to search all data types
        const params = new URLSearchParams({
            query: query,
            search_all_data: 'true',
            page: 1,
            per_page: 100
        });
        
        fetch(`/api/search?${params}`)
            .then(response => response.json())
            .then(data => {
                if (data.results && data.results.length > 0) {
                    // Display comprehensive search results
                    displayComprehensiveSearchResults(data.results, query);
                } else {
                    // No results found
                    contentView.innerHTML = `<div class="empty-state">
                        <i class="bi bi-search"></i>
                        <h3>${translations.noResultsFound || 'No results found'}</h3>
                        <p>${translations.tryDifferentKeywords || 'Try different keywords or check your spelling'}</p>
                    </div>`;
                }
            })
            .catch(error => {
                console.error('Error in comprehensive search:', error);
                contentView.innerHTML = `<div class="empty-state">
                    <i class="bi bi-exclamation-triangle"></i>
                    <h3>${translations.errorSearchingDatabase || 'Error searching database'}</h3>
                    <p>${error.message || 'An error occurred while searching'}</p>
                </div>`;
            });
    }
    
    function performQuickClientSideFilter(query) {
        const lowerQuery = query.toLowerCase();
        let foundAny = false;
        
        // Filter file rows
        const fileRows = document.querySelectorAll('.file-row-item[data-file-id]');
        if (fileRows.length > 0) {
            foundAny = true;
            filterDisplayedFiles(query);
        }
        
        // Filter section items (categories, keywords, etc.)
        const sectionItems = document.querySelectorAll('.file-row-item[data-item-id]');
        if (sectionItems.length > 0) {
            foundAny = true;
            filterSectionItems(query);
        }
        
        // Filter grid items
        const gridItems = document.querySelectorAll('[data-item-name], [data-item-id]');
        if (gridItems.length > 0) {
            foundAny = true;
            gridItems.forEach(item => {
                const name = (item.getAttribute('data-item-name') || item.textContent || '').toLowerCase();
                const matches = !query || name.includes(lowerQuery);
                item.style.display = matches ? '' : 'none';
            });
        }
        
        return foundAny;
    }
    
    function clearGlobalSearch() {
        lastGlobalSearchQuery = '';
        navigationState.searchQuery = '';
        
        // Show all items
        document.querySelectorAll('.file-row-item[data-file-id], .file-row-item[data-item-id]').forEach(item => {
            item.style.display = '';
        });
        
        document.querySelectorAll('[data-item-name], [data-item-id]').forEach(item => {
            item.style.display = '';
        });
        
        updateSearchResultsCount();
        
        // Restore original view if needed
        const currentState = navigationState.history[navigationState.currentIndex];
        if (currentState && currentState.type === 'section') {
            loadSectionView(currentState.section);
        }
    }
    
    function updateSearchResultsCount() {
        const visibleFiles = document.querySelectorAll('.file-row-item[data-file-id]:not([style*="display: none"])').length;
        const totalFiles = document.querySelectorAll('.file-row-item[data-file-id]').length;
        
        if (totalFiles > 0 && navigationState.searchQuery) {
            const countText = `${visibleFiles} / ${totalFiles}`;
            const countEl = document.getElementById('navItemCountText');
            if (countEl) {
                countEl.textContent = countText;
                document.getElementById('navItemCount').style.display = 'block';
            }
        } else {
            document.getElementById('navItemCount').style.display = 'none';
        }
    }

    function searchSectionViaAPI(section, query) {
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) return;

        if (!query || query.trim() === '') {
            // If query is empty, restore normal view
            loadSectionView(section);
            return;
        }

        // Show loading
        contentView.innerHTML = `<div class="content-loading"><i class="bi bi-arrow-repeat"></i><div>${translations.searching || 'Searching...'}</div></div>`;

        //  NEW: Use comprehensive search API if available, otherwise fallback to section-specific search
        // Check if we should use comprehensive search (search all data)
        const useComprehensiveSearch = true; // Default to comprehensive search
        
        if (useComprehensiveSearch) {
            // Use comprehensive search API
            const params = new URLSearchParams({
                query: query,
                search_all_data: 'true',
                page: 1,
                per_page: 100
            });
            
            fetch(`/api/search?${params}`)
                .then(response => response.json())
                .then(data => {
                    if (data.results && data.results.length > 0) {
                        // Filter results by section if needed, or show all results
                        displayComprehensiveSearchResults(data.results, query);
                    } else {
                        // Fallback to section-specific search
                        performSectionSpecificSearch(section, query);
                    }
                })
                .catch(error => {
                    console.error('Error in comprehensive search, falling back:', error);
                    performSectionSpecificSearch(section, query);
                });
        } else {
            performSectionSpecificSearch(section, query);
        }
    }
    
    function performSectionSpecificSearch(section, query) {
        const contentView = document.getElementById('unifiedContentView');
        // Search via section-specific API
        fetch(`/api/archives/search?section=${section}&q=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(data => {
                if (data.success && data.results) {
                    if (data.results.length === 0) {
                        contentView.innerHTML = `<div class="empty-state">${translations.noResultsFound || 'No results found'}</div>`;
                    } else {
                        if (navigationState.currentView === 'grid') {
                            renderGridView(data.results, section);
                        } else {
                            renderListView(data.results, section);
                        }
                    }
                } else {
                    contentView.innerHTML = `<div class="empty-state">${translations.errorSearchingDatabase || 'Error searching database'}</div>`;
                }
            })
            .catch(error => {
                console.error('Error searching database:', error);
                contentView.innerHTML = `<div class="empty-state">${translations.errorSearchingDatabase || 'Error searching database'}</div>`;
            });
    }
    
    function displayComprehensiveSearchResults(results, query) {
        const contentView = document.getElementById('unifiedContentView');
        if (!contentView) return;
        
        // Group results by type
        const resultsByType = {};
        results.forEach(result => {
            const resultType = result.result_type || 'file';
            if (!resultsByType[resultType]) {
                resultsByType[resultType] = [];
            }
            resultsByType[resultType].push(result);
        });
        
        let html = `<div class="comprehensive-search-results">`;
        html += `<h4 class="mb-3">Search Results for "${escapeHtml(query)}"</h4>`;
        
        // Display results grouped by type
        Object.keys(resultsByType).forEach(resultType => {
            const typeResults = resultsByType[resultType];
            const typeLabel = resultType.charAt(0).toUpperCase() + resultType.slice(1);
            
            html += `<div class="mb-4"><h5>${typeLabel} (${typeResults.length})</h5>`;
            html += `<div class="list-group">`;
            
            typeResults.forEach(result => {
                const name = result.name || result.file_name || 'Unknown';
                let link = '#';
                if (resultType === 'file') {
                    link = `/file/${result.id}`;
                } else if (resultType === 'category') {
                    link = `/category/${result.id}`;
                } else if (resultType === 'keyword') {
                    link = `/keywords/${result.id}`;
                } else if (resultType === 'source') {
                    link = `/source/${result.id}`;
                } else if (resultType === 'side') {
                    link = `/side/${result.id}`;
                }
                
                html += `
                    <div class="list-group-item">
                        <a href="${link}" class="text-decoration-none">
                            ${escapeHtml(name)}
                        </a>
                        ${result.relevance !== undefined ? `<span class="badge bg-info ms-2">Relevance: ${result.relevance.toFixed(2)}</span>` : ''}
                    </div>
                `;
            });
            
            html += `</div></div>`;
        });
        
        html += `</div>`;
        contentView.innerHTML = html;
    }

    function setViewMode(mode) {
        navigationState.currentView = mode;
        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-view') === mode) {
                btn.classList.add('active');
            }
        });
        applyViewMode();
    }

    function applyViewMode() {
        const currentState = navigationState.history[navigationState.currentIndex];
        if (currentState && currentState.type === 'section') {
            loadSectionView(currentState.section);
        }
    }

    // Utility functions
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    // File utility functions
    function previewFile(fileId) {
        window.open(`/file/${fileId}`, '_blank');
    }

    function exportFile(fileId) {
        const link = document.createElement('a');
        link.href = `/api/files/${fileId}/export`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Event delegation for explorer items, file rows, and file details buttons
    // Use capture phase to catch events early
    document.addEventListener('click', function(e) {
        console.log('Global click event:', e.target, e.target.closest('.file-row-item'));
        
        // Check for preview/view details buttons on files FIRST (before other handlers)
        const previewBtn = e.target.closest('.preview-btn[data-file-id]');
        if (previewBtn) {
            const fileId = previewBtn.getAttribute('data-file-id');
            const fileName = previewBtn.getAttribute('data-file-name');
            const fileIndex = previewBtn.getAttribute('data-file-index');
            if (fileId) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log('✅ Clicked preview button:', { fileId, fileName, fileIndex });
                
                // Get all files from current page for navigation
                const fileRows = document.querySelectorAll('.file-row-item[data-file-id]');
                const filesList = Array.from(fileRows).map(row => ({
                    id: parseInt(row.getAttribute('data-file-id')),
                    name: row.getAttribute('data-file-name') || 'File'
                }));
                
                showFileDetails(parseInt(fileId), fileName || 'File', filesList, parseInt(fileIndex) || -1);
                return false;
            }
        }
        
        // Check for file row items (clicking on the row itself)
        // Exclude clicks on buttons, links, checkboxes, and action areas
        const fileRowItem = e.target.closest('.file-row-item[data-file-id]');
        if (fileRowItem) {
            // Don't handle if clicking on action buttons, links, or checkboxes
            if (e.target.closest('.file-row-actions') || 
                e.target.closest('.file-select-checkbox') ||
                e.target.closest('a') ||
                e.target.closest('button') ||
                e.target.tagName === 'A' ||
                e.target.tagName === 'BUTTON') {
                console.log('Click on action area, ignoring');
                return;
            }
            
            const fileId = fileRowItem.getAttribute('data-file-id');
            const fileName = fileRowItem.getAttribute('data-file-name');
            const fileIndex = fileRowItem.getAttribute('data-file-index');
            if (fileId) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                console.log('✅ Clicked file row:', { fileId, fileName, fileIndex });
                
                // Get all files from current page for navigation
                const fileRows = document.querySelectorAll('.file-row-item[data-file-id]');
                const filesList = Array.from(fileRows).map(row => ({
                    id: parseInt(row.getAttribute('data-file-id')),
                    name: row.getAttribute('data-file-name') || 'File'
                }));
                
                showFileDetails(parseInt(fileId), fileName || 'File', filesList, parseInt(fileIndex) || -1);
                return false;
            }
        }
        
        // Check for explorer items (categories, keywords, etc.)
        const explorerItem = e.target.closest('.explorer-item');
        if (explorerItem) {
            const section = explorerItem.getAttribute('data-section');
            const itemId = explorerItem.getAttribute('data-item-id');
            const itemName = explorerItem.getAttribute('data-item-name');
            const isGroup = explorerItem.getAttribute('data-is-group') === 'true';
            
            // ✅ NEW: Allow navigation for grouped titles - show files from all titles in the group
            if (isGroup && section === 'titles') {
                const groupTitleIds = explorerItem.getAttribute('data-group-title-ids');
                if (groupTitleIds) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Clicked grouped title, loading files from all titles in group:', { section, itemId, itemName, groupTitleIds });
                    loadGroupedTitleFiles(groupTitleIds, itemName || 'Grouped Titles');
                    return;
                }
            }
            
            // ✅ FIX: Handle grouped items (like title groups) - don't navigate to them (except titles which are handled above)
            if (isGroup) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Clicked grouped item (cannot navigate):', { section, itemId, itemName });
                // Optionally show a message or expand the group
                return;
            }
            
            if (section && itemId) {
                // ✅ FIX: Handle both numeric IDs and string IDs properly
                const parsedId = itemId.toString().startsWith('group_') ? null : parseInt(itemId);
                if (parsedId && !isNaN(parsedId)) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Clicked explorer item:', { section, itemId: parsedId, itemName });
                    navigateToItem(section, parsedId, itemName || 'Item');
                    return;
                } else {
                    console.warn('Invalid item ID for navigation:', { section, itemId, parsedId });
                }
            } else if (section && !itemId) {
                // This is a section card, not an item
                e.preventDefault();
                e.stopPropagation();
                console.log('Clicked section:', section);
                navigateToSection(section);
                return;
            }
        }
        
        // Check for file row items in list view (for category/keyword items)
        const fileRowItemSection = e.target.closest('.file-row-item[data-section]');
        if (fileRowItemSection) {
            const section = fileRowItemSection.getAttribute('data-section');
            const itemId = fileRowItemSection.getAttribute('data-item-id');
            const itemName = fileRowItemSection.getAttribute('data-item-name');
            const isGroup = fileRowItemSection.getAttribute('data-is-group') === 'true';
            
            // ✅ NEW: Allow navigation for grouped titles - show files from all titles in the group
            if (isGroup && section === 'titles') {
                const groupTitleIds = fileRowItemSection.getAttribute('data-group-title-ids');
                if (groupTitleIds) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Clicked grouped title in list view, loading files from all titles in group:', { section, itemId, itemName, groupTitleIds });
                    loadGroupedTitleFiles(groupTitleIds, itemName || 'Grouped Titles');
                    return;
                }
            }
            
            // ✅ FIX: Handle grouped items (like title groups) - don't navigate to them (except titles which are handled above)
            if (isGroup) {
                e.preventDefault();
                e.stopPropagation();
                console.log('Clicked grouped item (cannot navigate):', { section, itemId, itemName });
                return;
            }
            
            if (section && itemId) {
                // ✅ FIX: Handle both numeric IDs and string IDs properly
                const parsedId = itemId.toString().startsWith('group_') ? null : parseInt(itemId);
                if (parsedId && !isNaN(parsedId)) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Clicked file row item:', { section, itemId: parsedId, itemName });
                    navigateToItem(section, parsedId, itemName || 'Item');
                } else {
                    console.warn('Invalid item ID for navigation:', { section, itemId, parsedId });
                }
            }
        }
    });

    // Notification system for user feedback
    function showNotification(message, type = 'info', duration = 5000) {
        // Remove existing notifications
        const existing = document.querySelectorAll('.app-notification');
        existing.forEach(n => n.remove());

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `app-notification app-notification-${type}`;
        notification.setAttribute('role', 'alert');
        notification.setAttribute('aria-live', 'polite');
        
        const icons = {
            success: 'bi-check-circle-fill',
            error: 'bi-x-circle-fill',
            warning: 'bi-exclamation-triangle-fill',
            info: 'bi-info-circle-fill'
        };
        
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };

        notification.innerHTML = `
            <div class="notification-content">
                <i class="bi ${icons[type] || icons.info}" style="color: ${colors[type] || colors.info};"></i>
                <span>${escapeHtml(message)}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()" aria-label="Close">
                    <i class="bi bi-x"></i>
                </button>
            </div>
        `;

        // Add styles if not already added
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                .app-notification {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 100000;
                    min-width: 300px;
                    max-width: 500px;
                    background: white;
                    border-radius: 0.75rem;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
                    animation: slideInRight 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    border-left: 4px solid;
                }
                .app-notification-success { border-left-color: #10b981; }
                .app-notification-error { border-left-color: #ef4444; }
                .app-notification-warning { border-left-color: #f59e0b; }
                .app-notification-info { border-left-color: #3b82f6; }
                .notification-content {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 1rem 1.25rem;
                }
                .notification-content i:first-child {
                    font-size: 1.25rem;
                    flex-shrink: 0;
                }
                .notification-content span {
                    flex: 1;
                    color: #1e293b;
                    font-weight: 500;
                }
                .notification-close {
                    background: transparent;
                    border: none;
                    color: #64748b;
                    cursor: pointer;
                    padding: 0.25rem;
                    border-radius: 0.25rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                }
                .notification-close:hover {
                    background: #f1f5f9;
                    color: #1e293b;
                }
                @keyframes slideInRight {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => {
                notification.style.animation = 'slideInRight 0.3s cubic-bezier(0.4, 0, 0.2, 1) reverse';
                setTimeout(() => notification.remove(), 300);
            }, duration);
        }
    }

    // Initialize on page load
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM Content Loaded - Initializing navigation');
        console.log('Section data cache:', sectionDataCache);
        console.log('Section labels:', sectionLabels);
        
        // ✅ DEBUG: Log keyword count to verify all data is loaded
        if (sectionDataCache.keywords) {
            console.log(`✅ Keywords loaded: ${sectionDataCache.keywords.length} total keywords`);
            if (sectionDataCache.keywords.length < 100) {
                console.warn(`⚠️ WARNING: Only ${sectionDataCache.keywords.length} keywords loaded. Expected more.`);
            } else {
                console.log(`✅ All ${sectionDataCache.keywords.length} keywords loaded successfully`);
            }
        }
        
        // Initialize sort dropdown
        const sortSelect = document.getElementById('sortBy');
        if (sortSelect) {
            sortSelect.value = navigationState.sortBy || 'file_count_desc';
        }
        
        try {
            initNavigation();
            initializeCharts();
        } catch (error) {
            console.error('Error during initialization:', error);
            showNotification('Error initializing navigation: ' + error.message, 'error');
        }
    });

    // Legacy modal functions (kept for compatibility, but not used in new navigation)
    function openModal(section, id) {
        const modal = document.getElementById('fileModal');
        const modalTitle = document.getElementById('modalTitle');
        const modalBody = document.getElementById('modalBody');

        const loadingText = translations.loading || 'Loading...';
        const detailsText = translations.details || 'Details';
        const noDetailsText = translations.noDetailsAvailable || 'No details available';
        const errorText = translations.errorLoadingDetails || 'Error loading details';

        modalBody.innerHTML = '<div style="text-align: center; padding: 20px;">' + loadingText + '</div>';
        modal.classList.add('active');

        // Load details and files in parallel
        Promise.all([
            fetch(`/api/archives/details?section=${section}&id=${id}`).then(r => r.json()),
            fetch(`/api/archives/files?section=${section}&id=${id}`).then(r => r.json())
        ])
            .then(([detailsData, filesData]) => {
                if (detailsData.success && detailsData.details) {
                    const details = detailsData.details;
                    modalTitle.textContent = details.name || detailsText;
                    
                    let html = '';
                    
                    // Display details
                    for (const [key, value] of Object.entries(details)) {
                        if (key !== 'name' && key !== 'section') {
                            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                            html += `
                                <div class="info-row">
                                    <span class="info-label">${escapeHtml(label)}</span>
                                    <span class="info-value">${escapeHtml(String(value))}</span>
                                </div>
                            `;
                        }
                    }
                    
                    // Add analytics section
                    html += enhanceModalWithAnalytics(modalBody, section, id, details);
                    
                    // Add files section
                    if (filesData.success && filesData.files && filesData.files.length > 0) {
                        html += `
                            <div class="files-section">
                                <div class="files-section-header">
                                    <div class="files-section-title">(${filesData.files.length})</div>
                                </div>
                                <div class="file-list">
                        `;
                        
                        filesData.files.forEach(file => {
                            const fileSize = formatFileSize(file.size);
                            const fileDate = file.file_date ? new Date(file.file_date).toLocaleDateString() : 'N/A';
                            
                            html += `
                                <div class="file-item">
                                    <div class="file-info">
                                        <div class="file-name">${escapeHtml(file.name)}</div>
                                        <div class="file-meta">
                                            <span><i class="bi bi-file-earmark"></i> ${escapeHtml(file.type)}</span>
                                            <span><i class="bi bi-hdd"></i> ${escapeHtml(fileSize)}</span>
                                            <span><i class="bi bi-calendar"></i> ${escapeHtml(fileDate)}</span>
                                            <span><i class="bi bi-person"></i> ${escapeHtml(file.source)}</span>
                                        </div>
                                    </div>
                                    <div class="file-actions">
                                        <button class="action-btn preview-btn" onclick="previewFile(${file.id})" title="{{ _('Preview') }}">
                                            <i class="bi bi-eye"></i>
                                            <span>{{ _('Preview') }}</span>
                                        </button>
                                        <a href="/file/${file.id}" class="action-btn view-btn" target="_blank" title="{{ _('View') }}">
                                            <i class="bi bi-box-arrow-up-right"></i>
                                            <span>{{ _('View') }}</span>
                                        </a>
                                        <button class="action-btn export-btn" onclick="exportFile(${file.id})" title="{{ _('Export') }}">
                                            <i class="bi bi-download"></i>
                                            <span>{{ _('Export') }}</span>
                                        </button>
                                    </div>
                                </div>
                            `;
                        });
                        
                        html += `
                                </div>
                            </div>
                        `;
                    } else if (filesData.success && filesData.files && filesData.files.length === 0) {
                        html += `
                            <div class="files-section">
                                <div class="files-section-header">
                                    <div class="files-section-title">Files</div>
                                </div>
                                <div class="no-files">No files found</div>
                            </div>
                        `;
                    }
                    
                    modalBody.innerHTML = html || '<div class="empty-state">' + noDetailsText + '</div>';
                } else {
                    modalBody.innerHTML = '<div class="empty-state">' + errorText + '</div>';
                }
            })
            .catch(error => {
                console.error('Error loading details:', error);
                modalBody.innerHTML = '<div class="empty-state">' + errorText + '</div>';
            });
    }
    
    // File utility functions
    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }
    
    function previewFile(fileId) {
        // Open file detail page in a new tab for preview
        window.open(`/file/${fileId}`, '_blank');
    }
    
    function exportFile(fileId) {
        // Create export link and trigger download
        const link = document.createElement('a');
        link.href = `/api/files/${fileId}/export`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function closeModal() {
        document.getElementById('fileModal').classList.remove('active');
    }

    // Close modal on outside click
    const fileModal = document.getElementById('fileModal');
    if (fileModal) {
        fileModal.addEventListener('click', (e) => {
            if (e.target.id === 'fileModal') {
                closeModal();
            }
        });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    // Charts initialization
    let categoriesChart = null;
    let sourcesChart = null;
    let distributionChart = null;

    // Initialize charts when page loads
    // Note: These charts may not exist on all pages - they're only created if canvas elements exist
    document.addEventListener('DOMContentLoaded', function() {
        // Wait a bit for any dynamically loaded content
        setTimeout(() => {
            initializeCharts();
        }, 500);
    });

    function initializeCharts() {
        // Categories Chart - only create if canvas exists
        const catCtx = document.getElementById('categoriesChart');
        if (catCtx) {
            const categoryData = window.appData?.charts?.categoryDistribution || [];
            categoriesChart = new Chart(catCtx, {
                type: 'bar',
                data: {
                    labels: categoryData.slice(0, 10).map(c => c.name),
                    datasets: [{
                        label: translations.fileCount || 'File Count',
                        data: categoryData.slice(0, 10).map(c => c.file_count),
                        backgroundColor: 'rgba(102, 126, 234, 0.8)',
                        borderColor: 'rgba(102, 126, 234, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: false
                        },
                        title: {
                            display: true,
                            text: translations.topCategories || 'Top Categories by File Count'
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
            
            // Attach chart controls - wait for ChartExport to be available
            function attachControls() {
                if (window.ChartExport && window.ChartExport.attachExportButtonsToCharts) {
                    const chartContainer = catCtx.closest('.chart-container, .section-card, .chart-card, [class*="chart"]');
                    if (chartContainer) {
                        window.ChartExport.attachExportButtonsToCharts(chartContainer);
                    } else {
                        // Fallback: try to find parent container
                        const parent = catCtx.parentElement;
                        if (parent) {
                            window.ChartExport.attachExportButtonsToCharts(parent);
                        }
                    }
                } else {
                    // Retry if ChartExport not loaded yet
                    setTimeout(attachControls, 200);
                }
            }
            setTimeout(attachControls, 100);
        }

        // Sources Chart
        const srcCtx = document.getElementById('sourcesChart');
        if (srcCtx) {
            const sourceData = window.appData?.charts?.topSources || [];
            sourcesChart = new Chart(srcCtx, {
                type: 'doughnut',
                data: {
                    labels: sourceData.map(s => s.name),
                    datasets: [{
                        label: translations.fileCount || 'File Count',
                        data: sourceData.map(s => s.file_count),
                        backgroundColor: [
                            'rgba(102, 126, 234, 0.8)',
                            'rgba(240, 147, 251, 0.8)',
                            'rgba(79, 172, 254, 0.8)',
                            'rgba(67, 233, 123, 0.8)',
                            'rgba(250, 112, 154, 0.8)',
                            'rgba(48, 207, 208, 0.8)'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        title: {
                            display: true,
                            text: translations.topSources || 'Top Sources Distribution'
                        }
                    }
                }
            });
            
            // Attach chart controls - wait for ChartExport to be available
            function attachControls() {
                if (window.ChartExport && window.ChartExport.attachExportButtonsToCharts) {
                    const chartContainer = srcCtx.closest('.chart-container, .section-card, .chart-card, [class*="chart"]');
                    if (chartContainer) {
                        window.ChartExport.attachExportButtonsToCharts(chartContainer);
                    } else {
                        // Fallback: try to find parent container
                        const parent = srcCtx.parentElement;
                        if (parent) {
                            window.ChartExport.attachExportButtonsToCharts(parent);
                        }
                    }
                } else {
                    // Retry if ChartExport not loaded yet
                    setTimeout(attachControls, 200);
                }
            }
            setTimeout(attachControls, 100);
        }

        // Distribution Chart
        const distCtx = document.getElementById('distributionChart');
        if (distCtx) {
            const statsData = {
                categories: window.appData?.stats?.totalCategories || 0,
                keywords: window.appData?.stats?.totalKeywords || 0,
                sources: window.appData?.stats?.totalSources || 0,
                sides: window.appData?.stats?.totalSides || 0,
                hashes: window.appData?.stats?.totalHashes || 0
            };
            distributionChart = new Chart(distCtx, {
                type: 'pie',
                data: {
                    labels: [
                        translations.categories || 'Categories',
                        translations.keywords || 'Keywords',
                        translations.sources || 'Sources',
                        translations.sides || 'Sides',
                        translations.hashes || 'Hashes'
                    ],
                    datasets: [{
                        data: [
                            statsData.categories,
                            statsData.keywords,
                            statsData.sources,
                            statsData.sides,
                            statsData.hashes
                        ],
                        backgroundColor: [
                            'rgba(102, 126, 234, 0.8)',
                            'rgba(240, 147, 251, 0.8)',
                            'rgba(79, 172, 254, 0.8)',
                            'rgba(67, 233, 123, 0.8)',
                            'rgba(250, 112, 154, 0.8)'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        title: {
                            display: true,
                            text: translations.dataDistribution || 'Data Distribution'
                        }
                    }
                }
            });
            
            // Attach chart controls - wait for ChartExport to be available
            function attachControls() {
                if (window.ChartExport && window.ChartExport.attachExportButtonsToCharts) {
                    const chartContainer = distCtx.closest('.chart-container, .section-card, .chart-card, [class*="chart"]');
                    if (chartContainer) {
                        window.ChartExport.attachExportButtonsToCharts(chartContainer);
                    } else {
                        // Fallback: try to find parent container
                        const parent = distCtx.parentElement;
                        if (parent) {
                            window.ChartExport.attachExportButtonsToCharts(parent);
                        }
                    }
                } else {
                    // Retry if ChartExport not loaded yet
                    setTimeout(attachControls, 200);
                }
            }
            setTimeout(attachControls, 100);
        }
    }

    function showChart(chartType) {
        // Toggle the selected chart (allow multiple charts to be visible)
        const canvas = document.getElementById(chartType + 'Chart');
        const btn = document.querySelector(`[data-chart="${chartType}"]`);
        
        if (canvas && btn) {
            // Toggle chart visibility
            const isVisible = canvas.style.display !== 'none' && canvas.style.display !== '';
            canvas.style.display = isVisible ? 'none' : 'block';
            
            // Toggle active class on button
            if (isVisible) {
                btn.classList.remove('active');
            } else {
                btn.classList.add('active');
            }
        }
    }

    // Filter functions
    function showFilters() {
        document.getElementById('filtersPanel').style.display = 'block';
    }

    function hideFilters() {
        document.getElementById('filtersPanel').style.display = 'none';
    }

    //  IMPLEMENTED: Actual filter application with category, source, side, and date filtering
    function applyFilters() {
        const category = document.getElementById('filterCategory')?.value || '';
        const source = document.getElementById('filterSource')?.value || '';
        const side = document.getElementById('filterSide')?.value || '';
        const dateFrom = document.getElementById('filterDateFrom')?.value || '';
        const dateTo = document.getElementById('filterDateTo')?.value || '';
        
        // Store active filters
        navigationState.activeFilters = {
            category: category,
            source: source,
            side: side,
            dateFrom: dateFrom,
            dateTo: dateTo
        };
        
        // Apply filters to currently displayed items
        applyFiltersToDisplayedItems();
        
        // If in a section view, reload with filters
        const currentState = navigationState.history[navigationState.currentIndex];
        if (currentState && currentState.type === 'section') {
            // Reload section with filters applied
            loadSectionView(currentState.section, true);
        }
        
        showNotification(translations.filtersApplied || 'Filters applied!', 'success');
    }
    
    function applyFiltersToDisplayedItems() {
        const filters = navigationState.activeFilters || {};
        const categoryId = filters.category;
        const sourceId = filters.source;
        const sideId = filters.side;
        const dateFrom = filters.dateFrom;
        const dateTo = filters.dateTo;
        
        // Filter file rows
        const fileRows = document.querySelectorAll('.file-row-item[data-file-id]');
        fileRows.forEach(row => {
            let matches = true;
            
            if (categoryId) {
                const rowCategory = row.getAttribute('data-file-category');
                if (rowCategory !== categoryId) matches = false;
            }
            
            if (sourceId && matches) {
                const rowSource = row.getAttribute('data-file-source-id');
                if (rowSource !== sourceId) matches = false;
            }
            
            if (sideId && matches) {
                const rowSide = row.getAttribute('data-file-side-id');
                if (rowSide !== sideId) matches = false;
            }
            
            if (dateFrom && matches) {
                const rowDate = row.getAttribute('data-file-date');
                if (rowDate && rowDate < dateFrom) matches = false;
            }
            
            if (dateTo && matches) {
                const rowDate = row.getAttribute('data-file-date');
                if (rowDate && rowDate > dateTo) matches = false;
            }
            
            row.style.display = matches ? '' : 'none';
        });
        
        updateSearchResultsCount();
    }

    function resetFilters() {
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterSource').value = '';
        document.getElementById('filterSide').value = '';
        document.getElementById('filterDateFrom').value = '';
        document.getElementById('filterDateTo').value = '';
        
        // Clear active filters
        navigationState.activeFilters = {};
        
        // Show all items
        document.querySelectorAll('.file-row-item[data-file-id], .file-row-item[data-item-id]').forEach(item => {
            item.style.display = '';
        });
        
        // Restore original data
        ['category', 'keywords', 'titles', 'sources', 'sides', 'hash'].forEach(section => {
            const gridId = `${section}Grid`;
            const grid = document.getElementById(gridId);
            if (grid && originalData[section]) {
                grid.innerHTML = '';
                originalData[section].forEach(item => {
                    grid.appendChild(item.element.cloneNode(true));
                });
            }
        });
        
        updateSearchResultsCount();
        showNotification(translations.filtersReset || 'Filters reset!', 'info');
    }
    
    // Analysis functions
    function analyzeAll() {
        // Show comprehensive analysis
        window.open('/analysis/dashboard', '_blank');
    }

    function exportAllData() {
        // Export all data as JSON
        const exportData = {
            categories: window.appData?.data?.category || [],
            keywords: window.appData?.data?.keywords || [],
            sources: window.appData?.data?.sources || [],
            sides: window.appData?.data?.sides || [],
            stats: window.appData?.stats || {}
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analysis_export_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    function showComparison() {
        const message = 'Comparison tool - Select items to compare their statistics and relationships';
        if (window.showInfo) {
            window.showInfo(message);
        } else if (window.alert) {
            window.alert(message);
        }
        // TODO: Implement comparison modal
    }

    // Enhanced modal with analytics
    function enhanceModalWithAnalytics(modalBody, section, id, details) {
        // Add analytics section to modal
        let analyticsHtml = `
            <div class="analytics-section">
                <div class="files-section-title">${translations.analytics || 'Analytics'}</div>
                <div class="analytics-grid">
        `;
        
        // Add relevant analytics based on section
        if (section === 'category') {
            analyticsHtml += `
                <div class="analytics-card">
                    <div class="analytics-card-title">${translations.fileCount || 'File Count'}</div>
                    <div class="analytics-card-value">${details.file_count || 0}</div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card-title">${translations.wordCount || 'Word Count'}</div>
                    <div class="analytics-card-value">${details.word_count || 0}</div>
                </div>
            `;
        } else if (section === 'sources') {
            analyticsHtml += `
                <div class="analytics-card">
                    <div class="analytics-card-title">${translations.totalFiles || 'Total Files'}</div>
                    <div class="analytics-card-value">${details.file_count || 0}</div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card-title">${translations.country || 'Country'}</div>
                    <div class="analytics-card-value">${details.country || 'N/A'}</div>
                </div>
            `;
        } else if (section === 'sides') {
            analyticsHtml += `
                <div class="analytics-card">
                    <div class="analytics-card-title">${translations.importance || 'Importance'}</div>
                    <div class="analytics-card-value">${details.importance ? details.importance.toFixed(2) : '0.00'}</div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card-title">${translations.fileCount || 'File Count'}</div>
                    <div class="analytics-card-value">${details.file_count || 0}</div>
                </div>
            `;
        }
        
        analyticsHtml += `
                </div>
            </div>
        `;
        
        return analyticsHtml;
    }

    // ==================== Add Item Modal Functions ====================
    
    // Modal state management
    const addItemModalState = {
        source: { page: 1, perPage: 10, search: '', total: 0, totalPages: 0 },
        side: { page: 1, perPage: 10, search: '', total: 0, totalPages: 0 },
        keyword: { page: 1, perPage: 10, search: '', total: 0, totalPages: 0 },
        category: { page: 1, perPage: 10, search: '', total: 0, totalPages: 0 }
    };

    // Open add item modal
    function openAddItemModal(modalId, section) {
        console.log('openAddItemModal called', { modalId, section });
        const modal = document.getElementById(modalId);
        if (!modal) {
            console.error(`Modal ${modalId} not found`);
            showNotification(`Modal ${modalId} not found`, 'error');
            return;
        }
        console.log('Modal found, opening...', modalId);

        // Show modal with proper animation
        modal.style.display = 'flex';
        // Force reflow to ensure display is set before adding active class
        void modal.offsetWidth;
        modal.classList.add('active');
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
        document.body.style.overflow = 'hidden';
        
        // Focus trap - focus first input in modal
        setTimeout(() => {
            const firstInput = modal.querySelector('input[type="text"], input[type="number"], select, textarea');
            if (firstInput) {
                firstInput.focus();
            }
        }, 100);

        // Initialize modal based on section
        if (section === 'category') {
            initializeCategoryWordSelect();
            loadItemsForModal(section);
            // Trigger initial data load for Select2 dropdown after a short delay
            setTimeout(function() {
                const $select = $('#categoryName');
                if ($select.length && $select.data('select2')) {
                    const select2 = $select.data('select2');
                    if (select2 && select2.dataAdapter) {
                        // Manually trigger query to load initial data
                        select2.dataAdapter.query({
                            term: '',
                            page: 1
                        }, function(data) {
                            // Data will be processed by processResults
                        });
                    }
                }
            }, 200);
        } else if (section === 'keyword' || section === 'keywords') {
            console.log('Opening keyword modal, initializing Select2 dropdowns', { section });
            initializeKeywordWordsSelect();
            initializeKeywordCategorySelect();
            loadItemsForModal(section === 'keywords' ? 'keyword' : section);
            
            // ✅ FIXED: Force initial data load for both Select2 dropdowns after initialization
            setTimeout(function() {
                console.log('Checking Select2 initialization status...');
                // Trigger word select initial load
                const $wordSelect = $('#keywordWords');
                console.log('keywordWords element:', $wordSelect.length, 'Select2 instance:', !!$wordSelect.data('select2'));
                if ($wordSelect.length && $wordSelect.data('select2')) {
                    const wordSelect2 = $wordSelect.data('select2');
                    console.log('wordSelect2 dataAdapter:', !!wordSelect2.dataAdapter);
                    if (wordSelect2 && wordSelect2.dataAdapter) {
                        console.log('Triggering initial query for keywordWords');
                        wordSelect2.dataAdapter.query({
                            term: '',
                            page: 1
                        }, function(data) {
                            console.log('Initial query completed for keywordWords', data);
                            // Data will be processed by processResults
                        });
                    }
                } else {
                    console.warn('keywordWords Select2 not initialized yet');
                }
                
                // Trigger category select initial load
                const $categorySelect = $('#keywordCategory');
                console.log('keywordCategory element:', $categorySelect.length, 'Select2 instance:', !!$categorySelect.data('select2'));
                if ($categorySelect.length && $categorySelect.data('select2')) {
                    const categorySelect2 = $categorySelect.data('select2');
                    console.log('categorySelect2 dataAdapter:', !!categorySelect2.dataAdapter);
                    if (categorySelect2 && categorySelect2.dataAdapter) {
                        console.log('Triggering initial query for keywordCategory');
                        categorySelect2.dataAdapter.query({
                            term: '',
                            page: 1
                        }, function(data) {
                            console.log('Initial query completed for keywordCategory', data);
                            // Data will be processed by processResults
                        });
                    }
                } else {
                    console.warn('keywordCategory Select2 not initialized yet');
                }
            }, 200);
        } else if (section === 'words_categorys') {
            initializeWordsCategorysWordSelect();
            initializeWordsCategorysCategorySelect();
            
            // Force initial data load for both selects after initialization
            setTimeout(function() {
                // Trigger word select initial load
                const $wordSelect = $('#wordsCategorysWordId');
                if ($wordSelect.length && $wordSelect.data('select2')) {
                    const wordSelect2 = $wordSelect.data('select2');
                    if (wordSelect2 && wordSelect2.dataAdapter) {
                        console.log('Forcing initial words load on modal open...');
                        wordSelect2.dataAdapter.query({
                            term: '',
                            page: 1
                        }, function(data) {
                            console.log('Forced words load result:', data);
                        });
                    }
                }
                
                // Trigger category select initial load
                const $categorySelect = $('#wordsCategorysCategoryId');
                if ($categorySelect.length && $categorySelect.data('select2')) {
                    const categorySelect2 = $categorySelect.data('select2');
                    if (categorySelect2 && categorySelect2.dataAdapter) {
                        console.log('Forcing initial categories load on modal open...');
                        categorySelect2.dataAdapter.query({
                            term: '',
                            page: 1
                        }, function(data) {
                            console.log('Forced categories load result:', data);
                        });
                    }
                }
            }, 500);
        } else {
            // Load items for the section
            loadItemsForModal(section);
        }
    }

    // Close add item modal
    function closeAddItemModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        // Remove active class first for animation
        modal.classList.remove('active');
        
        // Wait for animation to complete before hiding
        setTimeout(() => {
            modal.style.display = 'none';
            modal.style.visibility = 'hidden';
            modal.style.opacity = '0';
        }, 300);
        
        document.body.style.overflow = '';

        // Reset form - check if it's an actual form element, otherwise manually clear fields
        const form = modal.querySelector('.add-item-form');
        if (form) {
            // Check if it's an actual form element with reset() method
            if (form.tagName === 'FORM' && typeof form.reset === 'function') {
                form.reset();
            } else {
                // For div-based forms, manually clear Select2 fields and inputs
                const selects = form.querySelectorAll('select');
                selects.forEach(select => {
                    if ($(select).hasClass('select2-hidden-accessible')) {
                        $(select).val(null).trigger('change');
                    } else {
                        select.value = '';
                    }
                });
                const inputs = form.querySelectorAll('input[type="text"], input[type="number"], input[type="email"], textarea');
                inputs.forEach(input => {
                    input.value = '';
                });
            }
        }

        // Destroy Select2 instances
        if ($('#categoryName').hasClass('select2-hidden-accessible')) {
            $('#categoryName').select2('destroy');
        }
        if ($('#keywordWords').hasClass('select2-hidden-accessible')) {
            $('#keywordWords').select2('destroy');
        }
        if ($('#keywordCategory').hasClass('select2-hidden-accessible')) {
            $('#keywordCategory').select2('destroy');
        }
        if ($('#wordsCategorysWordId').hasClass('select2-hidden-accessible')) {
            $('#wordsCategorysWordId').select2('destroy');
        }
        if ($('#wordsCategorysCategoryId').hasClass('select2-hidden-accessible')) {
            $('#wordsCategorysCategoryId').select2('destroy');
        }

        // Reset state
        const section = modalId.replace('add', '').replace('Modal', '').toLowerCase();
        if (addItemModalState[section]) {
            addItemModalState[section].page = 1;
            addItemModalState[section].search = '';
        }
    }

  
    // Load items for modal list
    function loadItemsForModal(section, page = 1, search = '') {
        const listId = `${section}List`;
        const listElement = document.getElementById(listId);
        if (!listElement) {
            console.warn(`List element ${listId} not found for section ${section}`);
            return;
        }

        // Update state
        if (addItemModalState[section]) {
            addItemModalState[section].page = page;
            addItemModalState[section].search = search;
        }

        // Show loading
        listElement.innerHTML = '<div class="empty-state" style="padding: 2rem; text-align: center; color: #64748b;">Loading...</div>';

        // Build API URL based on section
        let apiUrl = '';
        const params = new URLSearchParams();
        params.set('page', page);
        params.set('per_page', addItemModalState[section]?.perPage || 10);
        
        if (search) {
            params.set('q', search);
        }

        switch(section) {
            case 'source':
                apiUrl = `/api/sources?${params.toString()}`;
                break;
            case 'side':
                apiUrl = `/api/sides?${params.toString()}`;
                break;
            case 'keyword':
            case 'keywords':
                apiUrl = `/api/keywords?${params.toString()}`;
                break;
            case 'category':
                apiUrl = `/api/categories?${params.toString()}`;
                break;
            default:
                console.error(`Unknown section: ${section}`);
                return;
        }

        // Fetch items
        fetch(apiUrl)
            .then(response => response.json())
            .then(data => {
                let items = [];
                let total = 0;
                let totalPages = 1;

                // Handle different response formats
                if (Array.isArray(data)) {
                    items = data;
                    total = data.length;
                } else if (data.results || data.items) {
                    items = data.results || data.items || [];
                    total = data.total || items.length;
                    totalPages = data.total_pages || Math.ceil(total / (addItemModalState[section]?.perPage || 10));
                } else if (data.keywords) {
                    // Keywords API format
                    items = data.keywords || [];
                    total = data.total || 0;
                    totalPages = data.total_pages || 1;
                } else if (data.success && data.keywords) {
                    items = data.keywords || [];
                    total = data.total || 0;
                    totalPages = data.total_pages || 1;
                }

                // Update state
                if (addItemModalState[section]) {
                    addItemModalState[section].total = total;
                    addItemModalState[section].totalPages = totalPages;
                }

                // Render items
                renderItemsList(listId, items, section);
                
                // Update pagination info
                const paginationInfo = document.getElementById(`${section}PaginationInfo`);
                if (paginationInfo) {
                    paginationInfo.textContent = `Page ${page} of ${totalPages} (${total} total)`;
                }
            })
            .catch(error => {
                console.error(`Error loading items for ${section}:`, error);
                listElement.innerHTML = `<div class="empty-state" style="padding: 2rem; text-align: center; color: #ef4444;">Error loading items: ${error.message}</div>`;
            });
    }

    // Render items list
    function renderItemsList(listId, items, section) {
        const listElement = document.getElementById(listId);
        if (!listElement) return;

        if (items.length === 0) {
            listElement.innerHTML = `<div class="empty-state" style="padding: 2rem; text-align: center; color: #64748b;">${translations.noItemsFound || 'No items found'}</div>`;
            return;
        }

        let html = '';
        items.forEach(item => {
            const name = item.name || item.text || item.word || 'Unnamed';
            const details = getItemDetailsForList(item, section);
            html += `
                <div class="add-item-list-item" data-id="${item.id}">
                    <div class="add-item-list-item-name">${name}</div>
                    ${details ? `<div class="add-item-list-item-details">${details}</div>` : ''}
                </div>
            `;
        });

        listElement.innerHTML = html;
    }

    // Handle different response formats for category modal
    function processCategoryResponse(data) {
        // Handle both array and object response formats
        let items = [];
        let total = 0;
        let totalPages = 1;
        
        if (Array.isArray(data)) {
            items = data;
            total = data.length;
        } else if (data.results || data.items) {
            items = data.results || data.items || [];
            total = data.total || data.pagination?.total || items.length;
            totalPages = data.total_pages || data.pagination?.total_pages || Math.ceil(total / addItemModalState.category.perPage);
        }
        
        return { items, total, totalPages };
    }

    // Get item details for list display
    function getItemDetailsForList(item, section) {
        if (section === 'source') {
            const parts = [];
            if (item.job) parts.push(item.job);
            if (item.country) parts.push(item.country);
            return parts.join(' • ') || null;
        } else if (section === 'side') {
            return item.importance ? `Importance: ${item.importance}` : null;
        } else if (section === 'keyword') {
            return item.category_name ? `Category: ${item.category_name}` : null;
        } else if (section === 'category') {
            return item.file_count ? `${item.file_count} files` : null;
        }
        return null;
    }


    // Search items with debounce
    let searchTimeout;
    function searchItems(section) {
        const searchInput = document.getElementById(`${section}SearchInput`);
        if (!searchInput) return;

        const searchTerm = searchInput.value.trim();
        
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadItemsForModal(section, 1, searchTerm);
        }, 300);
    }

    // Submit add item form
    async function submitAddItem(section) {
        const modalId = `add${section.charAt(0).toUpperCase() + section.slice(1)}Modal`;
        const submitBtn = document.querySelector(`#${modalId} .add-item-btn-submit`);
        const originalBtnText = submitBtn ? submitBtn.textContent : '';
        
        try {
            // Show loading state
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<i class="bi bi-arrow-repeat" style="animation: spin 1s linear infinite;"></i> ${translations.submitting || 'Submitting...'}`;
            }

            let data = {};
            let apiUrl = '';

            switch(section) {
                case 'source':
                    const sourceName = document.getElementById('sourceName').value.trim();
                    if (!sourceName) {
                        showNotification(translations.sourceNameRequired || 'Source name is required', 'error');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = originalBtnText;
                        }
                        return;
                    }
                    
                    // Helper function to convert empty strings to null for enum fields
                    const toNullIfEmpty = (value) => {
                        const trimmed = typeof value === 'string' ? value.trim() : value;
                        return trimmed === '' ? null : trimmed;
                    };
                    
                    // Get all form values
                    const ownershipValue = document.getElementById('sourceOwnership')?.value || '';
                    const accessStatusValue = document.getElementById('sourceAccessStatus')?.value || '';
                    const dateDiscoveryValue = document.getElementById('sourceDateDiscovery')?.value || '';
                    const categoryValue = document.getElementById('sourceCategory')?.value || '';
                    
                    data = {
                        name: sourceName,
                        job: document.getElementById('sourceJob').value.trim(),
                        country: document.getElementById('sourceCountry').value.trim(),
                        city: document.getElementById('sourceCity').value.trim(),
                        importance: parseFloat(document.getElementById('sourceImportance').value) || 0.5,
                        description: document.getElementById('sourceDescription').value.trim(),
                        accounts: document.getElementById('sourceAccounts')?.value.trim() || '',
                        note: document.getElementById('sourceNote')?.value.trim() || '',
                        attachments: document.getElementById('sourceAttachments')?.value.trim() || '',
                        ownership: toNullIfEmpty(ownershipValue),
                        access_status: toNullIfEmpty(accessStatusValue),
                        date_source_discovery: dateDiscoveryValue || null,
                        category_id: categoryValue ? parseInt(categoryValue) : null
                    };
                    apiUrl = '/api/sources';
                    break;

                case 'side':
                    const sideName = document.getElementById('sideName').value.trim();
                    if (!sideName) {
                        showNotification(translations.sideNameRequired || 'Side name is required', 'error');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = originalBtnText;
                        }
                        return;
                    }
                    data = {
                        name: sideName,
                        importance: parseFloat(document.getElementById('sideImportance').value) || 0.5
                    };
                    apiUrl = '/api/sides';
                    break;

                case 'keyword':
                    const selectedWords = $('#keywordWords').val();
                    if (!selectedWords || selectedWords.length === 0) {
                        showNotification(translations.atLeastOneWordRequired || 'At least one word is required', 'error');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = originalBtnText;
                        }
                        return;
                    }
                    
                    // ✅ FIXED: Keywords must be multi-word phrases (at least 2 words)
                    const wordsArray = Array.isArray(selectedWords) ? selectedWords : [selectedWords];
                    if (wordsArray.length < 2) {
                        showNotification(translations.keywordRequiresMultipleWords || 'Keywords must contain at least 2 words. Please select multiple words to create a keyword phrase.', 'error');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = originalBtnText;
                        }
                        return;
                    }
                    
                    const categoryId = $('#keywordCategory').val();
                    // ✅ FIXED: Combine selected words into a single phrase
                    // Keywords are multi-word phrases, so we combine all selected words
                    const keywordPhrase = wordsArray.join(' ');
                    
                    // Create FormData for form submission
                    const formData = new FormData();
                    formData.append('keywords_text', keywordPhrase);
                    formData.append('category_id', categoryId || '1');
                    
                    // Use form data instead of JSON for this endpoint
                    apiUrl = '/keywords/add';
                    // Special handling for keyword - use FormData
                    // ✅ SECURITY: Get CSRF token with fallback
                    let csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
                    
                    // If no token in meta tag, fetch from API
                    if (!csrfToken) {
                        try {
                            const tokenResponse = await fetch('/api/csrf-token');
                            if (!tokenResponse.ok) {
                                throw new Error(`Failed to fetch CSRF token: ${tokenResponse.status} ${tokenResponse.statusText}`);
                            }
                            const tokenData = await tokenResponse.json();
                            csrfToken = tokenData.csrf_token || '';
                        } catch (error) {
                            console.error('Error fetching CSRF token:', error);
                            showNotification(translations.csrfTokenError || 'Unable to retrieve security token. Please refresh the page and try again.', 'error');
                            if (submitBtn) {
                                submitBtn.disabled = false;
                                submitBtn.textContent = originalBtnText;
                            }
                            return;
                        }
                    }
                    
                    if (!csrfToken) {
                        showNotification(translations.csrfTokenErrorShort || translations.csrfTokenError || 'Unable to obtain security token. Please refresh the page.', 'error');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = originalBtnText;
                        }
                        return;
                    }
                    
                    // Add CSRF token to FormData
                    formData.append('csrf_token', csrfToken);
                    // ✅ FIXED: Add header to indicate AJAX request for JSON response
                    let keywordResponse;
                    try {
                        keywordResponse = await fetch(apiUrl, {
                            method: 'POST',
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest',
                                'X-CSRFToken': csrfToken
                            },
                            body: formData
                        });
                    } catch (networkError) {
                        console.error(`Network error submitting keyword:`, networkError);
                        showNotification(translations.networkError || 'Network error: Unable to connect to server. Please check your connection and try again.', 'error');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = originalBtnText;
                        }
                        return;
                    }
                    
                    // ✅ FIXED: Handle both JSON and HTML redirect responses with improved error handling
                    const contentType = keywordResponse.headers.get('content-type');
                    if (keywordResponse.ok) {
                        if (contentType && contentType.includes('application/json')) {
                            // JSON response (AJAX)
                            let result;
                            try {
                                const responseText = await keywordResponse.text();
                                if (!responseText) {
                                    throw new Error('Empty response from server');
                                }
                                result = JSON.parse(responseText);
                        } catch (parseError) {
                            console.error('Error parsing keyword response:', parseError);
                            showNotification(translations.errorProcessingResponse || 'Error processing server response. Please try again or refresh the page.', 'error');
                            if (submitBtn) {
                                submitBtn.disabled = false;
                                submitBtn.textContent = originalBtnText;
                            }
                            return;
                        }
                            
                            if (result.success !== false) {
                                // Use specific success message for keywords
                                const successMessage = result.message || translations.keywordCreatedSuccessfully || translations.successfullyAdded + ' keyword!';
                                showNotification(successMessage, 'success');
                                closeAddItemModal(modalId);
                                
                                // ✅ Complete page reload with cache-busting
                                setTimeout(() => {
                                    window.location.href = window.location.pathname + '?t=' + Date.now();
                                }, 500);
                            } else {
                                const errorMsg = result.error || result.message || translations.errorAddingKeyword || translations.errorAdding + ' keyword';
                                showNotification(errorMsg, 'error');
                            }
                        } else {
                            // HTML redirect response (form submission)
                            const successMessage = translations.keywordCreatedSuccessfully || translations.successfullyAdded + ' keyword!';
                            showNotification(successMessage, 'success');
                            closeAddItemModal(modalId);
                            
                            // Reload the page data
                            if (typeof loadArchivesData === 'function') {
                                loadArchivesData();
                            }
                            
                            // Reload current view
                            if (navigationState.currentSection) {
                                navigateToSection(navigationState.currentSection);
                            } else {
                                navigateToRoot();
                            }
                        }
                    } else {
                        // Try to parse error from response
                        let errorMsg = `${translations.errorAdding || 'Error adding'} ${section}`;
                        try {
                            if (contentType && contentType.includes('application/json')) {
                                const responseText = await keywordResponse.text();
                                if (responseText) {
                                    const result = JSON.parse(responseText);
                                    errorMsg = result.error || result.message || errorMsg;
                                }
                            } else {
                                const text = await keywordResponse.text();
                                // Try to extract error from HTML if possible
                                errorMsg = text.substring(0, 200) || errorMsg;
                            }
                        } catch (e) {
                            console.error('Error parsing error response:', e);
                            // Use default error message
                        }
                        showNotification(errorMsg, 'error');
                    }
                    
                    // Restore button state
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalBtnText;
                    }
                    return; // Exit early for keyword case

                case 'category':
                    const categoryName = $('#categoryName').val();
                    if (!categoryName || !categoryName.trim()) {
                        showNotification(translations.categoryNameRequired || 'Category name is required', 'error');
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = originalBtnText;
                        }
                        return;
                    }
                    data = {
                        category_name: categoryName.trim()
                    };
                    apiUrl = '/category/add';
                    break;

                default:
                    console.error(`Unknown section: ${section}`);
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalBtnText;
                    }
                    return;
            }

            // ✅ SECURITY: Get CSRF token with fallback
            let csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
            
            // If no token in meta tag, fetch from API
            if (!csrfToken) {
                try {
                    const tokenResponse = await fetch('/api/csrf-token');
                    if (!tokenResponse.ok) {
                        throw new Error(`Failed to fetch CSRF token: ${tokenResponse.status} ${tokenResponse.statusText}`);
                    }
                    const tokenData = await tokenResponse.json();
                    csrfToken = tokenData.csrf_token || '';
                } catch (error) {
                    console.error('Error fetching CSRF token:', error);
                    showNotification(translations.csrfTokenError || 'Unable to retrieve security token. Please refresh the page and try again.', 'error');
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalBtnText;
                    }
                    return;
                }
            }
            
            if (!csrfToken) {
                showNotification(translations.csrfTokenErrorShort || translations.csrfTokenError || 'Unable to obtain security token. Please refresh the page.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
                return;
            }
            
            // Ensure data is sent to database with proper error handling
            let response;
            try {
                response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify(data)
                });
            } catch (networkError) {
                console.error(`Network error submitting ${section}:`, networkError);
                showNotification(translations.networkError || 'Network error: Unable to connect to server. Please check your connection and try again.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
                return;
            }

            // Parse response with error handling
            let result;
            try {
                const responseText = await response.text();
                if (!responseText) {
                    throw new Error('Empty response from server');
                }
                result = JSON.parse(responseText);
            } catch (parseError) {
                console.error(`Error parsing response for ${section}:`, parseError);
                showNotification(translations.errorProcessingResponse || 'Error processing server response. Please try again or refresh the page.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
                return;
            }

            if (response.ok && (result.success !== false)) {
                // Use specific success messages based on section
                let successMessage = result.message;
                if (!successMessage) {
                    switch(section) {
                        case 'source':
                            successMessage = translations.sourceCreatedSuccessfully || translations.successfullyAdded + ' source!';
                            break;
                        case 'side':
                            successMessage = translations.sideCreatedSuccessfully || translations.successfullyAdded + ' side!';
                            break;
                        case 'keyword':
                            successMessage = translations.keywordCreatedSuccessfully || translations.successfullyAdded + ' keyword!';
                            break;
                        case 'category':
                            successMessage = translations.categoryCreatedSuccessfully || translations.successfullyAdded + ' category!';
                            break;
                        default:
                            successMessage = translations.successfullyAdded + ' ' + section + '!';
                    }
                }
                showNotification(successMessage, 'success');
                closeAddItemModal(modalId);
                
                // ✅ Complete page reload with cache-busting
                setTimeout(() => {
                    window.location.href = window.location.pathname + '?t=' + Date.now();
                }, 500);
            } else {
                // Use specific error messages based on section
                let errorMsg = result.error || result.message;
                if (!errorMsg) {
                    switch(section) {
                        case 'source':
                            errorMsg = translations.errorAddingSource || translations.errorAdding + ' source';
                            break;
                        case 'side':
                            errorMsg = translations.errorAddingSide || translations.errorAdding + ' side';
                            break;
                        case 'keyword':
                            errorMsg = translations.errorAddingKeyword || translations.errorAdding + ' keyword';
                            break;
                        case 'category':
                            errorMsg = translations.errorAddingCategory || translations.errorAdding + ' category';
                            break;
                        default:
                            errorMsg = translations.errorAdding + ' ' + section;
                    }
                }
                showNotification(errorMsg, 'error');
            }
        } catch (error) {
            console.error(`Error submitting ${section}:`, error);
            // Use specific error messages based on section
            let errorMsg;
            switch(section) {
                case 'source':
                    errorMsg = translations.errorAddingSource || translations.errorAdding + ' source';
                    break;
                case 'side':
                    errorMsg = translations.errorAddingSide || translations.errorAdding + ' side';
                    break;
                case 'keyword':
                    errorMsg = translations.errorAddingKeyword || translations.errorAdding + ' keyword';
                    break;
                case 'category':
                    errorMsg = translations.errorAddingCategory || translations.errorAdding + ' category';
                    break;
                default:
                    errorMsg = translations.errorAdding + ' ' + section;
            }
            showNotification(`${errorMsg}: ${error.message}`, 'error');
        } finally {
            // Restore button state
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
        }
    }

    // Initialize category word select (Select2)
    function initializeCategoryWordSelect() {
        // Check if jQuery and Select2 are available
        if (typeof jQuery === 'undefined' || typeof jQuery.fn.select2 === 'undefined') {
            console.error('jQuery or Select2 is not loaded. Cannot initialize Select2.');
            setTimeout(initializeCategoryWordSelect, 200);
            return;
        }
        
        // Destroy existing Select2 if it exists
        if ($('#categoryName').hasClass('select2-hidden-accessible')) {
            $('#categoryName').select2('destroy');
        }

        $('#categoryName').select2({
            placeholder: translations.placeholderSearchWord || 'Type to search for a word...',
            allowClear: true,
            width: '100%',
            minimumInputLength: 0, // Show initial data without typing
            language: {
                inputTooShort: function() {
                    return ''; // Allow empty input
                }
            },
            ajax: {
                url: '/api/words/search',
                dataType: 'json',
                delay: 300,
                data: function (params) {
                    return {
                        q: params.term || '', // Allow empty search to show initial data
                        page: params.page || 1,
                        per_page: 20
                    };
                },
                processResults: function (data, params) {
                    params.page = params.page || 1;
                    
                    // Fix: Use correct mapping from API response
                    const results = (data.results || []).map(function(item) {
                        // API returns: id (word_id), text/word (word text), usage_count
                        const wordText = item.text || item.word || String(item.id);
                        return {
                            id: wordText, // Use word text as id for category name
                            text: wordText, // Display word text
                            usage_count: item.usage_count || 0
                        };
                    });
                    
                    return {
                        results: results,
                        pagination: {
                            more: (params.page * 20) < (data.pagination?.total || 0)
                        }
                    };
                },
                cache: true
            },
            templateResult: function (data) {
                if (data.loading) {
                    return data.text || 'Searching...';
                }
                
                const $result = $('<span>' + escapeHtml(data.text) + '</span>');
                if (data.usage_count && data.usage_count > 0) {
                    $result.append(' <small class="text-muted">' + data.usage_count + ' files</small>');
                }
                return $result;
            },
            templateSelection: function (data) {
                // Handle both object and string formats
                if (typeof data === 'string') {
                    return data;
                }
                if (data && data.text) {
                    return data.text;
                }
                if (data && data.id) {
                    return data.id;
                }
                return data || '';
            },
            escapeMarkup: function (markup) {
                return markup;
            }
        });
        
        // Load initial data when dropdown is opened
        $('#categoryName').on('select2:open', function() {
            const $select = $(this);
            const select2 = $select.data('select2');
            if (select2 && select2.dataAdapter) {
                // Get the search input value (empty for initial load)
                const searchInput = select2.$dropdown.find('input.select2-search__field');
                const searchTerm = searchInput.length ? searchInput.val() || '' : '';
                
                // Trigger query to load initial data
                setTimeout(function() {
                    if (select2.dataAdapter && !select2.dataAdapter._currentRequest) {
                        select2.dataAdapter.query({
                            term: searchTerm,
                            page: 1
                        }, function(data) {
                            // Data will be processed by processResults automatically
                        });
                    }
                }, 50);
            }
        });
        
        // Also trigger initial load when modal opens (if dropdown is already visible)
        $('#categoryName').on('focus', function() {
            const $select = $(this);
            const select2 = $select.data('select2');
            if (select2 && select2.dataAdapter) {
                // Check if we need to load initial data
                const $container = $select.next('.select2-container');
                const $results = $container.find('.select2-results__options');
                if ($results.length === 0 || $results.children().length === 0) {
                    select2.dataAdapter.query({
                        term: '',
                        page: 1
                    }, function(data) {
                        // Data will be processed by processResults
                    });
                }
            }
        });
        
        // Ensure selected value is properly displayed
        $('#categoryName').on('select2:select', function(e) {
            const data = e.params.data;
            // Force update the display
            const $select = $(this);
            setTimeout(function() {
                $select.trigger('change.select2');
            }, 10);
        });
    }

    // Initialize keyword words select (Select2 multi-select)
    function initializeKeywordWordsSelect() {
        console.log('initializeKeywordWordsSelect called');
        
        // Check if jQuery and Select2 are available
        if (typeof jQuery === 'undefined' || typeof jQuery.fn.select2 === 'undefined') {
            console.error('jQuery or Select2 is not loaded. Cannot initialize Select2.');
            setTimeout(initializeKeywordWordsSelect, 200);
            return;
        }
        
        const $select = $('#keywordWords');
        if ($select.length === 0) {
            console.warn('keywordWords select element not found');
            return;
        }
        
        console.log('Initializing keywordWords Select2, element found:', $select.length);
        
        // Destroy existing Select2 if it exists
        if ($select.hasClass('select2-hidden-accessible')) {
            console.log('Destroying existing Select2 instance');
            $select.select2('destroy');
        }

        console.log('Creating Select2 instance for keywordWords');
        $select.select2({
            placeholder: translations.placeholderSearchAndSelectWords || "Type to search and select words...",
            allowClear: true,
            width: '100%',
            multiple: true,
            minimumInputLength: 0, // Changed to 0 to show initial data
            ajax: {
                url: '/api/words/search',
                dataType: 'json',
                delay: 300,
                data: function (params) {
                    return {
                        q: params.term || '', // Allow empty search to show initial data
                        page: params.page || 1,
                        per_page: 20
                    };
                },
                processResults: function (data, params) {
                    params.page = params.page || 1;
                    
                    // ✅ FIXED: Use word text as id (not word_id) since we combine words into phrases
                    const results = (data.results || []).map(function(item) {
                        // Use the actual word text as the id for keyword phrases
                        const wordText = item.word || item.text || String(item.id || '');
                        return {
                            id: wordText,  // Use word text, not word_id
                            text: wordText,
                            word: wordText,
                            usage_count: item.usage_count || 0
                        };
                    });
                    
                    console.log('Keyword words Select2: Processed', results.length, 'results');
                    
                    return {
                        results: results,
                        pagination: {
                            more: (params.page * 20) < (data.pagination?.total || 0)
                        }
                    };
                },
                transport: function (params, success, failure) {
                    // ✅ FIXED: Add error handling and debugging
                    const $request = $.ajax(params).then(success).fail(function(jqXHR, textStatus, errorThrown) {
                        console.error('Keyword words Select2 AJAX error:', {
                            url: params.url,
                            status: jqXHR.status,
                            statusText: textStatus,
                            error: errorThrown,
                            response: jqXHR.responseText
                        });
                        failure(jqXHR, textStatus, errorThrown);
                    });
                    return $request;
                },
                cache: true
            },
            templateResult: function (data) {
                if (data.loading) {
                    return data.text;
                }
                
                const $result = $('<span>' + escapeHtml(data.text) + '</span>');
                if (data.usage_count && data.usage_count > 0) {
                    $result.append(' <small class="text-muted">' + data.usage_count + ' files</small>');
                }
                return $result;
            },
            templateSelection: function (data) {
                // Handle both object and string formats
                if (typeof data === 'string') {
                    return data;
                }
                if (data && data.text) {
                    return data.text;
                }
                if (data && data.id) {
                    return data.id;
                }
                return data || '';
            },
            escapeMarkup: function (markup) {
                return markup;
            }
        });
        
        console.log('Select2 instance created for keywordWords');
        
        // Load initial data when dropdown is opened
        $select.on('select2:open', function() {
            const $thisSelect = $(this);
            const select2 = $thisSelect.data('select2');
            console.log('Keyword words Select2 opened', { select2: !!select2, hasAdapter: !!(select2 && select2.dataAdapter) });
            
            if (select2 && select2.dataAdapter) {
                // Always trigger query when opened to ensure data is loaded
                setTimeout(function() {
                    if (select2.dataAdapter && !select2.dataAdapter._currentRequest) {
                        console.log('Triggering keyword words Select2 query');
                        select2.dataAdapter.query({
                            term: '',
                            page: 1
                        }, function(data) {
                            console.log('Keyword words Select2 query completed', data);
                            // Data will be processed by processResults
                        });
                    } else {
                        console.log('Keyword words Select2: Request already in progress or adapter not available');
                    }
                }, 100);
            } else {
                console.warn('Keyword words Select2: select2 or dataAdapter not available');
            }
        });
        
    }

    // Initialize keyword category select (Select2 - searchable categories)
    function initializeKeywordCategorySelect() {
        console.log('initializeKeywordCategorySelect called');
        
        // Check if jQuery and Select2 are available
        if (typeof jQuery === 'undefined' || typeof jQuery.fn.select2 === 'undefined') {
            console.error('jQuery or Select2 is not loaded. Cannot initialize Select2.');
            setTimeout(initializeKeywordCategorySelect, 200);
            return;
        }
        
        const $select = $('#keywordCategory');
        if ($select.length === 0) {
            console.warn('keywordCategory select element not found');
            return;
        }
        
        console.log('Initializing keywordCategory Select2, element found:', $select.length);
        
        // Destroy existing Select2 if it exists
        if ($select.hasClass('select2-hidden-accessible')) {
            console.log('Destroying existing Select2 instance');
            $select.select2('destroy');
        }

        console.log('Creating Select2 instance for keywordCategory');
        $select.select2({
            placeholder: translations.placeholderSearchCategory || "Type to search for a category...",
            allowClear: true,
            width: '100%',
            minimumInputLength: 0,
            ajax: {
                url: '/api/categories/search',
                dataType: 'json',
                delay: 300,
                data: function (params) {
                    return {
                        q: params.term || '',
                        page: params.page || 1,
                        per_page: 20
                    };
                },
                processResults: function (data, params) {
                    params.page = params.page || 1;
                    
                    // Handle both array and object response formats
                    let items = [];
                    if (Array.isArray(data)) {
                        items = data;
                    } else if (data.results || data.items) {
                        items = data.results || data.items || [];
                    }
                    
                    const results = items.map(function(item) {
                        return {
                            id: item.id,
                            text: item.name || item.word || 'Unnamed',
                            file_count: item.file_count || 0
                        };
                    });
                    
                    const total = data.total || data.pagination?.total || items.length;
                    
                    console.log('Keyword category Select2: Processed', results.length, 'results');
                    
                    return {
                        results: results,
                        pagination: {
                            more: (params.page * 20) < total
                        }
                    };
                },
                transport: function (params, success, failure) {
                    // ✅ FIXED: Add error handling and debugging
                    const $request = $.ajax(params).then(success).fail(function(jqXHR, textStatus, errorThrown) {
                        console.error('Keyword category Select2 AJAX error:', {
                            url: params.url,
                            status: jqXHR.status,
                            statusText: textStatus,
                            error: errorThrown,
                            response: jqXHR.responseText
                        });
                        failure(jqXHR, textStatus, errorThrown);
                    });
                    return $request;
                },
                cache: true
            },
            templateResult: function (data) {
                if (data.loading) {
                    return data.text;
                }
                
                const $result = $('<span>' + escapeHtml(data.text) + '</span>');
                if (data.file_count && data.file_count > 0) {
                    $result.append(' <small class="text-muted">' + data.file_count + ' files</small>');
                }
                return $result;
            },
            templateSelection: function (data) {
                // Handle both object and string formats
                if (typeof data === 'string') {
                    return data;
                }
                if (data && data.text) {
                    return data.text;
                }
                if (data && data.id) {
                    return data.id;
                }
                return data || '';
            },
            escapeMarkup: function (markup) {
                return markup;
            }
        });
        
        console.log('Select2 instance created for keywordCategory');
        
        // Load initial data when dropdown is opened
        $select.on('select2:open', function() {
            const $thisSelect = $(this);
            const select2 = $thisSelect.data('select2');
            console.log('Keyword category Select2 opened', { select2: !!select2, hasAdapter: !!(select2 && select2.dataAdapter) });
            
            if (select2 && select2.dataAdapter) {
                // Always trigger query when opened to ensure data is loaded
                setTimeout(function() {
                    if (select2.dataAdapter && !select2.dataAdapter._currentRequest) {
                        console.log('Triggering keyword category Select2 query');
                        select2.dataAdapter.query({
                            term: '',
                            page: 1
                        }, function(data) {
                            console.log('Keyword category Select2 query completed', data);
                            // Data will be processed by processResults
                        });
                    } else {
                        console.log('Keyword category Select2: Request already in progress or adapter not available');
                    }
                }, 100);
            } else {
                console.warn('Keyword category Select2: select2 or dataAdapter not available');
            }
        });
        
    }

    // Initialize words_categorys word select (Select2 - returns word_id)
    function initializeWordsCategorysWordSelect() {
        // Check if jQuery and Select2 are available
        if (typeof jQuery === 'undefined') {
            console.error('jQuery is not loaded. Cannot initialize Select2.');
            return;
        }
        if (typeof jQuery.fn.select2 === 'undefined') {
            console.error('Select2 is not loaded. Please wait for Select2 to load.');
            // Try again after a short delay
            setTimeout(initializeWordsCategorysWordSelect, 200);
            return;
        }
        
        // Destroy existing Select2 if it exists
        if ($('#wordsCategorysWordId').hasClass('select2-hidden-accessible')) {
            $('#wordsCategorysWordId').select2('destroy');
        }

        $('#wordsCategorysWordId').select2({
            placeholder: translations.placeholderSearchWord || 'Type to search for a word...',
            allowClear: true,
            width: '100%',
            minimumInputLength: 0, // Changed to 0 to show initial data
            ajax: {
                url: '/api/words/search',
                dataType: 'json',
                delay: 300,
                data: function (params) {
                    return {
                        q: params.term || '', // Allow empty search to show initial data
                        page: params.page || 1,
                        per_page: 20
                    };
                },
                processResults: function (data, params) {
                    params.page = params.page || 1;
                    
                    // Debug: Log the API response
                    console.log('Words API response:', data);
                    
                    const results = (data.results || []).map(function(item) {
                        // API returns: { id: word_id, word_id: word_id, text: word_text, word: word_text, usage_count: ... }
                        const wordId = item.id || item.word_id;
                        const wordText = item.text || item.word || String(wordId || '');
                        
                        return {
                            id: wordId, // Use word_id as the id (required for words_categorys)
                            text: wordText, // Display word text
                            usage_count: item.usage_count || 0
                        };
                    });
                    
                    console.log('Processed words results:', results);
                    
                    return {
                        results: results,
                        pagination: {
                            more: (params.page * 20) < (data.pagination?.total || 0)
                        }
                    };
                },
                cache: true
            },
            templateResult: function (data) {
                if (data.loading) {
                    return data.text;
                }
                
                const $result = $('<span>' + escapeHtml(data.text) + '</span>');
                if (data.usage_count && data.usage_count > 0) {
                    $result.append(' <small class="text-muted">' + data.usage_count + ' files</small>');
                }
                return $result;
            },
            templateSelection: function (data) {
                // Handle both object and string formats
                if (typeof data === 'string') {
                    return data;
                }
                if (data && data.text) {
                    return data.text;
                }
                if (data && data.id) {
                    return data.id;
                }
                return data || '';
            },
            escapeMarkup: function (markup) {
                return markup;
            }
        });
        
        // Load initial data when dropdown is opened
        $('#wordsCategorysWordId').on('select2:open', function() {
            const select2 = $(this).data('select2');
            if (select2 && select2.dataAdapter) {
                // Check if we already have data loaded
                const currentData = select2.data();
                if (!currentData || currentData.length === 0) {
                    // Trigger search with empty term to load initial data
                    console.log('Triggering initial words load on open...');
                    // Use the proper Select2 method to trigger search
                    $(this).trigger('input');
                }
            }
        });
        
        // Pre-load data when modal opens (this helps Select2 show results immediately)
        setTimeout(function() {
            const $select = $('#wordsCategorysWordId');
            if ($select.length && $select.data('select2')) {
                // Pre-fetch data so it's available when dropdown opens
                const select2 = $select.data('select2');
                if (select2 && select2.dataAdapter) {
                    console.log('Pre-loading words data...');
                    select2.dataAdapter.query({
                        term: '',
                        page: 1
                    }, function(data) {
                        console.log('Pre-loaded words data:', data);
                        // Force Select2 to update its results
                        if (select2 && select2._results) {
                            select2._results.update(data);
                        }
                    });
                }
            }
        }, 500);
    }

    // Initialize words_categorys category select (Select2 - returns category_id)
    function initializeWordsCategorysCategorySelect() {
        // Check if jQuery and Select2 are available
        if (typeof jQuery === 'undefined') {
            console.error('jQuery is not loaded. Cannot initialize Select2.');
            return;
        }
        if (typeof jQuery.fn.select2 === 'undefined') {
            console.error('Select2 is not loaded. Please wait for Select2 to load.');
            // Try again after a short delay
            setTimeout(initializeWordsCategorysCategorySelect, 200);
            return;
        }
        
        // Destroy existing Select2 if it exists
        if ($('#wordsCategorysCategoryId').hasClass('select2-hidden-accessible')) {
            $('#wordsCategorysCategoryId').select2('destroy');
        }

        $('#wordsCategorysCategoryId').select2({
            placeholder: translations.placeholderSearchCategory || "Type to search for a category...",
            allowClear: true,
            width: '100%',
            minimumInputLength: 0, // Show initial data
            ajax: {
                url: '/api/categories/search',
                dataType: 'json',
                delay: 300,
                data: function (params) {
                    return {
                        q: params.term || '', // Allow empty search to show initial data
                        page: params.page || 1,
                        per_page: 20
                    };
                },
                processResults: function (data, params) {
                    params.page = params.page || 1;
                    
                    // Debug: Log the API response
                    console.log('Categories API response:', data);
                    
                    // Handle both array and object response formats
                    let items = [];
                    if (Array.isArray(data)) {
                        items = data;
                    } else if (data.results || data.items) {
                        items = data.results || data.items || [];
                    }
                    
                    // API returns: { id: category_id, name: category_name, file_count: ... }
                    const results = items.map(function(item) {
                        return {
                            id: item.id, // Use category id (required for words_categorys)
                            text: item.name || item.word || 'Unnamed',
                            file_count: item.file_count || 0
                        };
                    });
                    
                    console.log('Processed categories results:', results);
                    
                    const total = data.total || data.pagination?.total || items.length;
                    
                    return {
                        results: results,
                        pagination: {
                            more: (params.page * 20) < total
                        }
                    };
                },
                cache: true
            },
            templateResult: function (data) {
                if (data.loading) {
                    return data.text;
                }
                
                const $result = $('<span>' + escapeHtml(data.text) + '</span>');
                if (data.file_count && data.file_count > 0) {
                    $result.append(' <small class="text-muted">' + data.file_count + 'files</small>');
                }
                return $result;
            },
            templateSelection: function (data) {
                // Handle both object and string formats
                if (typeof data === 'string') {
                    return data;
                }
                if (data && data.text) {
                    return data.text;
                }
                if (data && data.id) {
                    return data.id;
                }
                return data || '';
            },
            escapeMarkup: function (markup) {
                return markup;
            }
        });
        
        // Load initial data when dropdown is opened
        $('#wordsCategorysCategoryId').on('select2:open', function() {
            const select2 = $(this).data('select2');
            if (select2 && select2.dataAdapter) {
                // Check if we already have data loaded
                const currentData = select2.data();
                if (!currentData || currentData.length === 0) {
                    // Data should already be cached from pre-load
                    // If not, trigger a search
                    console.log('Dropdown opened - checking for cached data...');
                    // The dropdown should automatically show cached results
                }
            }
        });
        
        // Pre-load data when modal opens (this helps Select2 show results immediately)
        setTimeout(function() {
            const $select = $('#wordsCategorysCategoryId');
            if ($select.length && $select.data('select2')) {
                // Pre-fetch data so it's available when dropdown opens
                const select2 = $select.data('select2');
                if (select2 && select2.dataAdapter) {
                    console.log('Pre-loading categories data...');
                    select2.dataAdapter.query({
                        term: '',
                        page: 1
                    }, function(data) {
                        console.log('Pre-loaded categories data:', data);
                        // Data is now cached and will be shown when dropdown opens
                    });
                }
            }
        }, 500);
    }

    // Submit words_categorys form
    async function submitAddWordsCategorys() {
        const submitBtn = document.querySelector('#addWordsCategorysModal .add-item-btn-submit');
        const originalBtnText = submitBtn ? submitBtn.textContent : '';
        
        try {
            // Show loading state
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<i class="bi bi-arrow-repeat" style="animation: spin 1s linear infinite;"></i> ${translations.submitting || 'Submitting...'}`;
            }

            const wordId = $('#wordsCategorysWordId').val();
            const categoryId = $('#wordsCategorysCategoryId').val();
            
            if (!wordId || !categoryId) {
                showNotification(translations.bothWordAndCategoryRequired || 'Both word and category are required', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
                return;
            }
            
            const data = {
                word_id: parseInt(wordId),
                category_id: parseInt(categoryId)
            };
            
            // ✅ SECURITY: Get CSRF token with fallback
            let csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
            
            // If no token in meta tag, fetch from API
            if (!csrfToken) {
                try {
                    const tokenResponse = await fetch('/api/csrf-token');
                    const tokenData = await tokenResponse.json();
                    csrfToken = tokenData.csrf_token || '';
                } catch (error) {
                    console.error('Error fetching CSRF token:', error);
                }
            }
            
            if (!csrfToken) {
                showNotification(translations.csrfTokenError || 'Unable to obtain security token. Please refresh the page.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
                return;
            }
            
            const response = await fetch('/api/words-categorys/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (response.ok && (result.success !== false)) {
                // Show appropriate message based on whether relationship already existed
                if (result.already_exists) {
                    showNotification(
                        result.message || (translations.wordCategoryAlreadyExists || 'Word-category relationship already exists'),
                        'info'
                    );
                } else {
                    showNotification(
                        result.message || (translations.successfullyAddedWordCategory || 'Successfully added word-category relationship!'),
                        'success'
                    );
                }
                closeAddItemModal('addWordsCategorysModal');
                
                // ✅ Complete page reload with cache-busting
                setTimeout(() => {
                    window.location.href = window.location.pathname + '?t=' + Date.now();
                }, 500);
            } else {
                const errorMsg = result.error || (translations.errorAddingWordCategory || 'Error adding word-category relationship');
                showNotification(errorMsg, 'error');
            }
        } catch (error) {
            console.error('Error submitting words_categorys:', error);
            showNotification(`${translations.errorAddingWordCategory || 'Error adding word-category relationship'}: ${error.message}`, 'error');
        } finally {
            // Restore button state
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
        }
    }

    // Search category words (for category modal list)
    function searchCategoryWords() {
        const searchInput = document.getElementById('categorySearchInput');
        if (!searchInput) return;

        const searchTerm = searchInput.value.trim();
        
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadItemsForModal('category', 1, searchTerm);
        }, 300);
    }

    // Close modals when clicking outside
    document.addEventListener('click', function(e) {
        ['addSourceModal', 'addSideModal', 'addKeywordModal', 'addCategoryModal', 'addWordsCategorysModal'].forEach(modalId => {
            const modal = document.getElementById(modalId);
            if (modal && modal.classList.contains('active')) {
                if (e.target === modal) {
                    closeAddItemModal(modalId);
                }
            }
        });
    });

    // Submit form on Enter key (only in input fields, not textareas)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
            const target = e.target;
            // Only submit if it's an input field (not textarea) and it's inside a modal
            if (target.tagName === 'INPUT' && target.type !== 'submit' && target.type !== 'button') {
                const modal = target.closest('.archives-modal');
                if (modal && modal.classList.contains('active')) {
                    const modalId = modal.id;
                    // Prevent default form submission
                    e.preventDefault();
                    
                    // Determine which section based on modal ID
                    let section = '';
                    if (modalId === 'addSourceModal') {
                        section = 'source';
                    } else if (modalId === 'addSideModal') {
                        section = 'side';
                    } else if (modalId === 'addKeywordModal') {
                        section = 'keyword';
                    } else if (modalId === 'addCategoryModal') {
                        section = 'category';
                    } else if (modalId === 'addWordsCategorysModal') {
                        submitAddWordsCategorys();
                        return;
                    }
                    
                    if (section) {
                        submitAddItem(section);
                    }
                }
            }
        }
    });

    // Close modals with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            ['addSourceModal', 'addSideModal', 'addKeywordModal', 'addCategoryModal', 'addWordsCategorysModal'].forEach(modalId => {
                const modal = document.getElementById(modalId);
                if (modal && modal.classList.contains('active')) {
                    closeAddItemModal(modalId);
                }
            });
            
            // Also close file modal with Escape
            const fileModal = document.getElementById('fileModal');
            if (fileModal && fileModal.classList.contains('active')) {
                closeFileModal();
            }
        }
    });

    // ==================== MODAL SEARCH FUNCTIONALITY ====================
    
    // Global state for modal search
    let modalSearchResults = [];
    let modalCurrentSearchIndex = 0;
    
    function performModalSearch() {
        const query = document.getElementById('modalSearchInput')?.value.trim();
        if (!query) {
            clearModalSearch();
            return;
        }
        
        const caseSensitive = document.getElementById('modalCaseSensitive')?.checked || false;
        const wholeWord = document.getElementById('modalWholeWord')?.checked || false;
        
        const contentElement = document.getElementById('modalContentText');
        if (!contentElement) {
            console.warn('Content element not found for search');
            return;
        }
        
        // Get full content for searching (use stored full content if available)
        const fullContent = window.currentModalFileContent || contentElement.textContent;
        modalSearchResults = [];
        modalCurrentSearchIndex = 0;
        
        let pattern = query;
        if (wholeWord) {
            pattern = `\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
        } else {
            pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(pattern, flags);
        
        let match;
        while ((match = regex.exec(fullContent)) !== null) {
            modalSearchResults.push({ 
                index: match.index, 
                length: match[0].length,
                text: match[0]
            });
        }
        
        updateModalSearchUI();
        highlightModalMatches();
        
        const searchResultsDiv = document.getElementById('modalSearchResults');
        if (searchResultsDiv) {
            searchResultsDiv.style.display = 'block';
        }
        
        if (modalSearchResults.length > 0) {
            scrollToModalMatch(modalSearchResults[0]);
        }
    }
    
    function updateModalSearchUI() {
        const resultCount = document.getElementById('modalResultCount');
        const currentMatch = document.getElementById('modalCurrentMatch');
        
        if (modalSearchResults.length === 0) {
            if (resultCount) {
                resultCount.textContent = '0 results';
                resultCount.className = 'badge bg-secondary';
            }
            if (currentMatch) {
                currentMatch.textContent = 'No matches';
                currentMatch.className = 'badge bg-secondary';
            }
        } else {
            if (resultCount) {
                resultCount.textContent = `${modalSearchResults.length} result${modalSearchResults.length > 1 ? 's' : ''}`;
                resultCount.className = 'badge bg-primary';
            }
            if (currentMatch) {
                currentMatch.textContent = `Match ${modalCurrentSearchIndex + 1} of ${modalSearchResults.length}`;
                currentMatch.className = 'badge bg-info';
            }
        }
    }
    
    function highlightModalMatches() {
        const contentElement = document.getElementById('modalContentText');
        if (!contentElement || modalSearchResults.length === 0) {
            if (contentElement) {
                const originalContent = contentElement.getAttribute('data-original-content');
                if (originalContent !== null) {
                    contentElement.innerHTML = originalContent;
                }
            }
            return;
        }
        
        // Get full content for highlighting
        const fullContent = window.currentModalFileContent || contentElement.textContent;
        
        if (!contentElement.getAttribute('data-original-content')) {
            contentElement.setAttribute('data-original-content', contentElement.innerHTML);
        }
        
        let highlightedContent = '';
        let lastIndex = 0;
        
        // Sort matches by index in ascending order for proper insertion
        const sortedMatches = [...modalSearchResults].sort((a, b) => a.index - b.index);
        
        sortedMatches.forEach((match, index) => {
            // Add text before match
            highlightedContent += escapeHtml(fullContent.substring(lastIndex, match.index));
            
            // Add highlighted match
            const matchText = fullContent.substring(match.index, match.index + match.length);
            const highlightClass = index === modalCurrentSearchIndex ? 'search-highlight current-match' : 'search-highlight';
            highlightedContent += `<span class="${highlightClass}" style="background-color: #ffeb3b; padding: 2px 0; border-radius: 2px;">${escapeHtml(matchText)}</span>`;
            
            lastIndex = match.index + match.length;
        });
        
        // Add remaining text
        highlightedContent += escapeHtml(fullContent.substring(lastIndex));
        
        contentElement.innerHTML = highlightedContent;
    }
    
    function findModalNext() {
        if (modalSearchResults.length === 0) return;
        modalCurrentSearchIndex = (modalCurrentSearchIndex + 1) % modalSearchResults.length;
        scrollToModalMatch(modalSearchResults[modalCurrentSearchIndex]);
        updateModalSearchUI();
        highlightModalMatches();
    }
    
    function findModalPrevious() {
        if (modalSearchResults.length === 0) return;
        modalCurrentSearchIndex = (modalCurrentSearchIndex - 1 + modalSearchResults.length) % modalSearchResults.length;
        scrollToModalMatch(modalSearchResults[modalCurrentSearchIndex]);
        updateModalSearchUI();
        highlightModalMatches();
    }
    
    function scrollToModalMatch(result) {
        const highlights = document.querySelectorAll('#modalContentText .search-highlight');
        if (highlights.length > modalCurrentSearchIndex) {
            highlights[modalCurrentSearchIndex].scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center'
            });
        }
    }
    
    function clearModalSearch() {
        modalSearchResults = [];
        modalCurrentSearchIndex = 0;
        
        const searchInput = document.getElementById('modalSearchInput');
        const caseSensitive = document.getElementById('modalCaseSensitive');
        const wholeWord = document.getElementById('modalWholeWord');
        const searchResultsDiv = document.getElementById('modalSearchResults');
        
        if (searchInput) searchInput.value = '';
        if (caseSensitive) caseSensitive.checked = false;
        if (wholeWord) wholeWord.checked = false;
        if (searchResultsDiv) searchResultsDiv.style.display = 'none';
        
        // Restore original content
        const contentElement = document.getElementById('modalContentText');
        if (contentElement) {
            const originalContent = contentElement.getAttribute('data-original-content');
            if (originalContent !== null) {
                contentElement.innerHTML = originalContent;
            } else {
                // Fallback: remove highlights
                const highlightedContent = contentElement.innerHTML;
                const cleanContent = highlightedContent.replace(/<span class="search-highlight[^"]*"[^>]*>([^<]*)<\/span>/g, '$1');
                contentElement.innerHTML = cleanContent;
            }
        }
    }

    // ==================== MODAL CONTENT ACTIONS ====================
    
    function copyModalContent() {
        const content = window.currentModalFileContent || document.getElementById('modalContentText')?.textContent || '';
        if (!content) {
            if (window.showWarning) {
                window.showWarning('No content available to copy');
            } else if (window.alert) {
                window.alert('No content available to copy');
            }
            return;
        }
        
        navigator.clipboard.writeText(content).then(() => {
            // Show temporary feedback
            const btn = document.querySelector('button[onclick="copyModalContent()"]');
            if (btn) {
                const originalText = btn.innerHTML;
                btn.innerHTML = '<i class="bi bi-check me-1"></i>Copied!';
                btn.classList.add('btn-success');
                btn.classList.remove('btn-outline-primary');
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.classList.remove('btn-success');
                    btn.classList.add('btn-outline-primary');
                }, 2000);
            } else {
                if (window.showSuccess) {
                    window.showSuccess('Content copied to clipboard!');
                } else if (window.alert) {
                    window.alert('Content copied to clipboard!');
                }
            }
        }).catch(err => {
            console.error('Failed to copy:', err);
            if (window.showError) {
                window.showError('Failed to copy content to clipboard');
            } else if (window.alert) {
                window.alert('Failed to copy content to clipboard');
            }
        });
    }
    
    function downloadModalContent() {
        const content = window.currentModalFileContent || document.getElementById('modalContentText')?.textContent || '';
        if (!content) {
            if (window.showWarning) {
                window.showWarning('No content available to download');
            } else if (window.alert) {
                window.alert('No content available to download');
            }
            return;
        }
        
        const fileName = window.currentModalFileName || 'file';
        const blob = new Blob([content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}_content.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }
    
    function exportModalFile() {
        // Try to get file ID from stored value first, then from navigation state
        const fileId = window.currentModalFileId || fileNavigationState.currentFiles[fileNavigationState.currentIndex]?.id;
        if (!fileId) {
            if (window.showError) {
                window.showError('File ID not available for export');
            } else if (window.alert) {
                window.alert('File ID not available for export');
            }
            return;
        }
        
        // Open export in new window/tab
        window.open(`/file/${fileId}/export?format=pdf`, '_blank');
    }
    
    // ==================== CLASSIFICATION CHARTS ====================
    
    // Chart state management
    const classificationChartState = {
        currentChart: null,
        currentDataType: 'categories', // 'categories', 'words', 'keywords'
        currentChartType: 'pie', // 'pie', 'bar', 'doughnut', 'line'
        chartData: null,
        filterValue: ''
    };
    
    // Color palette for charts
    const chartColors = [
        '#667eea', '#764ba2', '#10b981', '#f59e0b', '#ef4444',
        '#06b6d4', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6',
        '#6366f1', '#84cc16', '#f43f5e', '#06b6d4', '#a855f7',
        '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6'
    ];
    
    /**
     * Load classification chart data and render
     */
    function loadClassificationCharts(fileId) {
        const analysisSection = document.getElementById('fileAnalysisSection');
        if (!analysisSection) return;
        
        // Show loading state
        analysisSection.innerHTML = `
            <div class="classification-charts-container">
                <div class="classification-charts-controls">
                    <div class="data-type-tabs">
                        <button class="data-type-tab active" data-type="categories" onclick="switchDataType('categories')">
                            <i class="bi bi-tags"></i> ${translations.categories || 'Categories'}
                        </button>
                        <button class="data-type-tab" data-type="words" onclick="switchDataType('words')">
                            <i class="bi bi-file-text"></i> ${translations.words || 'Words'}
                        </button>
                        <button class="data-type-tab" data-type="keywords" onclick="switchDataType('keywords')">
                            <i class="bi bi-key"></i> ${translations.keywords || 'Keywords'}
                        </button>
                    </div>

                <div class="chart-filter-container" style="margin-top: 0.75rem;">
                    <input type="text" id="chartFilterInput" 
                           placeholder="${translations.filterData || 'Filter...'}" 
                           oninput="filterChartData(this.value)"
                           style="width: 100%; padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 0.875rem;">
                </div>
                <div class="chart-and-table-container" style="display: flex; gap: 1rem; margin-top: 1rem;">
                    <div class="chart-container" style="flex: 1; position: relative; height: 300px; min-width: 0;">
                        <canvas id="classificationChart"></canvas>
                    </div>
                    <div class="chart-data-table-container" style="flex: 0 0 300px; max-height: 300px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 4px; background: #ffffff;">
                        <div id="chartDataTable" style="padding: 0.5rem;">
                            <div style="font-size: 0.75rem; color: #64748b; padding: 0.5rem; border-bottom: 1px solid #e2e8f0; font-weight: 600;">
                                ${translations.dataTable || 'Data Table'}
                            </div>
                            <div class="table-loading" style="text-align: center; padding: 2rem; color: #64748b; font-size: 0.875rem;">
                                ${translations.loadingAnalysis || 'Loading...'}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="chart-loading" style="text-align: center; padding: 2rem; color: #64748b;">
                    ${translations.loadingAnalysis || 'Loading analysis...'}
                </div>
                
        `;
        
        // Fetch chart data
        fetch(`/file/${fileId}/chart-data`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(result => {
                if (!result.success || !result.data) {
                    throw new Error(result.error || 'Failed to load chart data');
                }
                
                classificationChartState.chartData = result.data;
                renderClassificationChart();
                renderChartDataTable();
                renderDuplicateWords();
            })
            .catch(error => {
                console.error('Error loading classification charts:', error);
                const chartContainer = analysisSection.querySelector('.chart-container');
                if (chartContainer) {
                    chartContainer.innerHTML = `<div class="empty-state" style="text-align: center; padding: 2rem; color: #ef4444;">
                        ${translations.errorLoadingAnalysis || 'Error loading analysis'}: ${escapeHtml(error.message)}
                    </div>`;
                }
            });
    }
    
    /**
     * Switch between data types (categories, words, keywords)
     */
    function switchDataType(dataType) {
        classificationChartState.currentDataType = dataType;
        classificationChartState.filterValue = '';
        
        // Update active tab
        document.querySelectorAll('.data-type-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.getAttribute('data-type') === dataType) {
                tab.classList.add('active');
            }
        });
        
        // Clear filter
        const filterInput = document.getElementById('chartFilterInput');
        if (filterInput) {
            filterInput.value = '';
        }
        
        renderClassificationChart();
        renderChartDataTable();
    }
    
    /**
     * Switch between chart types (pie, bar, doughnut, line)
     */
    function switchChartType(chartType) {
        classificationChartState.currentChartType = chartType;
        renderClassificationChart();
    }
    
    /**
     * Filter chart data
     */
    function filterChartData(filterValue) {
        classificationChartState.filterValue = filterValue.toLowerCase().trim();
        renderClassificationChart();
        renderChartDataTable();
    }
    
    /**
     * Render the classification chart
     */
    function renderClassificationChart() {
        if (!classificationChartState.chartData) {
            return;
        }
        
        const canvas = document.getElementById('classificationChart');
        if (!canvas) {
            return;
        }
        
        // Get data based on current data type
        let rawData = [];
        switch (classificationChartState.currentDataType) {
            case 'categories':
                rawData = classificationChartState.chartData.categories || [];
                break;
            case 'words':
                rawData = classificationChartState.chartData.words || [];
                break;
            case 'keywords':
                rawData = classificationChartState.chartData.keywords || [];
                break;
        }
        
        // Apply filter
        let filteredData = rawData;
        if (classificationChartState.filterValue) {
            filteredData = rawData.filter(item => 
                item.name && item.name.toLowerCase().includes(classificationChartState.filterValue)
            );
        }
        
        // Limit to top 20 items for better visualization
        filteredData = filteredData.slice(0, 20);
        
        // Check if we have data
        if (!filteredData || filteredData.length === 0) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Show empty state
            const container = canvas.parentElement;
            if (container) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'empty-state';
                emptyDiv.style.cssText = 'text-align: center; padding: 2rem; color: #64748b;';
                emptyDiv.textContent = translations.noCategoriesAssigned || 'No data available';
                
                // Remove existing empty state if any
                const existingEmpty = container.querySelector('.empty-state');
                if (existingEmpty) {
                    existingEmpty.remove();
                }
                container.appendChild(emptyDiv);
            }
            
            if (classificationChartState.currentChart) {
                classificationChartState.currentChart.destroy();
                classificationChartState.currentChart = null;
            }
            return;
        }
        
        // Remove empty state if exists
        const container = canvas.parentElement;
        if (container) {
            const emptyState = container.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }
        }
        
        // Prepare chart data
        const labels = filteredData.map(item => {
            const name = item.name || 'Unknown';
            // Truncate long labels
            return name.length > 30 ? name.substring(0, 27) + '...' : name;
        });
        
        const dataValues = filteredData.map(item => item.count || 0);
        const fullLabels = filteredData.map(item => item.name || 'Unknown');
        
        // Generate colors
        const colors = chartColors.slice(0, filteredData.length);
        
        // Destroy existing chart
        if (classificationChartState.currentChart) {
            classificationChartState.currentChart.destroy();
        }
        
        // Create new chart
        const ctx = canvas.getContext('2d');
        const chartType = classificationChartState.currentChartType;
        
        const chartConfig = {
            type: chartType,
            data: {
                labels: labels,
                datasets: [{
                    label: classificationChartState.currentDataType.charAt(0).toUpperCase() + 
                           classificationChartState.currentDataType.slice(1),
                    data: dataValues,
                    backgroundColor: chartType === 'line' ? chartColors[0] : colors,
                    borderColor: chartType === 'line' ? chartColors[0] : colors.map(c => c + '80'),
                    borderWidth: chartType === 'line' ? 2 : 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: chartType !== 'bar' && chartType !== 'line',
                        position: 'right',
                        labels: {
                            boxWidth: 12,
                            padding: 8,
                            font: {
                                size: 11
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const index = context.dataIndex;
                                const fullLabel = fullLabels[index];
                                const value = context.parsed.y || context.parsed;
                                const percentage = classificationChartState.currentDataType === 'categories' && 
                                    filteredData[index].percentage ? 
                                    ` (${filteredData[index].percentage.toFixed(1)}%)` : '';
                                return `${fullLabel}: ${value}${percentage}`;
                            }
                        }
                    },
                    title: {
                        display: false
                    }
                },
                scales: (chartType === 'bar' || chartType === 'line') ? {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            font: {
                                size: 11
                            }
                        }
                    },
                    x: {
                        ticks: {
                            font: {
                                size: 10
                            },
                            maxRotation: 45,
                            minRotation: 45
                        }
                    }
                } : {}
            }
        };
        
        // Special handling for horizontal bar chart
        if (chartType === 'bar' && filteredData.length > 10) {
            chartConfig.options.indexAxis = 'y';
            chartConfig.options.scales = {
                x: {
                    beginAtZero: true,
                    ticks: {
                        font: {
                            size: 11
                        }
                    }
                },
                y: {
                    ticks: {
                        font: {
                            size: 10
                        }
                    }
                }
            };
        }
        
        classificationChartState.currentChart = new Chart(ctx, chartConfig);
        
        // Ensure chart is registered with Chart.js
        // Force update to ensure chart is fully initialized
        setTimeout(() => {
            if (classificationChartState.currentChart) {
                classificationChartState.currentChart.update('none');
            }
        }, 50);
        
        // Attach export buttons - wait for ChartExport to be available with retry logic
        function attachClassificationControls() {
            if (window.ChartExport && window.ChartExport.attachExportButtonsToCharts) {
                // Wait a bit for chart to be fully registered with Chart.js
                setTimeout(() => {
                    // Try to find the best container - prioritize classification-charts-container or fileAnalysisSection
                    // This ensures buttons are placed in the right location (below filter)
                    let chartContainer = canvas.closest('.classification-charts-container');
                    if (!chartContainer) {
                        chartContainer = canvas.closest('.file-details-analysis-section, #fileAnalysisSection');
                    }
                    if (!chartContainer) {
                        chartContainer = canvas.closest('.chart-and-table-container');
                    }
                    if (!chartContainer) {
                        chartContainer = canvas.closest('.chart-container');
                    }
                    if (!chartContainer) {
                        // Fallback: try parent elements
                        let parent = canvas.parentElement;
                        let attempts = 0;
                        while (parent && attempts < 5) {
                            if (parent.classList && (parent.classList.contains('classification-charts-container') ||
                                 parent.id === 'fileAnalysisSection' ||
                                 parent.classList.contains('file-details-analysis-section'))) {
                                chartContainer = parent;
                                break;
                            }
                            parent = parent.parentElement;
                            attempts++;
                        }
                    }
                    
                    if (chartContainer) {
                        window.ChartExport.attachExportButtonsToCharts(chartContainer);
                    } else {
                        // Last resort: attach to fileAnalysisSection or canvas parent
                        const fileAnalysisSection = document.getElementById('fileAnalysisSection');
                        if (fileAnalysisSection) {
                            window.ChartExport.attachExportButtonsToCharts(fileAnalysisSection);
                        } else if (canvas.parentElement) {
                            window.ChartExport.attachExportButtonsToCharts(canvas.parentElement);
                        }
                    }
                }, 200); // Wait for chart to be registered
            } else {
                // Retry if ChartExport not loaded yet
                setTimeout(attachClassificationControls, 200);
            }
        }
        setTimeout(attachClassificationControls, 150);
        
        // Hide loading indicator
        const loadingDiv = document.querySelector('.chart-loading');
        if (loadingDiv) {
            loadingDiv.style.display = 'none';
        }
    }
    
    /**
     * Render the data table next to the chart
     */
    function renderChartDataTable() {
        if (!classificationChartState.chartData) {
            return;
        }
        
        const tableContainer = document.getElementById('chartDataTable');
        if (!tableContainer) {
            return;
        }
        
        // Get data based on current data type
        let rawData = [];
        switch (classificationChartState.currentDataType) {
            case 'categories':
                rawData = classificationChartState.chartData.categories || [];
                break;
            case 'words':
                rawData = classificationChartState.chartData.words || [];
                break;
            case 'keywords':
                rawData = classificationChartState.chartData.keywords || [];
                break;
        }
        
        // Apply filter
        let filteredData = rawData;
        if (classificationChartState.filterValue) {
            filteredData = rawData.filter(item => 
                item.name && item.name.toLowerCase().includes(classificationChartState.filterValue)
            );
        }
        
        // Limit to top 20 items
        filteredData = filteredData.slice(0, 20);
        
        // Remove loading indicator
        const loadingDiv = tableContainer.querySelector('.table-loading');
        if (loadingDiv) {
            loadingDiv.remove();
        }
        
        if (!filteredData || filteredData.length === 0) {
            tableContainer.innerHTML = `
                <div style="font-size: 0.75rem; color: #64748b; padding: 0.5rem; border-bottom: 1px solid #e2e8f0; font-weight: 600;">
                    ${translations.dataTable || 'Data Table'}
                </div>
                <div style="text-align: center; padding: 2rem; color: #64748b; font-size: 0.875rem;">
                    ${translations.noDataAvailable || 'No data available'}
                </div>
            `;
            return;
        }
        
        // Build table HTML
        let tableHtml = `
            <div style="font-size: 0.75rem; color: #64748b; padding: 0.5rem; border-bottom: 1px solid #e2e8f0; font-weight: 600; position: sticky; top: 0; background: #ffffff; z-index: 10;">
                ${translations.dataTable || 'Data Table'} (${filteredData.length})
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem;">
                <thead>
                    <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                        <th style="padding: 0.5rem; text-align: left; font-weight: 600; color: #475569; position: sticky; top: 32px; background: #f8fafc; z-index: 9;">
                            ${classificationChartState.currentDataType === 'categories' ? (translations.category || 'Category') : 
                              classificationChartState.currentDataType === 'words' ? (translations.word || 'Word') : 
                              (translations.keyword || 'Keyword')}
                        </th>
                        <th style="padding: 0.5rem; text-align: right; font-weight: 600; color: #475569; position: sticky; top: 32px; background: #f8fafc; z-index: 9;">
                            ${translations.count || 'Count'}
                        </th>
                        ${classificationChartState.currentDataType === 'categories' ? `
                        <th style="padding: 0.5rem; text-align: right; font-weight: 600; color: #475569; position: sticky; top: 32px; background: #f8fafc; z-index: 9;">
                            ${translations.percentage || '%'}
                        </th>
                        ` : ''}
                    </tr>
                </thead>
                <tbody>
        `;
        
        filteredData.forEach((item, index) => {
            const rowColor = index % 2 === 0 ? '#ffffff' : '#f8fafc';
            tableHtml += `
                <tr style="background: ${rowColor}; border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 0.5rem; color: #1e293b; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.name || 'Unknown')}">
                        ${escapeHtml(item.name || 'Unknown')}
                    </td>
                    <td style="padding: 0.5rem; text-align: right; color: #475569; font-weight: 500;">
                        ${(item.count || 0).toLocaleString()}
                    </td>
                    ${classificationChartState.currentDataType === 'categories' ? `
                    <td style="padding: 0.5rem; text-align: right; color: #64748b; font-size: 0.7rem;">
                        ${item.percentage ? item.percentage.toFixed(1) + '%' : '-'}
                    </td>
                    ` : ''}
                </tr>
            `;
        });
        
        tableHtml += `
                </tbody>
            </table>
        `;
        
        tableContainer.innerHTML = tableHtml;
    }
    
    /**
     * Render duplicate words section
     */
    function renderDuplicateWords() {
        if (!classificationChartState.chartData) {
            return;
        }
        
        const container = document.getElementById('duplicateWordsContainer');
        const countSpan = document.getElementById('duplicateWordsCount');
        if (!container) {
            return;
        }
        
        const repeatedElements = classificationChartState.chartData.repeated_elements || [];
        
        // Update count
        if (countSpan) {
            countSpan.textContent = `(${repeatedElements.length})`;
        }
        
        // Remove loading indicator
        const loadingDiv = container.querySelector('.duplicate-words-loading');
        if (loadingDiv) {
            loadingDiv.remove();
        }
        
        if (!repeatedElements || repeatedElements.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #64748b; font-size: 0.875rem;">
                    ${translations.noDuplicateWords || 'No duplicate words found'}
                </div>
            `;
            return;
        }
        
        // Build duplicate words display
        let html = `
            <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem;">
                <thead>
                    <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; z-index: 10;">
                        <th style="padding: 0.5rem; text-align: left; font-weight: 600; color: #475569;">
                            ${translations.word || 'Word'}
                        </th>
                        <th style="padding: 0.5rem; text-align: right; font-weight: 600; color: #475569;">
                            ${translations.count || 'Count'}
                        </th>
                        <th style="padding: 0.5rem; text-align: right; font-weight: 600; color: #475569;">
                            ${translations.categories || 'Categories'}
                        </th>
                        <th style="padding: 0.5rem; text-align: left; font-weight: 600; color: #475569;">
                            ${translations.categoryList || 'Category List'}
                        </th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        repeatedElements.forEach((item, index) => {
            const rowColor = index % 2 === 0 ? '#ffffff' : '#f8fafc';
            const categoriesList = item.categories && item.categories.length > 0 
                ? item.categories.join(', ') 
                : translations.noCategories || 'None';
            
            html += `
                <tr style="background: ${rowColor}; border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 0.5rem; color: #1e293b; font-weight: 500;">
                        ${escapeHtml(item.word || 'Unknown')}
                    </td>
                    <td style="padding: 0.5rem; text-align: right; color: #475569;">
                        ${(item.count || 0).toLocaleString()}
                    </td>
                    <td style="padding: 0.5rem; text-align: right; color: #667eea; font-weight: 600;">
                        ${item.category_count || 0}
                    </td>
                    <td style="padding: 0.5rem; color: #64748b; font-size: 0.7rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(categoriesList)}">
                        ${escapeHtml(categoriesList)}
                    </td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        container.innerHTML = html;
    }
    
    // Make chart functions globally available
    window.loadClassificationCharts = loadClassificationCharts;
    window.switchDataType = switchDataType;
    window.switchChartType = switchChartType;
    window.filterChartData = filterChartData;
    
    // Make functions globally available
    window.performModalSearch = performModalSearch;
    window.clearModalSearch = clearModalSearch;
    window.findModalNext = findModalNext;
    window.findModalPrevious = findModalPrevious;
    window.copyModalContent = copyModalContent;
    window.downloadModalContent = downloadModalContent;
    window.exportModalFile = exportModalFile;
    
    // Make add item modal functions globally available
    window.openAddItemModal = openAddItemModal;
    window.closeAddItemModal = closeAddItemModal;
    window.loadItemsForModal = loadItemsForModal;
    window.searchItems = searchItems;
    window.submitAddItem = submitAddItem;
    
    // Alias for source form submission
    window.submitSourceForm = function() {
        submitAddItem('source');
    };
    
    // ✅ NEW: Update keyword associations for all files
    window.updateKeywordAssociations = function() {
        const btn = document.getElementById('updateKeywordsBtn');
        if (!btn) {
            // Try to find button by class if ID not found
            const buttons = document.querySelectorAll('.add-item-btn');
            const updateBtn = Array.from(buttons).find(b => b.textContent.includes('Update Keywords') || b.textContent.includes('Update'));
            if (!updateBtn) {
                console.error('Update Keywords button not found');
                return;
            }
            updateBtn.disabled = true;
            updateBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> <span>' + (translations.updating || 'Updating...') + '</span>';
        } else {
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="bi bi-hourglass-split"></i> <span>' + (translations.updating || 'Updating...') + '</span>';
        }
        
        // Confirm action
        if (!confirm(translations.updateKeywordAssociationsConfirm || 
                    'This will scan all files in the database and update keyword associations. This may take a while. Continue?')) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> <span>' + (translations.updateKeywords || 'Update Keywords') + '</span>';
            }
            return;
        }
        
        // Get CSRF token
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        
        fetch('/api/keywords/update-associations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            }
        })
        .then(response => response.json())
        .then(data => {
            const updateBtn = btn || document.querySelector('.add-item-btn[onclick*="updateKeywordAssociations"]');
            if (updateBtn) {
                updateBtn.disabled = false;
                updateBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> <span>' + (translations.updateKeywords || 'Update Keywords') + '</span>';
            }
            
            if (data.success) {
                let message = (translations.keywordAssociationsUpdated || 'Keyword associations updated successfully!') + '\n\n' +
                    (translations.filesProcessed || 'Files processed') + ': ' + data.files_processed + ' / ' + data.total_files + '\n' +
                    (translations.newAssociations || 'New associations') + ': ' + data.new_associations + '\n' +
                    (translations.keywordsChecked || 'Keywords checked') + ': ' + data.keywords_checked;
                if (data.errors > 0) {
                    message += '\n' + (translations.errors || 'Errors') + ': ' + data.errors;
                }
                alert('✅ ' + message);
                
                // Reload current view to show updated data
                if (navigationState.currentSection === 'keywords') {
                    // Reload keywords section
                    loadSectionView('keywords', navigationState.sectionPagination.currentPage);
                } else if (navigationState.currentFileSection === 'keywords') {
                    // Reload keyword files view
                    loadItemView(navigationState.currentFileSection, navigationState.currentFileItemId, null, navigationState.filePagination.currentPage);
                } else {
                    // Reload root view
                    loadRootView();
                }
            } else {
                alert('❌ ' + (translations.error || 'Error') + ': ' + (data.error || translations.unknownError || 'Unknown error'));
            }
        })
        .catch(error => {
            const updateBtn = btn || document.querySelector('.add-item-btn[onclick*="updateKeywordAssociations"]');
            if (updateBtn) {
                updateBtn.disabled = false;
                updateBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> <span>' + (translations.updateKeywords || 'Update Keywords') + '</span>';
            }
            console.error('Error updating keyword associations:', error);
            alert('❌ ' + (translations.error || 'Error') + ': ' + error.message);
        });
    };