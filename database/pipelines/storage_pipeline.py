"""
Storage Pipeline - Complete file storage workflow with multi-concurrency support
Uses ThreadManager, MultiprocessingManager, ProcessManager, and AsyncManager
for parallel storage operations
"""
import os
from typing import Callable, Dict, Any, Optional, Tuple, List
from datetime import datetime
from collections import Counter
import threading
import sys
from pathlib import Path

# Add parent directory to path for imports
parent_dir = Path(__file__).parent.parent.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

from core.concurrency import (
    ThreadManager,
    ThreadPriority,
    MultiprocessingManager,
    PoolPriority,
    ProcessManager,
    ProcessPriority,
    AsyncManager,
    TaskPriority
)

# Add this at the top of the file, after imports
from enum import Enum
from dataclasses import dataclass

class StorageResult(Enum):
    """Storage operation result types"""
    SUCCESS = "success"              # File stored successfully
    DUPLICATE = "duplicate"          # File is a true duplicate
    ERROR = "error"                  # Storage operation failed
    INVALID_HASH = "invalid_hash"    # File has invalid/missing hash
    INVALID_DATA = "invalid_data"    # File data is invalid/corrupted

@dataclass
class StorageResponse:
    """Detailed storage operation response"""
    result: StorageResult
    path_id: Optional[int] = None
    error_message: Optional[str] = None
    duplicate_path_id: Optional[int] = None
    
    @property
    def is_success(self) -> bool:
        return self.result == StorageResult.SUCCESS
    
    @property
    def is_duplicate(self) -> bool:
        return self.result == StorageResult.DUPLICATE
    
    @property
    def is_error(self) -> bool:
        return self.result == StorageResult.ERROR
    
    
