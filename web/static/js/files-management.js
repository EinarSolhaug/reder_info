/**
 * File Management System - Clean JavaScript Module
 * Handles all file listing, filtering, selection, and bulk operations
 */

// ==================== STATE MANAGEMENT ====================
const FileManagement = {
    // Current state
    selectedFiles: new Set(),
    currentView: 'list',
    
    // Pagination data from server
    data: window.fileManagementData || {},
    
    // Initialize
    init() {
        this.setupEventListeners();
        this.restoreViewPreference();
        this.updateBulkToolbar();
        this.renderPagination();
    },
    
    // Setup all event listeners
    setupEventListeners() {
        // View mode toggle
        document.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchView(e.target.closest('.view-mode-btn').dataset.view));
        });
        
        // Filter changes
        document.getElementById('smartSearch')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.applyFilters();
            }
        });
        
        ['sourceFilter', 'sideFilter', 'fileTypeFilter', 'statusFilter', 'sortBy'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => this.applyFilters());
        });
        
        // Checkbox changes
        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.addEventListener('change', () => this.updateBulkToolbar());
        });
    },
    
    // ==================== VIEW MANAGEMENT ====================
    switchView(view) {
        this.currentView = view;
        
        // Update buttons
        document.querySelectorAll('.view-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        
        // Show/hide views
        document.querySelectorAll('.files-view').forEach(viewEl => {
            viewEl.style.display = viewEl.dataset.view === view ? 'block' : 'none';
        });
        
        // Save preference
        localStorage.setItem('filesViewMode', view);
    },
    
    restoreViewPreference() {
        const saved = localStorage.getItem('filesViewMode');
        if (saved) {
            this.switchView(saved);
        }
    },
    
    // ==================== SELECTION MANAGEMENT ====================
    selectAllFiles() {
        document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = true);
        document.getElementById('selectAllCheckbox').checked = true;
        this.updateBulkToolbar();
    },
    
    deselectAllFiles() {
        document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = false);
        document.getElementById('selectAllCheckbox').checked = false;
        this.updateBulkToolbar();
    },
    
    toggleSelectAll(checkbox) {
        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.checked = checkbox.checked;
        });
        this.updateBulkToolbar();
    },
    
    updateBulkToolbar() {
        const selected = document.querySelectorAll('.file-checkbox:checked').length;
        
        // Update count
        const countEl = document.getElementById('selectedCount');
        if (countEl) countEl.textContent = selected;
        
        // Enable/disable bulk action buttons
        const bulkBtns = ['bulkAnalyzeBtn', 'bulkExportBtn', 'bulkDeleteBtn'];
        bulkBtns.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) btn.disabled = selected === 0;
        });
        
        // Update select all checkbox state
        const allCheckboxes = document.querySelectorAll('.file-checkbox');
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (selectAllCheckbox && allCheckboxes.length > 0) {
            selectAllCheckbox.checked = selected === allCheckboxes.length;
            selectAllCheckbox.indeterminate = selected > 0 && selected < allCheckboxes.length;
        }
    },
    
    // ==================== FILTER MANAGEMENT ====================
    applyFilters() {
        const params = new URLSearchParams();
        
        // Get all filter values
        const search = document.getElementById('smartSearch')?.value?.trim();
        const source = document.getElementById('sourceFilter')?.value;
        const side = document.getElementById('sideFilter')?.value;
        const fileType = document.getElementById('fileTypeFilter')?.value;
        const status = document.getElementById('statusFilter')?.value;
        const sort = document.getElementById('sortBy')?.value || 'date_desc';
        const limit = document.getElementById('perPageFiles')?.value || '10';
        
        // Add to params if not empty
        if (search) params.set('search', search);
        if (source) params.set('source', source);
        if (side) params.set('side', side);
        if (fileType) params.set('file_type', fileType);
        if (status) params.set('status', status);
        if (sort) params.set('sort', sort);
        if (limit) params.set('limit', limit);
        
        // Reset to first page when filtering
        params.delete('cursor');
        
        // Navigate
        window.location.href = window.location.pathname + '?' + params.toString();
    },
    
    clearFileSearch() {
        const searchInput = document.getElementById('smartSearch');
        if (searchInput) {
            searchInput.value = '';
            this.applyFilters();
        }
    },
    
    // ==================== PAGINATION ====================
    changeFilesPageSize() {
        const perPageSelect = document.getElementById('perPageFiles');
        if (perPageSelect) {
            const params = new URLSearchParams(window.location.search);
            params.set('limit', perPageSelect.value);
            params.delete('cursor'); // Reset to first page
            window.location.href = window.location.pathname + '?' + params.toString();
        }
    },
    
    // Render numbered pagination buttons (like keywords page)
    renderPagination() {
        const data = this.data;
        if (!data || !data.totalPages) return;
        
        const currentPage = data.currentPage || 1;
        const totalPages = data.totalPages || 1;
        const paginationList = document.getElementById('paginationList');
        if (!paginationList) return;
        
        paginationList.innerHTML = '';
        
        const windowSize = 2;
        const start = Math.max(1, currentPage - windowSize);
        const end = Math.min(totalPages, currentPage + windowSize);
        
        const addItem = (label, pageNum, disabled = false, active = false) => {
            const li = document.createElement('li');
            li.className = 'page-item' + (disabled ? ' disabled' : '') + (active ? ' active' : '');
            const a = document.createElement('a');
            a.className = 'page-link';
            a.href = '#';
            a.textContent = label;
            if (!disabled && !active) {
                a.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.navigateToPage(pageNum);
                });
            }
            li.appendChild(a);
            paginationList.appendChild(li);
        };
        
        // First page button
        addItem('««', 1, currentPage === 1);
        // Previous page button
        addItem('«', Math.max(1, currentPage - 1), currentPage === 1);
        
        // Page numbers
        if (start > 1) {
            addItem('1', 1);
        }
        if (start > 2) {
            const li = document.createElement('li');
            li.className = 'page-item disabled';
            li.innerHTML = '<span class="page-link">…</span>';
            paginationList.appendChild(li);
        }
        
        for (let p = start; p <= end; p++) {
            addItem(String(p), p, false, p === currentPage);
        }
        
        if (end < totalPages - 1) {
            const li = document.createElement('li');
            li.className = 'page-item disabled';
            li.innerHTML = '<span class="page-link">…</span>';
            paginationList.appendChild(li);
        }
        if (end < totalPages) {
            addItem(String(totalPages), totalPages);
        }
        
        // Next page button
        addItem('»', Math.min(totalPages, currentPage + 1), currentPage === totalPages);
        // Last page button
        addItem('»»', totalPages, currentPage === totalPages);
    },
    
    // Navigate to a specific page using offset-based pagination
    navigateToPage(targetPage) {
        const data = this.data;
        const limit = data.limit || 10;
        
        // Build URL with filters
        const params = new URLSearchParams();
        if (data.search) params.set('search', data.search);
        if (data.sourceFilter) params.set('source', data.sourceFilter);
        if (data.sideFilter) params.set('side', data.sideFilter);
        if (data.statusFilter) params.set('status', data.statusFilter);
        if (data.fileTypeFilter) params.set('file_type', data.fileTypeFilter);
        params.set('limit', limit);
        params.set('page', targetPage);
        
        window.location.href = window.location.pathname + '?' + params.toString();
    },
    
    // ==================== BULK OPERATIONS ====================
    async bulkAnalyze() {
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
        
        if (selected.length === 0) {
            if (window.showWarning) {
                window.showWarning(window.translations.pleaseSelectFilesToAnalyze);
            } else if (window.alert) {
                window.alert(window.translations.pleaseSelectFilesToAnalyze);
            }
            return;
        }
        
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        
        try {
            const response = await fetch('/analysis/batch/process', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({ file_ids: selected })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                const message = `${window.translations.analysisStartedFor} ${selected.length} ${window.translations.files}`;
                if (window.showSuccess) {
                    window.showSuccess(message);
                } else if (window.alert) {
                    window.alert(message);
                }
                setTimeout(() => {
                    window.location.href = window.location.pathname + '?t=' + Date.now();
                }, 2000);
            } else {
                const errorMsg = window.translations.errorStartingAnalysis + ': ' + (data.error || 'Unknown error');
                if (window.showError) {
                    window.showError(errorMsg);
                } else if (window.alert) {
                    window.alert(errorMsg);
                }
            }
        } catch (error) {
            console.error('Error:', error);
            if (window.showError) {
                window.showError(window.translations.errorStartingAnalysis);
            } else if (window.alert) {
                window.alert(window.translations.errorStartingAnalysis);
            }
        }
    },
    
    async bulkExport() {
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
        
        if (selected.length === 0) {
            if (window.showWarning) {
                window.showWarning(window.translations.pleaseSelectFilesToExport);
            } else if (window.alert) {
                window.alert(window.translations.pleaseSelectFilesToExport);
            }
            return;
        }
        
        // Create a form and submit for download
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/files/export';
        
        selected.forEach(id => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'file_ids';
            input.value = id;
            form.appendChild(input);
        });
        
        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
    },
    
    async bulkDelete() {
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
        
        if (selected.length === 0) {
            if (window.showWarning) {
                window.showWarning(window.translations.pleaseSelectFilesToDelete);
            } else if (window.alert) {
                window.alert(window.translations.pleaseSelectFilesToDelete);
            }
            return;
        }
        
        if (!confirm(`${selected.length} ${window.translations.deleteFilesConfirm}`)) {
            return;
        }
        
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        
        try {
            const response = await fetch('/files/bulk-delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({ file_ids: selected })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                const message = `${window.translations.deletedFiles} ${selected.length} ${window.translations.files}`;
                if (window.showSuccess) {
                    window.showSuccess(message);
                } else if (window.alert) {
                    window.alert(message);
                }
                window.location.href = window.location.pathname + '?t=' + Date.now();
            } else {
                const errorMsg = window.translations.errorDeletingFiles + ': ' + (data.error || 'Unknown error');
                if (window.showError) {
                    window.showError(errorMsg);
                } else if (window.alert) {
                    window.alert(errorMsg);
                }
            }
        } catch (error) {
            console.error('Error:', error);
            if (window.showError) {
                window.showError(window.translations.errorDeletingFiles);
            } else if (window.alert) {
                window.alert(window.translations.errorDeletingFiles);
            }
        }
    },
    
    // ==================== SINGLE FILE OPERATIONS ====================
    async deleteFile(fileId) {
        if (!confirm(window.translations.deleteFileConfirm)) {
            return;
        }
        
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
        
        try {
            const response = await fetch(`/file/${fileId}/delete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                }
            });
            
            const data = await response.json();
            
            if (response.ok) {
                if (window.showSuccess) {
                    window.showSuccess(window.translations.fileDeleted);
                } else if (window.alert) {
                    window.alert(window.translations.fileDeleted);
                }
                window.location.href = window.location.pathname + '?t=' + Date.now();
            } else {
                const errorMsg = window.translations.errorDeletingFile + ': ' + (data.error || 'Unknown error');
                if (window.showError) {
                    window.showError(errorMsg);
                } else if (window.alert) {
                    window.alert(errorMsg);
                }
            }
        } catch (error) {
            console.error('Error:', error);
            if (window.showError) {
                window.showError(window.translations.errorDeletingFile);
            } else if (window.alert) {
                window.alert(window.translations.errorDeletingFile);
            }
        }
    },
    
    // ==================== PREVIEW ====================
    quickPreview(fileId) {
        // Placeholder for quick preview functionality
        console.log('Quick preview for file:', fileId);
        // You can implement a modal preview here
    }
};

// ==================== GLOBAL FUNCTIONS (for onclick handlers) ====================
function selectAllFiles() {
    FileManagement.selectAllFiles();
}

function deselectAllFiles() {
    FileManagement.deselectAllFiles();
}

function toggleSelectAll(checkbox) {
    FileManagement.toggleSelectAll(checkbox);
}

function updateBulkToolbar() {
    FileManagement.updateBulkToolbar();
}

function clearFileSearch() {
    FileManagement.clearFileSearch();
}

function changeFilesPageSize() {
    FileManagement.changeFilesPageSize();
}

function bulkAnalyze() {
    FileManagement.bulkAnalyze();
}

function bulkExport() {
    FileManagement.bulkExport();
}

function bulkDelete() {
    FileManagement.bulkDelete();
}

function deleteFile(fileId) {
    FileManagement.deleteFile(fileId);
}

function quickPreview(fileId) {
    FileManagement.quickPreview(fileId);
}

// ==================== INITIALIZE ====================
document.addEventListener('DOMContentLoaded', () => {
    FileManagement.init();
});