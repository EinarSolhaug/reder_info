/**
 * Chunked Upload Client
 * Handles large file uploads by breaking them into smaller chunks
 */

class ChunkedUploadClient {
    constructor(options = {}) {
        this.chunkSize = options.chunkSize || 5 * 1024 * 1024; // 5MB default
        this.maxRetries = options.maxRetries || 3;
        this.retryDelay = options.retryDelay || 1000; // 1 second
        this.onProgress = options.onProgress || (() => {});
        this.onComplete = options.onComplete || (() => {});
        this.onError = options.onError || (() => {});
        
        this.activeUploads = new Map();
    }
    
    /**
     * Calculate file hash using Web Crypto API
     */
    async calculateFileHash(file) {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }
    
    /**
     * Start chunked upload
     */
    async upload(file, sourceId, sideId, autoAnalyze = false) {
        try {
            // Validate inputs
            if (!file || !sourceId || !sideId) {
                throw new Error('Missing required parameters');
            }
            
            // Calculate file hash
            console.log('Calculating file hash...');
            const fileHash = await this.calculateFileHash(file);
            console.log(`File hash: ${fileHash}`);
            
            // Start upload session
            console.log('Starting upload session...');
            const session = await this.startUploadSession(
                file.name,
                file.size,
                fileHash,
                sourceId,
                sideId,
                autoAnalyze
            );
            
            if (!session.success) {
                throw new Error(session.error || 'Failed to start upload session');
            }
            
            const uploadId = session.upload_id;
            const totalChunks = session.total_chunks;
            const chunkSize = session.chunk_size;
            
            console.log(`Upload session started: ${uploadId}`);
            console.log(`Total chunks: ${totalChunks}, Chunk size: ${chunkSize}`);
            
            // Store upload info
            this.activeUploads.set(uploadId, {
                file,
                uploadId,
                totalChunks,
                chunkSize,
                uploadedChunks: 0,
                cancelled: false
            });
            
            // Upload chunks
            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                // Check if cancelled
                const uploadInfo = this.activeUploads.get(uploadId);
                if (uploadInfo.cancelled) {
                    console.log('Upload cancelled');
                    throw new Error('Upload cancelled by user');
                }
                
                // Upload chunk with retry
                await this.uploadChunkWithRetry(
                    uploadId,
                    file,
                    chunkIndex,
                    chunkSize,
                    this.maxRetries
                );
                
                // Update progress
                uploadInfo.uploadedChunks = chunkIndex + 1;
                const progress = (uploadInfo.uploadedChunks / totalChunks) * 100;
                
                this.onProgress({
                    uploadId,
                    progress,
                    uploadedChunks: uploadInfo.uploadedChunks,
                    totalChunks,
                    fileName: file.name
                });
            }
            
            // Complete upload
            console.log('Completing upload...');
            const result = await this.completeUpload(uploadId);
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to complete upload');
            }
            
            console.log('Upload completed successfully!');
            
            // Cleanup
            this.activeUploads.delete(uploadId);
            
            // Call completion callback
            this.onComplete(result);
            
            return result;
            
        } catch (error) {
            console.error('Upload error:', error);
            this.onError(error);
            throw error;
        }
    }
    
    /**
     * Start upload session
     */
    async startUploadSession(filename, totalSize, fileHash, sourceId, sideId, autoAnalyze) {
        const response = await fetch('/upload/chunked/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': this.getCSRFToken()
            },
            body: JSON.stringify({
                filename,
                total_size: totalSize,
                file_hash: fileHash,
                source_id: sourceId,
                side_id: sideId,
                chunk_size: this.chunkSize,
                auto_analyze: autoAnalyze
            })
        });
        
        return await response.json();
    }
    
    /**
     * Upload single chunk with retry
     */
    async uploadChunkWithRetry(uploadId, file, chunkIndex, chunkSize, retriesLeft) {
        try {
            await this.uploadChunk(uploadId, file, chunkIndex, chunkSize);
        } catch (error) {
            if (retriesLeft > 0) {
                console.warn(`Chunk ${chunkIndex} failed, retrying... (${retriesLeft} retries left)`);
                await this.sleep(this.retryDelay);
                return await this.uploadChunkWithRetry(
                    uploadId,
                    file,
                    chunkIndex,
                    chunkSize,
                    retriesLeft - 1
                );
            } else {
                throw new Error(`Failed to upload chunk ${chunkIndex} after ${this.maxRetries} retries`);
            }
        }
    }
    
    /**
     * Upload single chunk
     */
    async uploadChunk(uploadId, file, chunkIndex, chunkSize) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        
        const formData = new FormData();
        formData.append('chunk', chunk);
        
        const response = await fetch(
            `/upload/chunked/${uploadId}/chunk/${chunkIndex}`,
            {
                method: 'POST',
                headers: {
                    'X-CSRFToken': this.getCSRFToken()
                },
                body: formData
            }
        );
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.error || 'Chunk upload failed');
        }
        
        return result;
    }
    
    /**
     * Complete upload
     */
    async completeUpload(uploadId) {
        const response = await fetch(`/upload/chunked/${uploadId}/complete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': this.getCSRFToken()
            }
        });
        
        return await response.json();
    }
    
    /**
     * Cancel upload
     */
    async cancelUpload(uploadId) {
        // Mark as cancelled locally
        const uploadInfo = this.activeUploads.get(uploadId);
        if (uploadInfo) {
            uploadInfo.cancelled = true;
        }
        
        // Cancel on server
        try {
            const response = await fetch(`/upload/chunked/${uploadId}/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCSRFToken()
                }
            });
            
            return await response.json();
        } catch (error) {
            console.error('Error cancelling upload:', error);
            throw error;
        }
    }
    
    /**
     * Get upload status
     */
    async getUploadStatus(uploadId) {
        try {
            const response = await fetch(`/upload/chunked/${uploadId}/status`);
            return await response.json();
        } catch (error) {
            console.error('Error getting upload status:', error);
            throw error;
        }
    }
    
    /**
     * Get CSRF token from meta tag or cookie
     */
    getCSRFToken() {
        // Try meta tag first
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        if (metaTag) {
            return metaTag.getAttribute('content');
        }
        
        // Try cookie
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'csrf_token') {
                return value;
            }
        }
        
        return '';
    }
    
    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Format file size
     */
    static formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    /**
     * Format upload speed
     */
    static formatSpeed(bytesPerSecond) {
        return this.formatFileSize(bytesPerSecond) + '/s';
    }
}

/**
 * UI Component for Chunked Upload
 */