class StoragePipeline:
    def __init__(self, source_name: str = "default", side_name: str = "default",
                 enable_concurrency: bool = True, max_workers: int = 4):
        from ..managers.hub import get_database_hub
        self.hub = get_database_hub()
        self.hub.initialize()
        
        self.source_name = source_name
        self.side_name = side_name
        self.enable_concurrency = enable_concurrency
        self.max_workers = max_workers
        
        # Get source and side IDs
        self.source_id = self.hub.source_operations.get_or_create_source(source_name)
        self.side_id = self.hub.side_operations.get_or_create_side(side_name)
        
        # Initialize concurrency managers if enabled
        if self.enable_concurrency:
            self.thread_manager = ThreadManager()
            self.pool_manager = MultiprocessingManager()
            self.process_manager = ProcessManager()
            self.async_manager = AsyncManager()
            
            # Initialize async manager
            self.async_manager.initialize()
            
            # Create pools
            self.storage_pool_id = self.pool_manager.create_pool(
                name="StorageProcessing",
                worker_count=min(max_workers, 4),
                priority=PoolPriority.NORMAL
            )
            
            # Thread executor for I/O-bound operations
            from concurrent.futures import ThreadPoolExecutor
            self.thread_executor = ThreadPoolExecutor(
                max_workers=max_workers,
                thread_name_prefix="StorageWorker"
            )
            
            # Statistics
            self.stats = {
                "total": 0,
                "completed": 0,
                "failed": 0,
                "duplicates": 0
            }
            self.stats_lock = threading.Lock()
        else:
            self.thread_manager = None
            self.pool_manager = None
            self.process_manager = None
            self.async_manager = None
            self.storage_pool_id = None
            self.thread_executor = None
    
    def check_duplicate(self, file_hash: str) -> Tuple[bool, Optional[int]]:
        """
        Check if file is duplicate.
        
        Logic: Duplicate ONLY if hash + source_id + side_id are ALL the same.
        If any one is different, it's NOT a duplicate and should be stored.
        
        Args:
            file_hash: File hash to check
            
        Returns:
            (is_duplicate, existing_path_id or hash_id)
        """
        return self.hub.hash_operations.check_duplicate(
            file_hash, self.source_id, self.side_id
        )
    
    def store_file_complete(
        self,
        file_info: Dict[str, Any],
        result: Dict[str, Any],
        parent_path_id: Optional[int] = None,
        hierarchy_path: Optional[str] = None,
        use_async: bool = False
    ) -> StorageResponse:
        """
        Complete file storage pipeline with detailed result tracking
        
        Returns StorageResponse instead of Optional[int] for better error handling
        """
        import logging
        logger = logging.getLogger(__name__)
        lock = self.stats_lock if self.enable_concurrency else threading.Lock()
        
        file_name = file_info.get('name', 'unknown')
        
        try:
            with lock:
                if self.enable_concurrency:
                    self.stats["total"] += 1
            
            # 1. Validate and get hash
            file_hash = file_info.get('hash', '')
            if not file_hash or file_hash in ('N/A', 'SKIPPED_LARGE_FILE', 'ERROR'):
                # Try to calculate hash if missing
                try:
                    from core.file_utils import calculate_file_hash
                    file_path = file_info.get('path', '')
                    if file_path and os.path.exists(file_path):
                        file_hash = calculate_file_hash(file_path)
                        file_info['hash'] = file_hash
                    else:
                        logger.warning(f"Cannot calculate hash for {file_name}: file path invalid or missing")
                        with lock:
                            if self.enable_concurrency:
                                self.stats["failed"] += 1
                        return StorageResponse(
                            result=StorageResult.INVALID_HASH,
                            error_message=f"Invalid hash and cannot recalculate: path={file_path}"
                        )
                except Exception as hash_error:
                    logger.warning(f"Failed to calculate hash for {file_name}: {hash_error}")
                    with lock:
                        if self.enable_concurrency:
                            self.stats["failed"] += 1
                    return StorageResponse(
                        result=StorageResult.INVALID_HASH,
                        error_message=f"Hash calculation failed: {str(hash_error)}"
                    )
            
            if not file_hash:
                with lock:
                    if self.enable_concurrency:
                        self.stats["failed"] += 1
                return StorageResponse(
                    result=StorageResult.INVALID_HASH,
                    error_message="Hash is empty after validation"
                )
            
            # 2. Check duplicate with CLEAR distinction
            is_duplicate, existing_path_id = self.check_duplicate(file_hash)
            if is_duplicate:
                logger.debug(f"⭐️ Skipping duplicate: {file_name} (existing path_id: {existing_path_id})")
                with lock:
                    if self.enable_concurrency:
                        self.stats["duplicates"] += 1
                        self.stats["completed"] += 1  # Duplicates count as "processed"
                return StorageResponse(
                    result=StorageResult.DUPLICATE,
                    duplicate_path_id=existing_path_id
                )
            
            # 3. Store hash (will reuse orphaned hash if exists)
            try:
                hash_id = self.hub.hash_operations.store_hash(
                    file_hash, self.source_id, self.side_id
                )
            except Exception as hash_store_error:
                logger.error(f"Failed to store hash for {file_name}: {hash_store_error}")
                with lock:
                    if self.enable_concurrency:
                        self.stats["failed"] += 1
                return StorageResponse(
                    result=StorageResult.ERROR,
                    error_message=f"Hash storage failed: {str(hash_store_error)}"
                )
            
            if not hash_id:
                with lock:
                    if self.enable_concurrency:
                        self.stats["failed"] += 1
                return StorageResponse(
                    result=StorageResult.ERROR,
                    error_message="Hash storage returned None"
                )
            
            # 4. Store metadata
            if hierarchy_path:
                file_info['path'] = hierarchy_path[:500]
            
            try:
                path_id = self.hub.path_operations.store_metadata(
                    file_info, hash_id, file_status='Unread'
                )
            except Exception as path_store_error:
                logger.error(f"Failed to store metadata for {file_name}: {path_store_error}")
                with lock:
                    if self.enable_concurrency:
                        self.stats["failed"] += 1
                return StorageResponse(
                    result=StorageResult.ERROR,
                    error_message=f"Metadata storage failed: {str(path_store_error)}"
                )
            
            if not path_id:
                with lock:
                    if self.enable_concurrency:
                        self.stats["failed"] += 1
                return StorageResponse(
                    result=StorageResult.ERROR,
                    error_message="Metadata storage returned None"
                )
            
            # 5. Extract and store content
            content = result.get('Content', {})
            has_readable_content = False
            
            if isinstance(content, dict):
                if 'error' not in content:
                    text = self._extract_text_from_content(content)
                    if text and len(text.strip()) > 0:
                        has_readable_content = True
                        try:
                            if self.enable_concurrency and len(text) > 100000:
                                # Large content - use pool
                                task_id = self.pool_manager.submit_task(
                                    self.storage_pool_id,
                                    self._store_content_pipeline,
                                    (text, path_id),
                                    {}
                                )
                            else:
                                self._store_content_pipeline(text, path_id)
                        except Exception as content_error:
                            logger.warning(f"Content storage failed for {file_name}: {content_error}")
                            # Don't fail the entire operation for content storage failure
            
            # 6. Store title
            try:
                title = self._extract_title(result, file_info)
                if title:
                    self._store_title_pipeline(title, path_id, parent_path_id)
            except Exception as title_error:
                logger.warning(f"Title storage failed for {file_name}: {title_error}")
                # Don't fail the entire operation for title storage failure
            
            # 7. Update file status
            file_status = 'Read' if has_readable_content else 'Unread'
            try:
                self.hub.path_operations.update_file_status(path_id, file_status)
            except Exception as status_error:
                logger.warning(f"Failed to update file status for {file_name}: {status_error}")
                # Continue anyway - status update is not critical
            
            with lock:
                if self.enable_concurrency:
                    self.stats["completed"] += 1
            
            status_icon = "✓" if has_readable_content else "⚠"
            logger.debug(f"{status_icon} Stored {file_name} (path_id: {path_id}, status: {file_status})")
            
            return StorageResponse(
                result=StorageResult.SUCCESS,
                path_id=path_id
            )
            
        except Exception as e:
            logger.error(f"✗ Storage pipeline error for {file_name}: {e}", exc_info=True)
            with lock:
                if self.enable_concurrency:
                    self.stats["failed"] += 1
            return StorageResponse(
                result=StorageResult.ERROR,
                error_message=f"Unexpected error: {str(e)}"
            )
        
        
        
    def _retry_with_backoff(
        self,
        operation: Callable,
        *args,
        max_retries: int = 3,
        initial_delay: float = 0.1,
        **kwargs
    ) -> Any:
        """
        Retry an operation with exponential backoff
        
        Args:
            operation: Function to retry
            *args: Positional arguments for operation
            max_retries: Maximum number of retry attempts
            initial_delay: Initial delay between retries (seconds)
            **kwargs: Keyword arguments for operation
            
        Returns:
            Result from operation
            
        Raises:
            Last exception if all retries fail
        """
        import time
        import logging
        logger = logging.getLogger(__name__)
        
        last_exception = None
        delay = initial_delay
        
        for attempt in range(max_retries + 1):
            try:
                return operation(*args, **kwargs)
            except Exception as e:
                last_exception = e
                
                if attempt < max_retries:
                    # Check if error is retryable
                    error_str = str(e).lower()
                    retryable_errors = [
                        'connection', 'timeout', 'locked', 'busy',
                        'deadlock', 'network', 'temporary'
                    ]
                    
                    if any(err in error_str for err in retryable_errors):
                        logger.warning(f"Retryable error on attempt {attempt + 1}/{max_retries + 1}: {e}")
                        logger.info(f"Retrying in {delay:.2f}s...")
                        time.sleep(delay)
                        delay *= 2  # Exponential backoff
                    else:
                        # Non-retryable error, raise immediately
                        logger.error(f"Non-retryable error: {e}")
                        raise
                else:
                    logger.error(f"All {max_retries + 1} attempts failed")
                    raise last_exception
        
        raise last_exception
    
    def _store_file_sync(
        self,
        file_info: Dict[str, Any],
        result: Dict[str, Any],
        parent_path_id: Optional[int] = None,
        hierarchy_path: Optional[str] = None
    ) -> Optional[int]:
        """Synchronous file storage implementation"""
        import logging
        logger = logging.getLogger(__name__)
        lock = self.stats_lock if self.enable_concurrency else threading.Lock()
        
        file_name = file_info.get('name', 'unknown')
        
        try:
            with lock:
                if self.enable_concurrency:
                    self.stats["total"] += 1
            
            # 1. Get/validate hash
            file_hash = file_info.get('hash', '')
            if not file_hash or file_hash in ('N/A', 'SKIPPED_LARGE_FILE', 'ERROR'):
                try:
                    from core.file_utils import calculate_file_hash
                    file_path = file_info.get('path', '')
                    if file_path:
                        file_hash = calculate_file_hash(file_path)
                        file_info['hash'] = file_hash
                except Exception as hash_error:
                    logger.warning(f"Failed to calculate hash for {file_name}: {hash_error}")
                    with lock:
                        if self.enable_concurrency:
                            self.stats["failed"] += 1
                    return None
            
            if not file_hash:
                with lock:
                    if self.enable_concurrency:
                        self.stats["failed"] += 1
                return None
            
            # 2. Check duplicate
            is_duplicate, existing_path_id = self.check_duplicate(file_hash)
            if is_duplicate:
                logger.debug(f"⏭️ Skipping duplicate: {file_name} (existing path_id: {existing_path_id})")
                with lock:
                    if self.enable_concurrency:
                        self.stats["duplicates"] += 1
                        # Count duplicates as completed (they were successfully processed, just skipped)
                        self.stats["completed"] += 1
                # Return existing path_id instead of None to indicate successful processing
                return existing_path_id
            
            # 3. Store hash
            hash_id = self.hub.hash_operations.store_hash(
                file_hash, self.source_id, self.side_id
            )
            if not hash_id:
                with lock:
                    if self.enable_concurrency:
                        self.stats["failed"] += 1
                return None
            
            # 4. Store metadata (initially as 'Unread' - will be updated after content check)
            if hierarchy_path:
                file_info['path'] = hierarchy_path[:500]
            
            # Store with 'Unread' status initially - will be updated to 'Read' if content exists
            path_id = self.hub.path_operations.store_metadata(file_info, hash_id, file_status='Unread')
            if not path_id:
                with lock:
                    if self.enable_concurrency:
                        self.stats["failed"] += 1
                return None
            
            # 5. Extract and store content
            content = result.get('Content', {})
            has_readable_content = False
            
            if isinstance(content, dict):
                # Check for errors first
                if 'error' not in content:
                    text = self._extract_text_from_content(content)
                    if text and len(text.strip()) > 0:
                        has_readable_content = True
                        if self.enable_concurrency and len(text) > 100000:  # Large content
                            # Use pool for CPU-intensive content processing
                            task_id = self.pool_manager.submit_task(
                                self.storage_pool_id,
                                self._store_content_pipeline,
                                (text, path_id),
                                {}
                            )
                            # Don't wait - content storage is non-critical
                        else:
                            self._store_content_pipeline(text, path_id)
            
            # 6. Store title
            title = self._extract_title(result, file_info)
            if title:
                self._store_title_pipeline(title, path_id, parent_path_id)
            
            # 7. Update file status based on content availability
            file_status = 'Read' if has_readable_content else 'Unread'
            try:
                self.hub.path_operations.update_file_status(path_id, file_status)
            except Exception as status_error:
                logger.warning(f"Failed to update file status for {file_name}: {status_error}")
                # Continue anyway - status update is not critical
            
            with lock:
                if self.enable_concurrency:
                    self.stats["completed"] += 1
            
            status_icon = "✓" if has_readable_content else "⚠"
            logger.debug(f"{status_icon} Stored {file_name} (path_id: {path_id}, status: {file_status})")
            return path_id
        except Exception as e:
            logger.error(f"✗ Storage pipeline error for {file_name}: {e}", exc_info=True)
            with lock:
                if self.enable_concurrency:
                    self.stats["failed"] += 1
            return None
    
    def _store_content_pipeline(self, text: str, path_id: int):
        """Store content with tokenization and compression"""
        # Tokenize
        tokens = self.hub.content_processor.extract_words_with_punctuation(text)
        if not tokens:
            return
        
        # Get word and punctuation IDs
        words = set(word for word, _, _, _ in tokens)
        word_id_map = {}
        for word in words:
            word_id_map[word] = self.hub.word_operations.get_or_create_word_id(word)
        
        # Build token tuples with IDs
        token_tuples = []
        for word, punct_before, punct_after, spacing in tokens:
            word_id = word_id_map[word]
            # Simplified: store None for punctuation IDs for now
            token_tuples.append((word_id, None, None, None))
        
        # Store compressed content
        self.hub.content_operations.store_content_chunks(token_tuples, path_id)
        
        # Store word frequencies
        word_counts = Counter(word for word, _, _, _ in tokens)
        self.hub.word_operations.store_word_frequencies(path_id, dict(word_counts))
    
    def _store_title_pipeline(self, title: str, path_id: int, parent_path_id: Optional[int]):
        """Store title as compressed word IDs"""
        words = self.hub.content_processor.extract_words(title)
        if not words:
            return
        
        word_ids = []
        for word in words:
            word_ids.append(self.hub.word_operations.get_or_create_word_id(word))
        
        self.hub.title_operations.store_title(word_ids, path_id, parent_path_id)
    
    def _extract_text_from_content(self, content: Dict[str, Any]) -> str:
        """
        Extract ALL plain text content from ALL file types and result structures.
        
        Handles:
        1. Direct content dict: {'pages': [...], 'sheets': {...}, ...}
        2. Wrapped content: {'Content': {'pages': [...], ...}}
        3. Email results: {'message': {...}, 'messages': [...]}
        4. Email wrapped: {'Content': {'email_content': {...}, ...}}
        5. Archive/extraction results with nested files
        
        Returns plain text with all content merged and no metadata.
        """
        text_parts = []
        
        # STEP 1: Unwrap result structure if needed
        content = content
        
        # Check if this is a wrapped result with 'Content' key
        if 'Content' in content and isinstance(content['Content'], dict):
            content = content['Content']
        
        # STEP 2: Handle EMAIL content structures (special case)
        # Email files have unique structure: message/messages at root level
        
        # Method 1A: Wrapped email content (email_content key)
        if 'email_content' in content and isinstance(content['email_content'], dict):
            msg = content['email_content']
            email_fields = ['from', 'to', 'cc', 'bcc', 'subject', 'date', 'message_id', 'content', 'body']
            for field in email_fields:
                if field in msg:
                    value = msg.get(field, '')
                    if isinstance(value, str) and value.strip():
                        text_parts.append(value.strip())
        
        # Method 1B: Direct message key (from email readers)
        elif 'message' in content and isinstance(content['message'], dict):
            msg = content['message']
            email_fields = ['from', 'to', 'cc', 'bcc', 'subject', 'date', 'message_id', 'content', 'body']
            for field in email_fields:
                if field in msg:
                    value = msg.get(field, '')
                    if isinstance(value, str) and value.strip():
                        text_parts.append(value.strip())
        
        # Method 1C: Multiple messages (MBOX, PST)
        elif 'messages' in content and isinstance(content['messages'], list):
            for msg in content['messages']:
                if isinstance(msg, dict):
                    email_fields = ['from', 'to', 'cc', 'bcc', 'subject', 'date', 'message_id', 'content', 'body']
                    for field in email_fields:
                        if field in msg:
                            value = msg.get(field, '')
                            if isinstance(value, str) and value.strip():
                                text_parts.append(value.strip())
        
        # STEP 3: Handle STANDARD document structures
        
        # Method 2: PDF pages
        if 'pages' in content and isinstance(content['pages'], list):
            for page in content['pages']:
                if isinstance(page, dict) and 'text' in page:
                    page_text = page.get('text', '')
                    if isinstance(page_text, str) and page_text.strip():
                        text_parts.append(page_text.strip())
        
        # Method 3: Excel sheets (XLSX, XLS)
        if 'sheets' in content and isinstance(content['sheets'], dict):
            for sheet_name, sheet_data in content['sheets'].items():
                if isinstance(sheet_data, dict) and 'data' in sheet_data:
                    sheet_rows = sheet_data.get('data', [])
                    for row in sheet_rows:
                        if isinstance(row, (list, tuple)):
                            row_texts = [str(cell).strip() for cell in row if cell and str(cell).strip()]
                            if row_texts:
                                text_parts.append(' '.join(row_texts))
        
        # Method 4: Tables (Office documents)
        if 'tables' in content and isinstance(content['tables'], list):
            for table in content['tables']:
                if isinstance(table, dict):
                    # Extract from table rows
                    if 'rows' in table and isinstance(table['rows'], list):
                        for row in table['rows']:
                            if isinstance(row, dict) and 'cells' in row:
                                row_texts = [str(cell).strip() for cell in row['cells'] if cell and str(cell).strip()]
                                if row_texts:
                                    text_parts.append(' '.join(row_texts))
                            elif isinstance(row, list):
                                row_texts = [str(cell).strip() for cell in row if cell and str(cell).strip()]
                                if row_texts:
                                    text_parts.append(' '.join(row_texts))
        
        # Method 5: PowerPoint slides (PPTX)
        if 'slides' in content and isinstance(content['slides'], list):
            for slide in content['slides']:
                if isinstance(slide, dict):
                    # Try 'texts' key (list of text strings)
                    if 'texts' in slide and isinstance(slide['texts'], list):
                        for text in slide['texts']:
                            if isinstance(text, str) and text.strip():
                                text_parts.append(text.strip())
                    # Try 'text' key (single text string)
                    elif 'text' in slide:
                        slide_text = slide.get('text', '')
                        if isinstance(slide_text, str) and slide_text.strip():
                            text_parts.append(slide_text.strip())
                    # Try 'content' key
                    elif 'content' in slide:
                        slide_content = slide.get('content', '')
                        if isinstance(slide_content, str) and slide_content.strip():
                            text_parts.append(slide_content.strip())
        
        # Method 6: Word document paragraphs (DOCX)
        if 'paragraphs' in content and isinstance(content['paragraphs'], list):
            for para in content['paragraphs']:
                if isinstance(para, str) and para.strip():
                    text_parts.append(para.strip())
                elif isinstance(para, dict):
                    if 'text' in para:
                        para_text = para.get('text', '')
                        if isinstance(para_text, str) and para_text.strip():
                            text_parts.append(para_text.strip())
        
        # Method 7: OCR from images (extracted_images array)
        if 'extracted_images' in content and isinstance(content['extracted_images'], list):
            for img in content['extracted_images']:
                if isinstance(img, dict) and 'text' in img:
                    img_text = img.get('text', '')
                    if isinstance(img_text, str) and img_text.strip():
                        text_parts.append(img_text.strip())
        
        # Method 7B: Direct image OCR text (from read_img_fast - text field at root)
        # This handles images where OCR text is stored directly in 'text' field
        if 'text' in content:
            img_text = content.get('text', '')
            if isinstance(img_text, str) and img_text.strip():
                text_parts.append(img_text.strip())
        
        # Method 8: Direct text fields (TXT, HTML, JSON, etc.)
        if not text_parts:
            # Try common text field names
            text_field_names = [
                'text', 'content', 'body', 'data', 
                'extracted_text', 'text_content', 'message_text',
                'lines'  # For text files
            ]
            
            for field_name in text_field_names:
                if field_name in content:
                    value = content[field_name]
                    
                    if isinstance(value, str) and value.strip():
                        text_parts.append(value.strip())
                        break
                    
                    elif isinstance(value, list):
                        # Handle list of strings (like 'lines' in text files)
                        list_texts = []
                        for item in value:
                            if isinstance(item, str) and item.strip():
                                list_texts.append(item.strip())
                            elif isinstance(item, dict) and 'text' in item:
                                item_text = item.get('text', '')
                                if isinstance(item_text, str) and item_text.strip():
                                    list_texts.append(item_text.strip())
                        
                        if list_texts:
                            text_parts.extend(list_texts)
                            break
        
        # STEP 4: Merge all text parts
        if not text_parts:
            return ""
        
        # Join with newline to preserve document structure
        result_text = '\n'.join(text_parts)
        
        # Clean up excessive whitespace while preserving structure
        lines = result_text.split('\n')
        cleaned_lines = [line.strip() for line in lines if line.strip()]
        result_text = ' '.join(cleaned_lines)
        
        return result_text

    def _extract_title(self, result: Dict, file_info: Dict) -> Optional[str]:
        """Extract title from result"""
        content = result.get('Content', {})
        
        # Try various title fields
        for field in ['title', 'subject']:
            if field in content:
                return str(content[field])[:200]
        
        # Fallback to filename
        return file_info.get('name', '')[:200]
    
    def store_files_batch(
        self,
        files_data: List[Tuple[Dict[str, Any], Dict[str, Any]]],
        use_pool: bool = True
    ) -> List[Optional[int]]:
        """
        Store multiple files in parallel using concurrency managers
        
        Args:
            files_data: List of (file_info, result) tuples
            use_pool: If True, use multiprocessing pool for CPU-intensive tasks
            
        Returns:
            List of path IDs (None for failed/duplicate files)
        """
        if not self.enable_concurrency:
            # Sequential storage
            return [self._store_file_sync(fi, res) for fi, res in files_data]
        
        results = []
        
        # Separate files by size/complexity
        simple_files = []
        complex_files = []
        
        for file_info, result in files_data:
            content = result.get('Content', {})
            text = self._extract_text_from_content(content) if isinstance(content, dict) else ""
            
            if len(text) > 50000 or file_info.get('size_bytes', 0) > 10 * 1024 * 1024:
                complex_files.append((file_info, result))
            else:
                simple_files.append((file_info, result))
        
        # Use thread pool for simple files (I/O-bound)
        if simple_files:
            futures = []
            for file_info, result in simple_files:
                future = self.thread_executor.submit(
                    self._store_file_sync,
                    file_info,
                    result
                )
                futures.append((future, file_info, result))
            
            # Collect results
            for future, file_info, result in futures:
                try:
                    path_id = future.result(timeout=60)
                    results.append(path_id)
                except Exception as e:
                    print(f"✗ Error storing {file_info.get('name', 'unknown')}: {e}")
                    results.append(None)
        
        # Use multiprocessing pool for complex files (CPU-intensive)
        if complex_files and use_pool:
            task_ids = []
            for file_info, result in complex_files:
                task_id = self.pool_manager.submit_task(
                    self.storage_pool_id,
                    self._store_file_sync,
                    (file_info, result),
                    {}
                )
                task_ids.append((task_id, file_info, result))
            
            # Collect results
            for task_id, file_info, result in task_ids:
                try:
                    result_obj = self.pool_manager.wait_for_task(
                        self.storage_pool_id,
                        task_id,
                        timeout=300
                    )
                    if result_obj and result_obj.success:
                        results.append(result_obj.result)
                    else:
                        results.append(None)
                except Exception as e:
                    print(f"✗ Error storing {file_info.get('name', 'unknown')}: {e}")
                    results.append(None)
        elif complex_files:
            # Fallback to sequential if pool not available
            for file_info, result in complex_files:
                results.append(self._store_file_sync(file_info, result))
        
        return results
    
    def get_statistics(self) -> Dict[str, int]:
        """Get storage statistics"""
        if self.enable_concurrency:
            with self.stats_lock:
                return self.stats.copy()
        return {}
    
    def shutdown(self):
        """Shutdown concurrency managers"""
        if self.enable_concurrency:
            if self.thread_executor:
                self.thread_executor.shutdown(wait=True)
            if self.pool_manager:
                self.pool_manager.shutdown()
            if self.thread_manager:
                self.thread_manager.shutdown()
            if self.process_manager:
                self.process_manager.shutdown()
            if self.async_manager:
                self.async_manager.shutdown()
    
    def flush_all(self):
        """Flush any pending operations"""
        pass  # BatchPipeline handles this