class ChunkedUploadUI {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container element not found: ${containerId}`);
        }
        
        this.client = new ChunkedUploadClient({
            chunkSize: options.chunkSize || 5 * 1024 * 1024,
            onProgress: this.handleProgress.bind(this),
            onComplete: this.handleComplete.bind(this),
            onError: this.handleError.bind(this)
        });
        
        this.uploads = new Map();
        
        this.render();
    }
    
    render() {
        this.container.innerHTML = `
            <div class="chunked-upload-container">
                <div class="upload-controls">
                    <input type="file" id="chunked-file-input" multiple style="display: none;">
                    <button class="btn btn-primary" onclick="document.getElementById('chunked-file-input').click()">
                        <i class="fas fa-upload"></i> Select Files
                    </button>
                    <span class="upload-info"></span>
                </div>
                <div class="upload-list" id="chunked-upload-list"></div>
            </div>
        `;
        
        // Setup file input handler
        const fileInput = document.getElementById('chunked-file-input');
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }
    
    async handleFileSelect(event) {
        const files = Array.from(event.target.files);
        
        if (files.length === 0) {
            return;
        }
        
        // Get source and side from form (assuming they exist)
        const sourceId = parseInt(document.getElementById('source_id')?.value);
        const sideId = parseInt(document.getElementById('side_id')?.value);
        const autoAnalyze = document.getElementById('auto_analyze')?.checked || false;
        
        if (!sourceId || !sideId) {
            alert('Please select source and side');
            return;
        }
        
        // Upload each file
        for (const file of files) {
            await this.uploadFile(file, sourceId, sideId, autoAnalyze);
        }
        
        // Clear file input
        event.target.value = '';
    }
    
    async uploadFile(file, sourceId, sideId, autoAnalyze) {
        const uploadId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        // Add to UI
        this.addUploadToUI(uploadId, file);
        
        try {
            await this.client.upload(file, sourceId, sideId, autoAnalyze);
        } catch (error) {
            this.updateUploadStatus(uploadId, 'error', error.message);
        }
    }
    
    addUploadToUI(uploadId, file) {
        const list = document.getElementById('chunked-upload-list');
        
        const uploadDiv = document.createElement('div');
        uploadDiv.id = `upload-${uploadId}`;
        uploadDiv.className = 'upload-item';
        uploadDiv.innerHTML = `
            <div class="upload-item-header">
                <span class="file-name">${file.name}</span>
                <span class="file-size">${ChunkedUploadClient.formatFileSize(file.size)}</span>
            </div>
            <div class="progress">
                <div class="progress-bar" role="progressbar" style="width: 0%"></div>
            </div>
            <div class="upload-status">Preparing...</div>
        `;
        
        list.appendChild(uploadDiv);
        
        this.uploads.set(uploadId, {
            element: uploadDiv,
            startTime: Date.now()
        });
    }
    
    handleProgress(progressData) {
        const uploadDiv = this.uploads.get(progressData.uploadId)?.element;
        if (!uploadDiv) return;
        
        const progressBar = uploadDiv.querySelector('.progress-bar');
        const statusDiv = uploadDiv.querySelector('.upload-status');
        
        progressBar.style.width = `${progressData.progress}%`;
        progressBar.textContent = `${Math.round(progressData.progress)}%`;
        
        statusDiv.textContent = `Uploading chunk ${progressData.uploadedChunks}/${progressData.totalChunks}...`;
    }
    
    handleComplete(result) {
        console.log('Upload complete:', result);
        alert(`Upload complete: ${result.filename}`);
    }
    
    handleError(error) {
        console.error('Upload error:', error);
        alert(`Upload error: ${error.message}`);
    }
    
    updateUploadStatus(uploadId, status, message) {
        const uploadDiv = this.uploads.get(uploadId)?.element;
        if (!uploadDiv) return;
        
        const statusDiv = uploadDiv.querySelector('.upload-status');
        statusDiv.textContent = message;
        statusDiv.className = `upload-status ${status}`;
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ChunkedUploadClient, ChunkedUploadUI };
}


// Helper function to format translation strings with placeholders
function formatTranslation(key, params = {}) {
    let text = translations[key] || key;
    Object.keys(params).forEach(param => {
        text = text.replace(`{${param}}`, params[param]);
    });
    return text;
}

let isProcessing = false;
let logLines = [];
let currentProgress = 0;
let totalFiles = 0;
let processedFiles = 0;
let isDirectory = false;

// File picker functionality
const filePickerBtn = document.getElementById('filePickerBtn');
const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const filePathInput = document.getElementById('filePathInput');
// Progress bar elements are now dynamically rendered

// Show file/folder picker menu
filePickerBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (isProcessing) {
        addLog('warning', translations.cannotChangeFileSelection);
        return;
    }
    
    // Remove any existing menu
    const existingMenu = document.getElementById('filePickerMenu');
    if (existingMenu) {
        document.body.removeChild(existingMenu);
        return;
    }
    
    // Create a simple menu
    const menu = document.createElement('div');
    menu.id = 'filePickerMenu';
    menu.style.cssText = 'position: fixed; background: #252526; border: 1px solid #3e3e42; border-radius: 4px; padding: 8px; z-index: 1000; box-shadow: 0 4px 6px rgba(0,0,0,0.3); min-width: 180px;';
    
    // Check if File System Access API is available (Chrome/Edge)
    const hasFileSystemAccess = 'showOpenFilePicker' in window;
    
    const fileBtn = document.createElement('button');
    fileBtn.type = 'button';
    fileBtn.style.cssText = 'display: block; width: 100%; padding: 8px 12px; background: #3e3e42; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 4px; text-align: left; font-family: inherit;';
    fileBtn.innerHTML = '<i class="bi bi-file-earmark me-2"></i>' + translations.selectFiles + (hasFileSystemAccess ? ' <small>(' + translations.fullPath + ')</small>' : '');
    fileBtn.addEventListener('click', async function() {
        document.body.removeChild(menu);
        
        // Try File System Access API first (provides full paths)
        if (hasFileSystemAccess) {
            try {
                const fileHandles = await window.showOpenFilePicker({
                    multiple: true
                });
                
                if (fileHandles.length > 0) {
                    const firstHandle = fileHandles[0];
                    // Get the file to access its path
                    const file = await firstHandle.getFile();
                    
                    // File System Access API: Try to get path
                    // Note: The API doesn't directly expose paths, but file.path might work in some implementations
                    let filePath = '';
                    
                    if (file.path) {
                        filePath = file.path;
                    } else {
                        // Try to construct path from handle name and file name
                        // Unfortunately, File System Access API doesn't expose full paths directly
                        // We'll need to fall back to regular input
                        addLog('warning', translations.fileSystemAccessAPISelected);
                        addLog('info', translations.fallingBackToRegularInput);
                        fileInput.click();
                        return;
                    }
                    
                    if (fileHandles.length === 1) {
                        if (filePath) {
                            filePathInput.value = filePath;
                            addLog('success', translations.fullPathSelected + ' ' + filePath);
                        } else {
                            // Fallback to regular file input
                            fileInput.click();
                        }
                    } else {
                        // For multiple files, get common directory
                        const paths = await Promise.all(fileHandles.map(async (handle) => {
                            const f = await handle.getFile();
                            return f.path || '';
                        }));
                        const validPaths = paths.filter(p => p);
                        if (validPaths.length > 0) {
                            const firstPath = validPaths[0];
                            const lastSep = Math.max(firstPath.lastIndexOf('\\'), firstPath.lastIndexOf('/'));
                            if (lastSep > 0) {
                                filePathInput.value = firstPath.substring(0, lastSep);
                                addLog('success', formatTranslation('selectedFilesFrom', {count: fileHandles.length}) + ' ' + filePathInput.value);
                            } else {
                                fileInput.click();
                            }
                        } else {
                            fileInput.click();
                        }
                    }
                }
            } catch (err) {
                if (err.name !== 'AbortError') {
                    // User cancelled or error - fallback to regular input
                    fileInput.click();
                }
            }
        } else {
            // Use regular file input
            fileInput.click();
        }
    });
    
    const folderBtn = document.createElement('button');
    folderBtn.type = 'button';
    folderBtn.style.cssText = 'display: block; width: 100%; padding: 8px 12px; background: #3e3e42; color: white; border: none; border-radius: 4px; cursor: pointer; text-align: left; font-family: inherit;';
    folderBtn.innerHTML = '<i class="bi bi-folder me-2"></i>' + translations.selectFolder + (hasFileSystemAccess ? ' <small>(' + translations.fullPath + ')</small>' : '');
    folderBtn.addEventListener('click', async function() {
        document.body.removeChild(menu);
        
        // Try File System Access API first (provides full paths in Chrome/Edge)
        if (hasFileSystemAccess && 'showDirectoryPicker' in window) {
            try {
                const dirHandle = await window.showDirectoryPicker();
                
                // File System Access API: Try to get the directory path
                // Note: The API doesn't directly expose paths, but we can try to get it from files
                let foundPath = false;
                
                // Try to get path from directory handle name and construct full path
                // Unfortunately, File System Access API doesn't expose full paths directly
                // We need to iterate through files to try to get path info
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file') {
                        try {
                            const file = await entry.getFile();
                            // Some implementations might expose path
                            if (file.path) {
                                const filePath = file.path;
                                const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
                                if (lastSep > 0) {
                                    const folderPath = filePath.substring(0, lastSep);
                                    filePathInput.value = folderPath;
                                    addLog('success', translations.fullFolderPathSelected + ' ' + folderPath);
                                    foundPath = true;
                                    return;
                                }
                            }
                        } catch (fileErr) {
                            // Continue to next file
                        }
                        // Only check first few files
                        if (foundPath) break;
                    }
                }
                
                // If we couldn't get path, use directory name as fallback
                // Get directory name from the handle
                const dirName = dirHandle.name || translations.selectFolder;
                addLog('warning', translations.selectedFolder + ' ' + dirName);
                addLog('warning', translations.couldNotExtractFullPath);
                addLog('info', translations.examplePath + ' C:\\Users\\YourName\\Documents\\' + dirName);
                
                // Don't set a value - let user enter it manually
                // Or set it to the folder name as a hint
                filePathInput.value = dirName;
                filePathInput.focus();
                filePathInput.select();
                
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Directory picker error:', err);
                    folderInput.click();
                }
            }
        } else {
            // Use regular folder input
            folderInput.click();
        }
    });
    
    menu.appendChild(fileBtn);
    menu.appendChild(folderBtn);
    
    // Position menu
    const rect = filePickerBtn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 5) + 'px';
    menu.style.left = (rect.left) + 'px';
    
    document.body.appendChild(menu);
    
    // Remove menu on outside click
    setTimeout(() => {
        const removeMenu = (e) => {
            if (!menu.contains(e.target) && e.target !== filePickerBtn) {
                if (document.body.contains(menu)) {
                    document.body.removeChild(menu);
                }
                document.removeEventListener('click', removeMenu);
            }
        };
        document.addEventListener('click', removeMenu);
    }, 100);
});

// Helper function to get full file path
function getFullFilePath(file, input) {
    // Method 1: Try file.path (works in Electron and some browsers)
    if (file.path) {
        return file.path;
    }
    
    // Method 2: Try input.value and clean it up
    if (input && input.value) {
        let path = input.value;
        // Remove "C:\fakepath\" prefix that Chrome/Edge add
        path = path.replace(/^C:\\fakepath\\/i, '');
        // Remove "fakepath/" prefix that Firefox adds
        path = path.replace(/^fakepath\//i, '');
        
        // If it's not just a filename, return it
        if (path && path !== file.name && (path.includes('\\') || path.includes('/'))) {
            return path;
        }
    }
    
    // Method 3: Try to construct from webkitRelativePath (for folders)
    if (file.webkitRelativePath) {
        // This gives relative path, not absolute, but better than nothing
        const relativePath = file.webkitRelativePath;
        const dirPath = relativePath.substring(0, relativePath.lastIndexOf('/'));
        if (dirPath) {
            return dirPath;
        }
    }
    
    // Fallback: return filename (user will need to enter full path)
    return file.name;
}

// Helper function to get full folder path
function getFullFolderPath(firstFile, input, allFiles) {
    // Method 1: Try file.path and extract directory
    if (firstFile.path) {
        const filePath = firstFile.path;
        const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
        if (lastSep > 0) {
            return filePath.substring(0, lastSep);
        }
        return filePath;
    }
    
    // Method 2: Try input.value
    if (input && input.value) {
        let path = input.value;
        // Remove "C:\fakepath\" prefix
        path = path.replace(/^C:\\fakepath\\/i, '');
        path = path.replace(/^fakepath\//i, '');
        
        // If we have a path, try to extract directory
        if (path && (path.includes('\\') || path.includes('/'))) {
            const lastSep = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
            if (lastSep > 0) {
                return path.substring(0, lastSep);
            }
            return path;
        }
    }
    
    // Method 3: Use webkitRelativePath to get folder structure
    if (firstFile.webkitRelativePath) {
        const relativePath = firstFile.webkitRelativePath;
        const pathParts = relativePath.split('/');
        if (pathParts.length > 1) {
            // Get the base folder name
            const baseFolder = pathParts[0];
            
            // Try to find if any file has more path info
            for (let i = 0; i < Math.min(allFiles.length, 10); i++) {
                const file = allFiles[i];
                if (file.path) {
                    const filePath = file.path;
                    const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
                    if (lastSep > 0) {
                        return filePath.substring(0, lastSep);
                    }
                }
            }
            
            return baseFolder;
        }
    }
    
    return '';
}

fileInput.addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
        const file = e.target.files[0];
        
        addLog('info', translations.selectedFile + ' ' + file.name);
        
        // Try multiple methods to get full path
        let fullPath = '';
        let foundFullPath = false;
        
        // Method 1: Try file.path (works in Electron and some browsers)
        if (file.path) {
            fullPath = file.path;
            // Verify it looks like a full path
            if (fullPath.includes(':') || fullPath.startsWith('/') || fullPath.startsWith('\\')) {
                foundFullPath = true;
            }
        }
        
        // Method 2: Try input.value and clean it up
        if (!foundFullPath && e.target.value) {
            let path = e.target.value;
            // Remove "C:\fakepath\" prefix that Chrome/Edge add
            path = path.replace(/^C:\\fakepath\\/i, '');
            // Remove "fakepath/" prefix that Firefox adds
            path = path.replace(/^fakepath\//i, '');
            
            // If it's not just a filename, it might be a path
            if (path && path !== file.name && (path.includes('\\') || path.includes('/'))) {
                fullPath = path;
                // Check if it looks like a full path
                if (fullPath.includes(':') || fullPath.startsWith('/') || fullPath.startsWith('\\') ||
                    (fullPath.includes('\\') && fullPath.split('\\').length > 1) ||
                    (fullPath.includes('/') && fullPath.split('/').length > 1)) {
                    foundFullPath = true;
                }
            }
        }
        
        // Method 3: Check if we can get path from File System Access API
        // (This would have been handled in the button click, but check here too)
        
        if (e.target.files.length === 1) {
            if (foundFullPath && fullPath) {
                filePathInput.value = fullPath;
                addLog('success', translations.fullPathExtracted + ' ' + fullPath);
            } else {
                // We only have the filename, not full path
                filePathInput.value = '';
                addLog('warning', translations.fileSelected + ' "' + file.name + '"');
                addLog('error', '⚠️ ' + translations.fullAbsolutePathCouldNotBeExtracted);
                addLog('info', translations.pleaseEnterCompleteAbsolutePath);
                addLog('info', translations.examplePaths);
                addLog('info', '  ' + translations.windows + ' C:\\Users\\YourName\\Documents\\' + file.name);
                addLog('info', '  ' + translations.windows + ' C:\\Users\\YourName\\Desktop\\' + file.name);
                addLog('info', '  ' + translations.linuxMac + ' /home/username/documents/' + file.name);
                
                // Focus the input field to make it easy for user to type
                setTimeout(() => {
                    filePathInput.focus();
                    filePathInput.placeholder = formatTranslation('enterFullPath', {filename: file.name});
                }, 100);
            }
        } else {
            // For multiple files, try to get common directory
            const files = Array.from(e.target.files);
            let commonPath = '';
            let foundCommonPath = false;
            
            // Check all files for path info
            for (let i = 0; i < Math.min(files.length, 50); i++) {
                const f = files[i];
                let path = '';
                
                if (f.path) {
                    path = f.path;
                } else if (e.target.value) {
                    path = e.target.value.replace(/^C:\\fakepath\\/i, '').replace(/^fakepath\//i, '');
                }
                
                if (path && path !== f.name && (path.includes('\\') || path.includes('/'))) {
                    const lastSep = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
                    if (lastSep > 0) {
                        const dirPath = path.substring(0, lastSep);
                        // Verify it's a full path
                        if (dirPath.includes(':') || dirPath.startsWith('/') || dirPath.startsWith('\\')) {
                            if (!commonPath) {
                                commonPath = dirPath;
                                foundCommonPath = true;
                            } else if (commonPath === dirPath) {
                                // Same directory, good
                                foundCommonPath = true;
                            }
                        }
                    }
                }
            }
            
            if (foundCommonPath && commonPath) {
                filePathInput.value = commonPath;
                addLog('success', formatTranslation('selectedFilesFrom', {count: e.target.files.length}) + ' ' + commonPath);
            } else {
                filePathInput.value = '';
                addLog('warning', formatTranslation('selectedFiles', {count: e.target.files.length}));
                addLog('error', translations.couldNotDetermineCommonDirectory);
                filePathInput.focus();
            }
        }
    }
});

folderInput.addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
        const firstFile = e.target.files[0];
        const allFiles = Array.from(e.target.files);
        
        addLog('info', formatTranslation('selectedFolderWithFiles', {count: e.target.files.length}));
        
        // Try to get full path - check more files for path info
        let fullPath = '';
        let foundFullPath = false;
        
        // First, try the helper function
        fullPath = getFullFolderPath(firstFile, e.target, allFiles);
        
        // Check if it's a full path
        const isFullPath = fullPath && (
            fullPath.includes(':') || 
            fullPath.startsWith('/') || 
            fullPath.startsWith('\\') ||
            (fullPath.includes('\\') && fullPath.split('\\').length > 2) ||
            (fullPath.includes('/') && fullPath.split('/').length > 2)
        );
        
        if (isFullPath) {
            foundFullPath = true;
        } else if (fullPath) {
            // We have a relative path (just folder name)
            // Try to get more info by checking more files
            addLog('info', translations.checkingFilesForPathInformation);
            
            // Check up to 100 files for path information
            for (let i = 0; i < Math.min(allFiles.length, 100); i++) {
                const file = allFiles[i];
                
                // Check file.path
                if (file.path) {
                    const filePath = file.path;
                    const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
                    if (lastSep > 0) {
                        const folderPath = filePath.substring(0, lastSep);
                        // Verify it's a full path
                        if (folderPath.includes(':') || folderPath.startsWith('/') || folderPath.startsWith('\\')) {
                            fullPath = folderPath;
                            foundFullPath = true;
                            break;
                        }
                    }
                }
                
                // Check input.value for this specific file (if we can access it)
                // Note: We can't access individual file inputs, but we can check the main input
            }
        }
        
        if (foundFullPath && fullPath) {
            filePathInput.value = fullPath;
            addLog('success', translations.fullPathExtracted + ' ' + fullPath);
        } else if (fullPath) {
            // We only have the folder name, not full path
            filePathInput.value = '';
            addLog('warning', translations.folderNameDetected + ' "' + fullPath + '"');
            addLog('error', '⚠️ ' + translations.fullAbsolutePathCouldNotBeExtracted);
            addLog('info', translations.pleaseEnterCompleteAbsolutePath);
            addLog('info', translations.examplePaths);
            addLog('info', '  ' + translations.windows + ' C:\\Users\\YourName\\Documents\\' + fullPath);
            addLog('info', '  ' + translations.windows + ' C:\\Users\\YourName\\Desktop\\' + fullPath);
            addLog('info', '  ' + translations.linuxMac + ' /home/username/documents/' + fullPath);
            
            // Focus the input field to make it easy for user to type
            setTimeout(() => {
                filePathInput.focus();
                filePathInput.placeholder = formatTranslation('enterFullPath', {filename: fullPath});
            }, 100);
        } else {
            filePathInput.value = '';
            addLog('error', translations.couldNotExtractAnyFolderPath);
            addLog('info', translations.pleaseEnterFullAbsolutePath);
            addLog('info', translations.exampleFolderPath);
            filePathInput.focus();
        }
    }
});

// Render progress bar in Dashboard format
function renderProgressBar(progress) {
    const container = document.getElementById('processingProgressContainer');
    const tasksList = document.getElementById('activeTasksList');
    
    if (!container || !tasksList) return;
    
    // Calculate progress percentage
    const progressPercent = progress.total > 0 
        ? Math.min((progress.current / progress.total) * 100, 100) 
        : 0;
    
    const statusClass = progress.status === 'paused' ? 'paused' : 'running';
    const statusIcon = progress.status === 'paused' ? 'bi-hourglass-split' : 'bi-arrow-repeat';
    
    // Get label (includes nested file info from backend)
    const label = progress.label || `Processing: ${progress.current || 0} of ${progress.total || 0} files`;
    const message = progress.message || '';
    
    // Escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Render task item with controls
    tasksList.innerHTML = `
        <div class="processing-task-item ${statusClass}">
            <div class="task-header">
                <div class="task-info">
                    <i class="bi ${statusIcon}"></i>
                    <span class="task-label">${escapeHtml(label)}</span>
                </div>
                <span class="task-percent">${Math.round(progressPercent)}%</span>
            </div>
            <div class="task-message">${escapeHtml(message)}</div>
            <div class="progress-bar-wrapper" style="margin-top: 0.5rem;">
                <div class="progress-bar">
                    <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
                    <div class="progress-bar-text">${progress.current || 0} / ${progress.total || 0} files</div>
                </div>
            </div>
            <div class="task-controls">
                ${progress.status === 'paused' 
                    ? `<button class="btn-resume" onclick="resumeProcessing()">
                           <i class="bi bi-play-fill me-1"></i> Resume
                       </button>`
                    : `<button class="btn-pause" onclick="pauseProcessing()">
                           <i class="bi bi-pause-fill me-1"></i> Pause
                       </button>`
                }
                <button class="btn-cancel" onclick="cancelProcessing()">
                    <i class="bi bi-stop-fill me-1"></i> Cancel
                </button>
            </div>
        </div>
    `;
    
    // Show container
    container.style.display = 'block';
}

function resetProgress() {
    currentProgress = 0;
    processedFiles = 0;
    totalFiles = 0;
    isDirectory = false;
    const container = document.getElementById('processingProgressContainer');
    if (container) {
        container.style.display = 'none';
    }
}

function showProgress() {
    // Show progress container and render initial state
    const container = document.getElementById('processingProgressContainer');
    if (container) {
        container.style.display = 'block';
        // Render initial progress state if not already rendered
        if (!document.querySelector('.processing-task-item')) {
            renderProgressBar({
                status: 'running',
                current: 0,
                total: 0,
                label: 'Initializing...',
                message: 'Starting processing...'
            });
        }
    }
}

document.getElementById('cliForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (isProcessing) {
        addLog('error', translations.processAlreadyRunning);
        return;
    }

    const filePath = document.getElementById('filePathInput').value.trim();
    const sourceId = document.getElementById('sourceSelect').value;
    const sideId = document.getElementById('sideSelect').value;

    if (!filePath) {
        addLog('error', translations.pleaseEnterFilePath);
        return;
    }

    if (!sourceId || !sideId) {
        addLog('error', translations.pleaseSelectBothSourceAndSide);
        return;
    }

    startProcessing(filePath, sourceId, sideId);
});

let currentTaskId = null;
let progressPollInterval = null;

async function startProcessing(filePath, sourceId, sideId) {
    isProcessing = true;
    document.getElementById('processBtn').disabled = true;
    filePickerBtn.disabled = true;
    document.getElementById('processStatus').textContent = translations.processingStatus;
    document.getElementById('processStatus').className = 'cli-status processing';
    
    // Reset and show progress
    resetProgress();
    showProgress();
    
    addLog('prompt', translations.processing + ' ' + filePath);
    addLog('info', translations.sourceID + ' ' + sourceId + ', ' + translations.sideID + ' ' + sideId);
    addLog('info', '---');

    try {
        // ✅ SECURITY: Get CSRF token from meta tag
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        
        // Start background processing task
        const response = await fetch('/upload/process-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken || ''
            },
            body: JSON.stringify({
                file_path: filePath,
                source_id: parseInt(sourceId),
                side_id: parseInt(sideId)
            })
        });

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || '';
            let error;
            try {
                if (contentType.includes('application/json')) {
                    error = await response.json();
                } else {
                    const text = await response.text();
                    error = { error: translations.processingFailed || 'Request failed' };
                    addLog('error', `HTTP ${response.status}: ${error.error}`);
                }
            } catch (parseError) {
                error = { error: translations.processingFailed || 'Request failed' };
            }
            throw new Error(error.error || translations.processingFailed);
        }

        const result = await response.json();
        
        if (!result.success || !result.task_id) {
            throw new Error(result.error || translations.processingFailed);
        }

        // Store task ID and start polling for progress
        currentTaskId = result.task_id;
        
        // Save task state to localStorage for persistence across page refreshes
        // Include initial progress state
        saveTaskState(currentTaskId, filePath, sourceId, sideId, {
            status: 'running',
            current: 0,
            total: 0,
            label: 'Initializing...',
            message: 'Starting processing...'
        }, logLines);
        
        addLog('info', 'Processing started in background. Task ID: ' + currentTaskId.substring(0, 8) + '...');
        
        // Show progress bar immediately
        showProgress();
        
        // Start polling for progress updates
        startProgressPolling(currentTaskId);

    } catch (error) {
        // Provide more specific error messages
        let errorMessage = translations.unknownErrorOccurred;
        
        if (error.name === 'TypeError' && error.message.includes('network')) {
            errorMessage = translations.networkError;
        } else if (error.name === 'AbortError') {
            errorMessage = translations.requestWasCancelled;
        } else if (error.message) {
            errorMessage = error.message;
        } else {
            errorMessage = translations.error + ' ' + (error.name || translations.unknownError);
        }
        
        addLog('error', errorMessage);
        document.getElementById('processStatus').textContent = translations.errorStatus;
        document.getElementById('processStatus').className = 'cli-status error';
        
        // Stop processing state
        isProcessing = false;
        document.getElementById('processBtn').disabled = false;
        filePickerBtn.disabled = false;
        
        // Hide progress bar after delay
        setTimeout(() => {
            if (!isProcessing) {
                const container = document.getElementById('processingProgressContainer');
                if (container) {
                    container.style.display = 'none';
                }
            }
        }, 2000);
    }
}

function startProgressPolling(taskId) {
    // Clear any existing polling interval
    if (progressPollInterval) {
        clearInterval(progressPollInterval);
    }
    
    // Poll every 2 seconds for progress updates (matching Dashboard, prevents rate limiting)
    progressPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`/upload/progress/${taskId}`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    // Task not found - might have been cleaned up
                    stopProgressPolling();
                    return;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const progress = await response.json();
            
            // Update progress bar with nested file support
            // Backend already calculates total including nested files
            if (progress.total > 0) {
                totalFiles = progress.total;
            }
            processedFiles = progress.current || 0;
            
            // Render progress bar in Dashboard format
            renderProgressBar(progress);
            
            // Add new log entries
            if (progress.logs && progress.logs.length > 0) {
                // Only add new logs (compare with existing)
                const existingLogCount = logLines.length;
                const newLogs = progress.logs.slice(existingLogCount);
                
                for (const logEntry of newLogs) {
                    addLog(logEntry.type || 'info', logEntry.message);
                }
                
                // Update saved logs for persistence
                logLines = progress.logs.map(log => ({
                    type: log.type || 'info',
                    message: log.message,
                    timestamp: new Date().toLocaleTimeString()
                }));
            }
            
            // ✅ Save updated progress state for instant restoration on next refresh
            if (currentTaskId) {
                const filePathInput = document.getElementById('filePathInput');
                const sourceSelect = document.getElementById('sourceSelect');
                const sideSelect = document.getElementById('sideSelect');
                saveTaskState(
                    currentTaskId,
                    filePathInput ? filePathInput.value : '',
                    sourceSelect ? sourceSelect.value : '',
                    sideSelect ? sideSelect.value : '',
                    progress,
                    logLines
                );
            }
            
            // Check if task is completed
            if (progress.status === 'completed') {
                stopProgressPolling();
                clearTaskState(); // Clear saved state when task completes
                addLog('success', translations.processCompletedSuccessfully);
                document.getElementById('processStatus').textContent = translations.success;
                document.getElementById('processStatus').className = 'cli-status success';
                
                // Render final progress state
                renderProgressBar(progress);
                
                // Reset processing state
                isProcessing = false;
                document.getElementById('processBtn').disabled = false;
                filePickerBtn.disabled = false;
                
                // Hide progress bar after delay
                setTimeout(() => {
                    if (!isProcessing) {
                        const container = document.getElementById('processingProgressContainer');
                        if (container) {
                            container.style.display = 'none';
                        }
                    }
                }, 2000);
                
            } else if (progress.status === 'failed' || progress.status === 'cancelled') {
                stopProgressPolling();
                clearTaskState(); // Clear saved state when task fails or is cancelled
                addLog('error', progress.error || (progress.status === 'cancelled' ? 'Processing cancelled' : translations.processingFailed));
                document.getElementById('processStatus').textContent = translations.errorStatus;
                document.getElementById('processStatus').className = 'cli-status error';
                
                // Reset processing state
                isProcessing = false;
                document.getElementById('processBtn').disabled = false;
                filePickerBtn.disabled = false;
                
                // Hide progress bar after delay
                setTimeout(() => {
                    if (!isProcessing) {
                        const container = document.getElementById('processingProgressContainer');
                        if (container) {
                            container.style.display = 'none';
                        }
                    }
                }, 2000);
            }
            
        } catch (error) {
            console.error('Error polling progress:', error);
            // Continue polling even on error (might be temporary network issue)
        }
    }, 2000); // Poll every 2 seconds (matching Dashboard, prevents rate limiting)
}

function stopProgressPolling() {
    if (progressPollInterval) {
        clearInterval(progressPollInterval);
        progressPollInterval = null;
    }
    // Don't clear currentTaskId here - it might be needed for restoration
}

// Save task state to localStorage (with progress and logs for instant restoration)
function saveTaskState(taskId, filePath, sourceId, sideId, progress = null, logs = null) {
    try {
        const taskState = {
            task_id: taskId,
            file_path: filePath,
            source_id: sourceId,
            side_id: sideId,
            timestamp: Date.now(),
            // Save last known progress for instant restoration
            last_progress: progress || null,
            // Save logs for instant restoration
            last_logs: logs || logLines || null
        };
        localStorage.setItem('fileProcessingTask', JSON.stringify(taskState));
    } catch (e) {
        console.warn('Failed to save task state to localStorage:', e);
    }
}

// Clear task state from localStorage
function clearTaskState() {
    try {
        localStorage.removeItem('fileProcessingTask');
        currentTaskId = null;
    } catch (e) {
        console.warn('Failed to clear task state from localStorage:', e);
    }
}

// Restore UI state instantly from localStorage (before API verification)
function restoreUIStateInstantly(taskState) {
    try {
        const taskId = taskState.task_id;
        currentTaskId = taskId;
        isProcessing = true;
        
        // Restore form values immediately
        const filePathInput = document.getElementById('filePathInput');
        const sourceSelect = document.getElementById('sourceSelect');
        const sideSelect = document.getElementById('sideSelect');
        const processBtn = document.getElementById('processBtn');
        const statusElement = document.getElementById('processStatus');
        
        if (filePathInput && taskState.file_path) {
            filePathInput.value = taskState.file_path;
        }
        if (sourceSelect && taskState.source_id) {
            sourceSelect.value = taskState.source_id;
        }
        if (sideSelect && taskState.side_id) {
            sideSelect.value = taskState.side_id;
        }
        
        // Disable form controls immediately
        if (processBtn) processBtn.disabled = true;
        if (filePickerBtn) filePickerBtn.disabled = true;
        
        // Update status immediately (use last known status or default to processing)
        if (statusElement) {
            if (taskState.last_progress && taskState.last_progress.status === 'paused') {
                statusElement.textContent = 'PAUSED';
                statusElement.className = 'cli-status warning';
            } else {
                statusElement.textContent = translations.processingStatus;
                statusElement.className = 'cli-status processing';
            }
        }
        
        // Restore logs instantly from saved state
        if (taskState.last_logs && taskState.last_logs.length > 0) {
            const container = document.getElementById('logContainer');
            if (container) {
                container.innerHTML = ''; // Clear existing logs
                logLines = [];
                
                // Restore all saved logs
                for (const logEntry of taskState.last_logs) {
                    const line = document.createElement('div');
                    line.className = `cli-log-line ${logEntry.type || 'info'}`;
                    line.textContent = logEntry.timestamp ? `[${logEntry.timestamp}] ${logEntry.message}` : logEntry.message;
                    container.appendChild(line);
                    logLines.push(logEntry);
                }
                
                // Add restoration message
                addLog('info', '---');
                addLog('info', `[${new Date().toLocaleTimeString()}] Session restored. Verifying with server...`);
                container.scrollTop = container.scrollHeight;
            }
        } else {
            // No saved logs, add restoration message
            addLog('info', `[${new Date().toLocaleTimeString()}] Session restored. Task ID: ${taskId.substring(0, 8)}... Verifying...`);
        }
        
        // Restore progress bar instantly if we have saved progress
        if (taskState.last_progress) {
            const progress = taskState.last_progress;
            if (progress.total > 0) {
                totalFiles = progress.total;
            }
            processedFiles = progress.current || 0;
            
            // Show progress bar immediately
            showProgress();
            renderProgressBar(progress);
        } else {
            // Show initial progress state
            showProgress();
            renderProgressBar({
                status: 'running',
                current: 0,
                total: 0,
                label: 'Restoring session...',
                message: 'Verifying task status...'
            });
        }
        
        return true;
    } catch (e) {
        console.error('Failed to restore UI state instantly:', e);
        return false;
    }
}

// Restore task state from localStorage (optimized for instant restoration)
async function restoreTaskState() {
    try {
        const savedState = localStorage.getItem('fileProcessingTask');
        if (!savedState) {
            return false;
        }
        
        const taskState = JSON.parse(savedState);
        const taskId = taskState.task_id;
        
        // ✅ INSTANT RESTORATION: Restore UI immediately from localStorage
        // This gives instant visual feedback before any API calls
        restoreUIStateInstantly(taskState);
        
        // ✅ BACKGROUND VERIFICATION: Verify with backend in parallel
        // This happens in the background and updates the UI if needed
        try {
            const response = await fetch(`/upload/progress/${taskId}`);
            
            if (!response.ok) {
                // Task not found or completed - clear saved state
                clearTaskState();
                // Update UI to show task is no longer active
                isProcessing = false;
                if (document.getElementById('processBtn')) document.getElementById('processBtn').disabled = false;
                if (filePickerBtn) filePickerBtn.disabled = false;
                const statusElement = document.getElementById('processStatus');
                if (statusElement) {
                    statusElement.textContent = translations.errorStatus;
                    statusElement.className = 'cli-status error';
                }
                addLog('warning', 'Task no longer active on server. Session cleared.');
                const container = document.getElementById('processingProgressContainer');
                if (container) container.style.display = 'none';
                return false;
            }
            
            const progress = await response.json();
            
            // Check if task is still active (running, pending, or paused)
            if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
                // Task is done - clear saved state
                clearTaskState();
                // Update UI
                isProcessing = false;
                if (document.getElementById('processBtn')) document.getElementById('processBtn').disabled = false;
                if (filePickerBtn) filePickerBtn.disabled = false;
                const statusElement = document.getElementById('processStatus');
                if (statusElement) {
                    if (progress.status === 'completed') {
                        statusElement.textContent = translations.success;
                        statusElement.className = 'cli-status success';
                    } else {
                        statusElement.textContent = translations.errorStatus;
                        statusElement.className = 'cli-status error';
                    }
                }
                addLog('info', `Task ${progress.status}. Session cleared.`);
                const container = document.getElementById('processingProgressContainer');
                if (container) container.style.display = 'none';
                return false;
            }
            
            // ✅ Task is still active - update UI with latest progress
            // Update status if it changed
            const statusElement = document.getElementById('processStatus');
            if (statusElement) {
                if (progress.status === 'paused') {
                    statusElement.textContent = 'PAUSED';
                    statusElement.className = 'cli-status warning';
                } else {
                    statusElement.textContent = translations.processingStatus;
                    statusElement.className = 'cli-status processing';
                }
            }
            
            // Update logs with any new entries from server
            if (progress.logs && progress.logs.length > 0) {
                const container = document.getElementById('logContainer');
                if (container) {
                    // Only add logs that aren't already displayed
                    const existingLogCount = logLines.length;
                    const newLogs = progress.logs.slice(existingLogCount);
                    
                    for (const logEntry of newLogs) {
                        addLog(logEntry.type || 'info', logEntry.message);
                    }
                    
                    // Update saved logs
                    logLines = progress.logs.map(log => ({
                        type: log.type || 'info',
                        message: log.message,
                        timestamp: new Date().toLocaleTimeString()
                    }));
                }
            }
            
            // Update progress bar with latest data
            if (progress.total > 0) {
                totalFiles = progress.total;
            }
            processedFiles = progress.current || 0;
            
            // Update progress bar
            renderProgressBar(progress);
            
            // Save updated state
            saveTaskState(taskId, taskState.file_path, taskState.source_id, taskState.side_id, progress, logLines);
            
            // Add success message
            addLog('success', `[${new Date().toLocaleTimeString()}] Session verified. Continuing from previous session...`);
            
            // Resume polling
            startProgressPolling(taskId);
            
            return true;
        } catch (fetchError) {
            // Network error - keep the restored state but show warning
            console.warn('Failed to verify task with server:', fetchError);
            addLog('warning', 'Could not verify task status with server. Showing last known state.');
            // Still resume polling - might be temporary network issue
            startProgressPolling(taskId);
            return true;
        }
        
    } catch (e) {
        console.error('Failed to restore task state:', e);
        clearTaskState();
        return false;
    }
}

async function pauseProcessing() {
    if (!currentTaskId) {
        addLog('error', 'No active task to pause');
        return;
    }
    
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        const response = await fetch(`/upload/pause/${currentTaskId}`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken || ''
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            addLog('info', result.message || 'Processing paused');
            document.getElementById('pauseBtn').style.display = 'none';
            document.getElementById('resumeBtn').style.display = 'inline-block';
        } else {
            const error = await response.json();
            addLog('error', error.error || 'Failed to pause processing');
        }
    } catch (error) {
        addLog('error', 'Error pausing processing: ' + error.message);
    }
}

async function resumeProcessing() {
    if (!currentTaskId) {
        addLog('error', 'No active task to resume');
        return;
    }
    
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        const response = await fetch(`/upload/resume/${currentTaskId}`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken || ''
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            addLog('info', result.message || 'Processing resumed');
            document.getElementById('pauseBtn').style.display = 'inline-block';
            document.getElementById('resumeBtn').style.display = 'none';
        } else {
            const error = await response.json();
            addLog('error', error.error || 'Failed to resume processing');
        }
    } catch (error) {
        addLog('error', 'Error resuming processing: ' + error.message);
    }
}

async function cancelProcessing() {
    if (!currentTaskId) {
        addLog('error', 'No active task to cancel');
        return;
    }
    
    if (!confirm('Are you sure you want to cancel processing? Progress will be lost.')) {
        return;
    }
    
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        const response = await fetch(`/upload/cancel/${currentTaskId}`, {
            method: 'POST',
            headers: {
                'X-CSRFToken': csrfToken || ''
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            addLog('info', result.message || 'Processing cancelled');
            stopProgressPolling();
            clearTaskState(); // Clear saved state when cancelled
            
            // Hide progress container
            const container = document.getElementById('processingProgressContainer');
            if (container) {
                container.style.display = 'none';
            }
            
            // Reset processing state
            isProcessing = false;
            document.getElementById('processBtn').disabled = false;
            filePickerBtn.disabled = false;
        } else {
            const error = await response.json();
            addLog('error', error.error || 'Failed to cancel processing');
        }
    } catch (error) {
        addLog('error', 'Error cancelling processing: ' + error.message);
    }
}

function addLog(type, message) {
    const container = document.getElementById('logContainer');
    const line = document.createElement('div');
    line.className = `cli-log-line ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${message}`;
    
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
    
    logLines.push({ type, message, timestamp });
}

function clearLog() {
    if (isProcessing) {
        addLog('warning', translations.cannotClearLogWhileProcessing);
        return;
    }
    
    const container = document.getElementById('logContainer');
    container.innerHTML = `
        <div class="cli-log-line prompt">${translations.logCleared}</div>
        <div class="cli-log-line info">---</div>
    `;
    logLines = [];
}

// ✅ INSTANT RESTORATION: Start restoration as early as possible
// Use inline script execution (runs before DOMContentLoaded)
(function() {
    'use strict';
    
    // Try to restore immediately if DOM is ready, otherwise wait
    function attemptRestore() {
        // Check if required elements exist
        const filePathInput = document.getElementById('filePathInput');
        const logContainer = document.getElementById('logContainer');
        
        if (filePathInput && logContainer) {
            // DOM is ready - restore immediately
            restoreTaskState().then(restored => {
                if (restored) {
                    console.log('✅ Processing state restored instantly from previous session');
                } else {
                    // No active task to restore - ensure welcome message is shown if log is empty
                    if (logContainer && logContainer.children.length === 0) {
                        const welcomeMsg = document.querySelector('.cli-log-line.prompt');
                        if (!welcomeMsg) {
                            logContainer.innerHTML = `
                                <div class="cli-log-line prompt">Welcome to File Processor CLI</div>
                                <div class="cli-log-line info">Enter file path, select source and side, then click "Run Process"</div>
                                <div class="cli-log-line info">---</div>
                            `;
                        }
                    }
                }
            });
        } else {
            // DOM not ready yet - wait a bit and try again
            if (document.readyState === 'loading') {
                setTimeout(attemptRestore, 10);
            }
        }
    }
    
    // Start restoration attempt immediately
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        attemptRestore();
    } else {
        // Fallback to DOMContentLoaded if script runs before DOM
        document.addEventListener('DOMContentLoaded', attemptRestore);
    }
})();

// Cleanup on page unload - but don't clear localStorage so state can be restored
window.addEventListener('beforeunload', function() {
    // Don't stop polling - let it continue if page is refreshed
    // The state will be restored on next load
});

// Also cleanup when navigating away (if using SPA navigation)
document.addEventListener('visibilitychange', function() {
    // Keep polling even when page is hidden - user might come back
    // The state will be restored when they return
});

// ============================================================
// CHUNKED UPLOAD INITIALIZATION
// ============================================================

// Initialize chunked upload UI
document.addEventListener('DOMContentLoaded', function() {
    try {
        // Get source and side select elements
        const sourceSelect = document.getElementById('sourceSelect');
        const sideSelect = document.getElementById('sideSelect');
        
        // Create hidden fields for chunked upload to access
        const chunkedContainer = document.getElementById('chunked-upload-container');
        if (!chunkedContainer) {
            console.warn('Chunked upload container not found');
            return;
        }
        
        // Add hidden inputs for source and side (will be populated from selects)
        const hiddenFields = document.createElement('div');
        hiddenFields.style.display = 'none';
        hiddenFields.innerHTML = `
            <input type="hidden" id="source_id" name="source_id" value="">
            <input type="hidden" id="side_id" name="side_id" value="">
            <input type="checkbox" id="auto_analyze" name="auto_analyze" checked>
        `;
        chunkedContainer.appendChild(hiddenFields);
        
        // Sync hidden fields when selects change
        if (sourceSelect) {
            sourceSelect.addEventListener('change', function() {
                document.getElementById('source_id').value = this.value;
            });
            // Set initial value
            document.getElementById('source_id').value = sourceSelect.value;
        }
        
        if (sideSelect) {
            sideSelect.addEventListener('change', function() {
                document.getElementById('side_id').value = this.value;
            });
            // Set initial value
            document.getElementById('side_id').value = sideSelect.value;
        }
        
        // Initialize chunked upload UI with 5MB chunks
        const uploadUI = new ChunkedUploadUI('chunked-upload-container', {
            chunkSize: 5 * 1024 * 1024  // 5MB chunks
        });
        
        console.log('✅ Chunked upload initialized successfully');
        
        // Add info message to log
        addLog('info', '💡 Large File Upload: Select files over 100MB above for chunked upload with resume capability');
        
    } catch (error) {
        console.error('Error initializing chunked upload:', error);
        addLog('warning', 'Note: Chunked upload feature unavailable. Use path input for large files.');
    }
});
