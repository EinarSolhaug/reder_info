"""
Integrated File Reader - Multi-concurrency version of your file processing system

This uses all four concurrency managers:
- ThreadManager: For I/O-bound tasks (small text files)
- MultiprocessingManager: For CPU-intensive tasks (large files, PDFs, images)
- AsyncManager: For monitoring and async operations
- ProcessManager: For isolated heavy processing tasks

This replaces the sequential file processing in app.py with parallel processing
while keeping all your existing reader functions unchanged.
"""
import os
import time
import threading
from pathlib import Path
from typing import List, Dict, Optional
from queue import Queue, Empty
import sys
from tqdm import tqdm
from concurrent.futures import Future, ThreadPoolExecutor
# Add parent directory to path
parent_dir = Path(__file__).parent.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))


from reader.main_specify_method import main_specify_method_of_reading_the_file
from core.file_utils import (
    get_standardized_metadata,
    read_tree
)

from core.time_utils import (
    calculate_processing_statistics
)

from core.logging_utils import (
    record_command_line_action
)

# Import all four concurrency managers
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



import logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class IntegratedFileReader:
    """
    Multi-concurrency file reader that uses all four concurrency managers
    
    Features:
    - Parallel processing using ThreadManager, MultiprocessingManager, ProcessManager, and AsyncManager
    - Smart task distribution based on file type and size
    - Pause/Resume/Stop control
    - Real-time progress monitoring
    - Health monitoring
    - Error isolation (one failure doesn't stop others)
    - Circuit breaker for cascading failures
    
    Usage:
        # Simple usage
        with IntegratedFileReader(max_workers=4) as reader:
            results = reader.process_folder("/path/to/folder")
        
        # With monitoring
        with IntegratedFileReader(max_workers=4, enable_monitoring=True) as reader:
            results = reader.process_folder("/path/to/folder")
            
            # Monitor progress
            while not reader.is_complete():
                stats = reader.get_statistics()
                logger.info(f"Progress: {stats['completed']}/{stats['total']}")
                time.sleep(1)
    """
    
    def __init__(self, 
                 max_workers: int = 4,
                 enable_monitoring: bool = True,
                 monitor_interval: float = 5.0,
                 failure_threshold: int = 50,  # Increased to prevent premature stopping
                 failure_window: int = 100,  # Increased window size
                 use_priority: bool = True,
                 enable_storage: bool = False,
                 storage_source: str = "default",
                 storage_side: str = "default"):
        """
        Initialize the multi-concurrency file reader
        
        Args:
            max_workers: Number of parallel workers (default: 4)
            enable_monitoring: Enable health monitoring (default: True)
            monitor_interval: Monitoring interval in seconds (default: 5.0)
            failure_threshold: Number of failures to trigger circuit breaker (default: 5)
            failure_window: Window size for failure tracking (default: 10)
            use_priority: Enable priority-based scheduling (default: True)
        """
        self.max_workers = max_workers
        self.enable_monitoring = enable_monitoring
        self.monitor_interval = monitor_interval
        self.failure_threshold = failure_threshold
        self.failure_window = failure_window
        self.use_priority = use_priority
        self.enable_storage = enable_storage
        self.storage_source = storage_source
        self.storage_side = storage_side
        
        # Initialize all four concurrency managers
        self.thread_manager = ThreadManager()
        self.pool_manager = MultiprocessingManager()
        self.process_manager = ProcessManager()
        self.async_manager = AsyncManager()
        
        # Storage pipeline (lazy initialization)
        self.storage_pipeline = None
        self.batch_pipeline = None
        
        # Processing state
        self.is_initialized = False
        self.is_processing = False
        self.thread_pool_id = None
        self.pool_pool_id = None
        self.monitor_task_id = None
        
        # Results and statistics
        self.results = []
        self.results_lock = threading.Lock()
        self.stats = {
            "total": 0,
            "completed": 0,
            "failed": 0,
            "in_progress": 0,
            "start_time": None,
            "end_time": None
        }
        self.stats_lock = threading.Lock()
        
        # Circuit breaker
        self.recent_failures = []
        
        logger.info(f"IntegratedFileReader initialized with {max_workers} workers, priority={'enabled' if use_priority else 'disabled'}")
        record_command_line_action(
            "SYSTEM", 
            "IntegratedFileReader initialized",
            {
                "max_workers": max_workers,
                "monitoring_enabled": enable_monitoring,
                "failure_threshold": failure_threshold,
                "failure_window": failure_window,
                "priority_enabled": use_priority
            }
        )
        
    def initialize(self):
        """Initialize all four concurrency managers"""
        if self.is_initialized:
            return
        
        try:
            logger.info("Initializing all concurrency managers...")
            
            # Initialize AsyncManager first (needs event loop)
            self.async_manager.initialize()
            
            # Create thread pool for I/O-bound tasks (small files)
            # We'll use ThreadPoolExecutor for thread management
            self.thread_executor = ThreadPoolExecutor(max_workers=self.max_workers, thread_name_prefix="FileReader")
            
            # Create multiprocessing pool for CPU-intensive tasks (large files, PDFs, images)
            pool_workers = min(self.max_workers, 4)  # Limit process workers
            self.pool_pool_id = self.pool_manager.create_pool(
                name="CPUIntensiveProcessing",
                worker_count=pool_workers,
                priority=PoolPriority.NORMAL
            )
            
            # Start monitoring if enabled
            if self.enable_monitoring:
                self.thread_manager.start_monitoring(interval=self.monitor_interval)
                self.pool_manager.start_monitoring(interval=self.monitor_interval)
                self.process_manager.start_monitoring(interval=self.monitor_interval)
                
                # Start async monitoring task (using thread instead of async to avoid warnings)
                def monitor_loop_sync():
                    import time
                    while True:
                        time.sleep(self.monitor_interval)
                        try:
                            stats = self.get_statistics()
                            logger.debug(f"Monitoring: {stats}")
                        except Exception as e:
                            logger.warning(f"Monitoring error: {e}")
                            break
                
                # Use thread instead of async to avoid coroutine warnings
                import threading
                monitor_thread = threading.Thread(
                    target=monitor_loop_sync,
                    name="HealthMonitor",
                    daemon=True
                )
                monitor_thread.start()
                self.monitor_task_id = "monitor_thread"  # Store reference
            
            # Initialize storage pipeline if enabled
            if self.enable_storage:
                try:
                    from database.pipelines.storage_pipeline import StoragePipeline
                    from database.pipelines.batch_pipeline import BatchPipeline
                    
                    self.storage_pipeline = StoragePipeline(
                        source_name=self.storage_source,
                        side_name=self.storage_side,
                        enable_concurrency=True,
                        max_workers=self.max_workers
                    )
                    
                    self.batch_pipeline = BatchPipeline(
                        batch_size=500,
                        enable_concurrency=True,
                        max_workers=self.max_workers
                    )
                    
                    logger.info(f"Storage pipeline initialized (source: {self.storage_source}, side: {self.storage_side})")
                except Exception as storage_error:
                    logger.warning(f"Failed to initialize storage pipeline: {storage_error}")
                    logger.warning("Continuing without storage...")
                    self.enable_storage = False
            
            self.is_initialized = True
            logger.info(f"All concurrency managers initialized successfully (priority: {self.use_priority}, storage: {self.enable_storage})")
            
        except Exception as e:
            logger.error(f"Failed to initialize concurrency managers: {e}")
            import traceback
            traceback.print_exc()
            # Cleanup on failure
            self.shutdown()
            raise RuntimeError(f"Failed to initialize concurrency managers: {e}") from e
        

    def _calculate_file_priority(self, file_info: Dict) -> int:
        """
        Calculate priority for a file based on various factors
        Lower number = higher priority (processed first)
        
        Priority Rules:
        1. Small text files (fast to process) = Priority 1
        2. Office documents = Priority 3
        3. PDFs = Priority 5
        4. Images (slow OCR) = Priority 7
        5. Archives/emails = Priority 9
        6. Large files = +2 priority penalty
        
        Args:
            file_info: File metadata dictionary
            
        Returns:
            Priority level (1-10, lower = higher priority)
        """
        extension = file_info.get('extension', '').lower()
        size_bytes = file_info.get('size_bytes', 0)
        
        # Base priority by file type (processing speed)
        if extension in {'.txt', '.json', '.xml', '.csv', '.yaml', '.yml'}:
            priority = 1  # Fast text processing
        elif extension in {'.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt'}:
            priority = 3  # Moderate office processing
        elif extension in {'.pdf'}:
            priority = 5  # PDF with possible OCR
        elif extension in {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp'}:
            priority = 7  # Image OCR (slow)
        elif extension in {'.zip', '.rar', '.7z', '.tar', '.gz', '.eml', '.msg', '.pst'}:
            priority = 9  # Archive extraction (creates more work)
        else:
            priority = 5  # Default medium priority
        
        # Adjust for file size
        if size_bytes > 10 * 1024 * 1024:  # > 10MB
            priority += 2  # Lower priority for large files
        elif size_bytes > 50 * 1024 * 1024:  # > 50MB
            priority += 3  # Even lower priority
        
        # Cap at 10
        return min(priority, 10)
    
    def _should_use_pool(self, file_info: Dict) -> bool:
        """
        Determine if file should use multiprocessing pool (CPU-intensive) or thread pool (I/O-bound)
        
        Returns:
            True if should use multiprocessing pool, False for thread pool
        """
        extension = file_info.get('extension', '').lower()
        size_bytes = file_info.get('size_bytes', 0)
        
        # Use multiprocessing pool for:
        # - Large files (>10MB)
        # - CPU-intensive formats (PDFs, images, archives)
        if size_bytes > 10 * 1024 * 1024:  # > 10MB
            return True
        
        if extension in {'.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp'}:
            return True  # Images and PDFs benefit from multiprocessing
        
        if extension in {'.zip', '.rar', '.7z', '.tar', '.gz'}:
            return True  # Archives are CPU-intensive
        
        # Use thread pool for:
        # - Small files
        # - I/O-bound formats (text, office documents)
        return False
        
    def process_single_file(self, file_path: str) -> Optional[Dict]:
        """
        Process a single file using appropriate concurrency manager
        
        Args:
            file_path: Path to the file
            
        Returns:
            Processing result or None if failed
        """
        if not self.is_initialized:
            self.initialize()
            
        logger.info(f"Processing single file: {file_path}")
        record_command_line_action(
            "FILE_OP",
            f"Processing single file: {os.path.basename(file_path)}",
            {"file_path": file_path}
        )
        
        # Get file metadata
        file_info = get_standardized_metadata(file_path)
        
        if not file_info or file_info.get('type') != 'FILE':
            logger.error(f"Invalid file: {file_path}")
            record_command_line_action(
                "ERROR",
                f"Invalid file: {file_path}",
                {"file_path": file_path},
                level="ERROR"
            )
            return None
        
        # Determine which manager to use
        use_pool = self._should_use_pool(file_info)
        start_time = time.time()
        
        try:
            if use_pool:
                # Use multiprocessing pool for CPU-intensive tasks
                task_id = self.pool_manager.submit_task(
                    self.pool_pool_id,
                    self._process_file_worker,
                    (file_info, 0),
                    {}
                )
                
                # Wait for result
                result_obj = self.pool_manager.wait_for_task(
                    self.pool_pool_id,
                    task_id,
                    timeout=300
                )
                
                if result_obj and result_obj.success:
                    result = result_obj.result
                else:
                    error_msg = result_obj.error if result_obj else "Unknown error"
                    logger.error(f"Pool task failed: {error_msg}")
                    return None
            else:
                # Use thread pool for I/O-bound tasks
                future = self.thread_executor.submit(
                    self._process_file_worker,
                    file_info,
                    0
                )
                result = future.result(timeout=300)
            
            processing_time = time.time() - start_time
            
            logger.info(f"File processed in {processing_time:.2f}s: {file_path}")
            record_command_line_action(
                "FILE_OP",
                f"File processed successfully: {os.path.basename(file_path)}",
                {
                    "file_path": file_path,
                    "processing_time": processing_time,
                    "success": True,
                    "used_pool": use_pool
                }
            )
            
            return result
            
        except TimeoutError:
            logger.error(f"Timeout processing {file_path} after 300s")
            record_command_line_action(
                "ERROR",
                f"Timeout processing file: {os.path.basename(file_path)}",
                {
                    "file_path": file_path,
                    "timeout": 300
                },
                level="ERROR"
            )
            return None
            
        except Exception as e:
            logger.error(f"Error processing {file_path}: {e}")
            record_command_line_action(
                "ERROR",
                f"Error processing file: {os.path.basename(file_path)}",
                {
                    "file_path": file_path,
                    "error": str(e)
                },
                level="ERROR"
            )
            return None

# integrated_reader.py - Add batch processing for small files

    def _should_batch(self, file_info: Dict) -> bool:
        """Check if file should be batched"""
        extension = file_info.get('extension', '').lower()
        size_bytes = file_info.get('size_bytes', 0)
        # Batch small text files
        return (extension in {'.txt', '.json', '.xml', '.csv'} and 
                size_bytes < 100 * 1024)  # < 100KB

    def _process_batch(self, file_infos: List[Dict], depth: int = 0) -> List[Dict]:
        """Process multiple small files in one worker"""
        results = []
        for file_info in file_infos:
            result = main_specify_method_of_reading_the_file(
                file_info,
                collect=True,
                depth=depth
            )
            results.append(result)

        return results


    # integrated_reader.py - Updated process_folder method
    def process_folder(self, folder_path: str) -> List[Dict]:
        """
        Process entire folder in parallel with priority scheduling and circuit breaker
        
        Args:
            folder_path: Path to the folder
            
        Returns:
            List of processing results
        """
        if not self.is_initialized:
            self.initialize()
            
        logger.info(f"Processing folder: {folder_path}")
        record_command_line_action(
            "FUNCTION_CALL",
            f"Processing folder: {os.path.basename(folder_path)}",
            {"folder_path": folder_path}
        )
        
        # Scan folder
        logger.info(f"Scanning folder: {folder_path}...")
        tree = read_tree(folder_path)
        files = [item for item in tree if item.get('type') == 'FILE']
        
        if not files:
            logger.info("No files to process.")
            record_command_line_action(
                "INFO",
                "No files found in folder",
                {"folder_path": folder_path}
            )
            return []
            
        logger.info(f"Found {len(files)} files")
        
        # Log file type distribution
        file_types = {}
        for file_info in files:
            ext = file_info.get('extension', 'no_extension').lower()
            file_types[ext] = file_types.get(ext, 0) + 1
        
        logger.info(f"File type distribution: {dict(sorted(file_types.items(), key=lambda x: x[1], reverse=True)[:10])}")
        
        # Calculate priorities for all files
        file_priorities = []
        for file_info in files:
            priority = self._calculate_file_priority(file_info)
            file_priorities.append((file_info, priority))
            logger.debug(f"File: {file_info.get('name')} - Priority: {priority} - Size: {file_info.get('size')}")
        
        # Sort by priority for display
        file_priorities.sort(key=lambda x: x[1])
        
        logger.info(f"Priority distribution:")
        priority_counts = {}
        for _, priority in file_priorities:
            priority_counts[priority] = priority_counts.get(priority, 0) + 1
        for priority in sorted(priority_counts.keys()):
            logger.info(f"  Priority {priority}: {priority_counts[priority]} files")
        
        record_command_line_action(
            "FILE_OP",
            f"Found {len(files)} files in folder with priority distribution",
            {
                "folder_path": folder_path,
                "file_count": len(files),
                "priority_distribution": priority_counts
            }
        )
        
        # Initialize statistics
        # Note: 'total' will be updated as extracted files are processed
        with self.stats_lock:
            self.stats = {
                "total": len(files),  # Will increase as extracted files are added
                "completed": 0,
                "failed": 0,
                "in_progress": 0,
                "start_time": time.time(),
                "end_time": None,
                "original_files": len(files),  # Track original file count separately
                "extracted_files": 0  # Track extracted files count
            }
        
        self.results = []
        self.recent_failures = []
        self.is_processing = True
        
        # Separate files by type and create tasks
        future_to_file = {}
        task_id_to_file = {}  # For pool tasks
        
        # Separate batchable and individual files
        batch_files = []
        individual_files = []

        for file_info, priority in file_priorities:
            if self._should_batch(file_info):
                batch_files.append((file_info, priority))
            else:
                individual_files.append((file_info, priority))

        # Create batches of 10 files each
        batch_size = 10
        batches = []
        for i in range(0, len(batch_files), batch_size):
            batch = [f[0] for f in batch_files[i:i+batch_size]]
            avg_priority = sum(f[1] for f in batch_files[i:i+batch_size]) // len(batch) if batch else 5
            batches.append((batch, avg_priority))

        logger.info(f"Created {len(batches)} batches for {len(batch_files)} small files")
        logger.info(f"Individual files to process: {len(individual_files)}")

        # Submit batches to thread pool (I/O-bound)
        for batch, priority in batches:
            future = self.thread_executor.submit(
                self._process_batch,
                batch,
                0
            )
            future_to_file[future] = ({"name": f"Batch of {len(batch)} files"}, priority)

        # Submit individual files based on type - CRITICAL: Process ALL files
        submitted_count = 0
        for file_info, priority in individual_files:
            use_pool = self._should_use_pool(file_info)
            
            try:
                if use_pool:
                    # Use multiprocessing pool for CPU-intensive tasks
                    task_id = self.pool_manager.submit_task(
                        self.pool_pool_id,
                        self._process_file_worker,
                        (file_info, 0),
                        {}
                    )
                    if task_id:
                        task_id_to_file[task_id] = (file_info, priority, True)
                        submitted_count += 1
                    else:
                        logger.error(f"❌ Failed to submit pool task for {file_info.get('name', 'unknown')}")
                else:
                    # Use thread pool for I/O-bound tasks
                    future = self.thread_executor.submit(
                        self._process_file_worker,
                        file_info,
                        0
                    )
                    future_to_file[future] = (file_info, priority)
                    submitted_count += 1
            except Exception as e:
                logger.error(f"❌ Error submitting task for {file_info.get('name', 'unknown')}: {e}")
                # Create a failed result for this file to ensure it's tracked
                failed_result = {
                    "Metadata": file_info,
                    "Content": {"error": f"Failed to submit task: {str(e)}"}
                }
                with self.results_lock:
                    self.results.append(failed_result)
                with self.stats_lock:
                    self.stats['failed'] += 1
                    self.stats['total'] += 1
        
        logger.info(f"Submitted {submitted_count} individual files + {len(batches)} batches = {submitted_count + len(batches)} tasks")
        
        # VERIFY: Check if all files were submitted
        total_submitted_files = len(batch_files) + submitted_count
        if total_submitted_files != len(files):
            missing_count = len(files) - total_submitted_files
            logger.error(f"❌ CRITICAL: Not all files were submitted!")
            logger.error(f"   Total files: {len(files)}")
            logger.error(f"   Files in batches: {len(batch_files)}")
            logger.error(f"   Individual files submitted: {submitted_count}")
            logger.error(f"   Total submitted: {total_submitted_files}")
            logger.error(f"   Missing: {missing_count} files!")
            
            # Find which files were not submitted
            submitted_file_names = set()
            for batch in batches:
                for file_info in batch[0]:
                    submitted_file_names.add(file_info.get('name'))
            for task_id, (file_info, _, _) in task_id_to_file.items():
                submitted_file_names.add(file_info.get('name'))
            for future, (file_info, _) in future_to_file.items():
                if file_info.get('name') and not file_info.get('name').startswith('Batch'):
                    submitted_file_names.add(file_info.get('name'))
            
            all_file_names = {f.get('name') for f in files}
            missing_file_names = all_file_names - submitted_file_names
            if missing_file_names:
                logger.error(f"   Missing file names (first 50): {list(missing_file_names)[:50]}")
                # Create failed results for missing files to ensure they're tracked
                missing_files_added = 0
                for file_info in files:
                    if file_info.get('name') in missing_file_names:
                        failed_result = {
                            "Metadata": file_info,
                            "Content": {"error": "File was not submitted for processing - possible batching or submission error"}
                        }
                        with self.results_lock:
                            self.results.append(failed_result)
                        with self.stats_lock:
                            self.stats['failed'] += 1
                            self.stats['total'] += 1
                        missing_files_added += 1
                logger.warning(f"   Added {missing_files_added} failed results for missing files to ensure tracking")
                # Create failed results for missing files
                for file_info in files:
                    if file_info.get('name') in missing_file_names:
                        failed_result = {
                            "Metadata": file_info,
                            "Content": {"error": "File was not submitted for processing"}
                        }
                        with self.results_lock:
                            self.results.append(failed_result)
                        with self.stats_lock:
                            self.stats['failed'] += 1
                            self.stats['total'] += 1

        
        # Process as they complete with circuit breaker
        logger.info(f"Processing {len(files)} files in parallel (max {self.max_workers} workers, priority-based)...")
        
        from concurrent.futures import as_completed
        
        completed = 0
        # Use total_submitted for progress bar to account for batches
        # But we'll track actual file count separately
        pbar = tqdm(total=len(files), desc="Processing files", unit="file")
        circuit_breaker_triggered = False
        files_processed_count = 0  # Track actual number of files processed (not tasks)
        
        # Track all submitted tasks to ensure we process ALL of them
        total_submitted = len(future_to_file) + len(task_id_to_file)
        logger.info(f"Submitted {total_submitted} tasks for processing ({len(future_to_file)} thread tasks, {len(task_id_to_file)} pool tasks)")
        
        if total_submitted != len(files):
            logger.warning(f"⚠️ Mismatch: {total_submitted} tasks submitted but {len(files)} files found!")
            logger.warning(f"   This may indicate some files were not submitted for processing")
        
        try:
            # Process thread pool futures - ROBUST approach that ensures ALL are processed
            processed_futures = set()
            all_futures = list(future_to_file.keys())
            
            logger.info(f"Processing {len(all_futures)} thread futures...")
            
            # Process ALL futures - use while loop to ensure we get every single one
            max_wait_iterations = 1000000  # Very high limit
            iteration = 0
            
            while len(processed_futures) < len(all_futures) and iteration < max_wait_iterations:
                iteration += 1
                
                # Check which futures are done
                done_futures = [f for f in all_futures if f.done() and f not in processed_futures]
                
                if done_futures:
                    # Process all done futures
                    for future in done_futures:
                        processed_futures.add(future)
                else:
                    # Wait a bit and use as_completed with timeout
                    try:
                        remaining = [f for f in all_futures if f not in processed_futures]
                        if remaining:
                            # Wait for at least one to complete
                            for future in as_completed(remaining, timeout=0.5):
                                processed_futures.add(future)
                                break  # Process one, then check again
                    except TimeoutError:
                        # Check again if any completed
                        continue
            
            if len(processed_futures) < len(all_futures):
                logger.error(f"❌ Only processed {len(processed_futures)}/{len(all_futures)} futures after {iteration} iterations!")
                # Force process remaining ones
                for future in all_futures:
                    if future not in processed_futures:
                        if future.done():
                            processed_futures.add(future)
                        else:
                            logger.error(f"   Future for {future_to_file[future][0].get('name', 'unknown')} still not done!")
            
            # Now process all completed futures
            for future in processed_futures:
                # Check circuit breaker before processing result (but don't stop for storage errors)
                if self._check_circuit_breaker():
                    logger.warning("⚠️ Circuit breaker triggered - too many failures, but continuing...")
                    # Don't break - continue processing remaining files
                    # circuit_breaker_triggered = True
                
                file_info, priority = future_to_file[future]
                file_name = file_info.get('name', 'unknown')
                completed += 1
                files_processed_count += 1  # Track actual files
                
                logger.info(f"Completed task [{completed}/{total_submitted}] | Files [{files_processed_count}/{len(files)}] | Priority {priority}: {file_name}")
                
                with self.stats_lock:
                    self.stats['in_progress'] = sum(1 for f in future_to_file.keys() if not f.done()) + len(task_id_to_file)
                
                try:
                    # Increased timeout to handle large files
                    result = future.result(timeout=3600)  # 1 hour timeout for very large files
                    
                    # Handle batch results - each file in batch counts as separate file
                    if isinstance(result, list):
                        with self.results_lock:
                            self.results.extend(result)
                        for r in result:
                            is_failure = bool(r and r.get("Content", {}).get("error"))
                            
                            # Store to database if enabled (even if failed, to track all files)
                            if self.enable_storage and r:
                                try:
                                    file_info = r.get("Metadata", {})
                                    if file_info:
                                        # Use synchronous storage to ensure it completes
                                        path_id = self.storage_pipeline.store_file_complete(
                                            file_info,
                                            r,
                                            use_async=False
                                        )
                                        if not path_id:
                                            logger.debug(f"⚠ Batch file storage returned None (may be duplicate)")
                                        else:
                                            # Store extracted files from archives/emails individually
                                            # Note: Even if main file failed, extracted files should still be stored
                                            if path_id:
                                                self._store_extracted_files(r, path_id)
                                            elif not bool(r and r.get("Content", {}).get("error")):
                                                # If main file succeeded but path_id is None (duplicate),
                                                # still try to store extracted files with parent_path_id=None
                                                logger.debug(f"Main file returned None (duplicate), storing extracted files without parent")
                                                self._store_extracted_files(r, None)
                                except Exception as storage_error:
                                    logger.error(f"✗ Storage error in batch: {storage_error}", exc_info=True)
                            
                            with self.stats_lock:
                                if not is_failure:
                                    self.stats['completed'] += 1
                                else:
                                    self.stats['failed'] += 1
                            self.recent_failures.append(is_failure)
                        
                        # Update progress bar and counters for batch files
                        batch_size = len(result)
                        files_processed_count += batch_size - 1  # Additional files from batch
                        pbar.update(batch_size - 1)  # Update progress bar for remaining files in batch
                    else:
                        with self.results_lock:
                            self.results.append(result)
                        
                        # Check if this file failed
                        is_failure = bool(result and result.get("Content", {}).get("error"))
                        
                        # Store to database if enabled (even if failed, to track all files)
                        if self.enable_storage and result:
                            try:
                                file_info = result.get("Metadata", {})
                                if file_info:
                                    # Use synchronous storage to ensure it completes
                                    path_id = self.storage_pipeline.store_file_complete(
                                        file_info,
                                        result,
                                        use_async=False
                                    )
                                    if path_id:
                                        logger.debug(f"✓ Stored {file_name} to database (path_id: {path_id})")
                                    else:
                                        logger.warning(f"⚠ Storage returned None for {file_name} (may be duplicate or error)")
                                    
                                    # Store extracted files from archives/emails individually
                                    # Note: Even if main file failed, extracted files should still be stored
                                    if path_id:
                                        self._store_extracted_files(result, path_id)
                                    elif not is_failure:
                                        # If main file succeeded but path_id is None (duplicate),
                                        # still try to store extracted files with parent_path_id=None
                                        logger.debug(f"Main file returned None (duplicate), storing extracted files without parent")
                                        self._store_extracted_files(result, None)
                            except Exception as storage_error:
                                logger.error(f"✗ Storage error for {file_name}: {storage_error}", exc_info=True)
                        
                        with self.stats_lock:
                            if not is_failure:
                                self.stats['completed'] += 1
                            else:
                                self.stats['failed'] += 1
                        
                        # Track for circuit breaker
                        self.recent_failures.append(is_failure)
                    
                    if len(self.recent_failures) > self.failure_window * 2:
                        self.recent_failures = self.recent_failures[-self.failure_window * 2:]
                        
                except TimeoutError:
                    logger.error(f"Timeout processing {file_name}")
                    # Create error result for timeout
                    error_result = {
                        "Metadata": file_info,
                        "Content": {"error": f"Timeout after 3600 seconds"}
                    }
                    with self.results_lock:
                        self.results.append(error_result)
                    
                    # Store to database if enabled (even if failed, to track all files)
                    if self.enable_storage:
                        try:
                            path_id = self.storage_pipeline.store_file_complete(
                                file_info,
                                error_result,
                                use_async=False
                            )
                            if path_id:
                                logger.debug(f"⚠ Stored timeout file {file_name} to database (path_id: {path_id})")
                        except Exception as storage_error:
                            logger.error(f"✗ Storage error for timeout file {file_name}: {storage_error}", exc_info=True)
                    
                    with self.stats_lock:
                        self.stats['failed'] += 1
                    self.recent_failures.append(True)
                    future.cancel()
                    
                except Exception as e:
                    logger.error(f"Error processing {file_name}: {e}")
                    # Create error result for exception
                    error_result = {
                        "Metadata": file_info,
                        "Content": {"error": str(e)}
                    }
                    with self.results_lock:
                        self.results.append(error_result)
                    
                    # Store to database if enabled (even if failed, to track all files)
                    if self.enable_storage:
                        try:
                            path_id = self.storage_pipeline.store_file_complete(
                                file_info,
                                error_result,
                                use_async=False
                            )
                            if path_id:
                                logger.debug(f"⚠ Stored error file {file_name} to database (path_id: {path_id})")
                        except Exception as storage_error:
                            logger.error(f"✗ Storage error for error file {file_name}: {storage_error}", exc_info=True)
                    
                    with self.stats_lock:
                        self.stats['failed'] += 1
                    self.recent_failures.append(True)
                    
                pbar.update(1)
                pbar.set_postfix({"Priority": priority, "File": file_name[:30]})
            
            # CRITICAL: Double-check and wait for ANY remaining thread futures
            remaining_futures = [f for f in future_to_file.keys() if f not in processed_futures]
            if remaining_futures:
                logger.warning(f"⚠️ Found {len(remaining_futures)} remaining thread futures - waiting for them...")
                # Wait for all remaining futures with a longer timeout
                start_wait = time.time()
                max_wait_time = 3600  # 1 hour max wait
                
                while remaining_futures and (time.time() - start_wait) < max_wait_time:
                    # Check which ones are done
                    done_futures = [f for f in remaining_futures if f.done()]
                    for future in done_futures:
                        remaining_futures.remove(future)
                        processed_futures.add(future)
                    
                    if not done_futures:
                        # Wait a bit and check again
                        time.sleep(0.1)
                        # Try as_completed with short timeout
                        try:
                            for future in as_completed(remaining_futures, timeout=1):
                                remaining_futures.remove(future)
                                processed_futures.add(future)
                                break
                        except TimeoutError:
                            continue
                
                if remaining_futures:
                    logger.error(f"❌ {len(remaining_futures)} futures still not completed after waiting!")
                    # Force process them anyway
                    for future in remaining_futures:
                        try:
                            if future.done():
                                processed_futures.add(future)
                                
                                try:
                                    file_info, priority = future_to_file[future]
                                    file_name = file_info.get('name', 'unknown')
                                    result = future.result(timeout=3600)
                                    completed += 1
                                    files_processed_count += 1
                                    
                                    with self.results_lock:
                                        if isinstance(result, list):
                                            self.results.extend(result)
                                        else:
                                            self.results.append(result)
                                    
                                    is_failure = bool(result and result.get("Content", {}).get("error"))
                                    
                                    # Store to database if enabled (even if failed, to track all files)
                                    if self.enable_storage and result:
                                        try:
                                            file_info_meta = result.get("Metadata", {}) if not isinstance(result, list) else None
                                            if file_info_meta:
                                                path_id = self.storage_pipeline.store_file_complete(
                                                    file_info_meta, result, use_async=False
                                                )
                                                if path_id:
                                                    self._store_extracted_files(result, path_id)
                                        except Exception as e:
                                            logger.error(f"Storage error: {e}")
                                    
                                    with self.stats_lock:
                                        if not is_failure:
                                            self.stats['completed'] += 1
                                        else:
                                            self.stats['failed'] += 1
                                    
                                    pbar.update(1)
                                    pbar.set_postfix({"Priority": priority, "File": file_name[:30]})
                                except Exception as e:
                                    logger.error(f"Error processing remaining future: {e}")
                                    # Create error result
                                    file_info, priority = future_to_file[future]
                                    error_result = {
                                        "Metadata": file_info,
                                        "Content": {"error": f"Error processing remaining future: {str(e)}"}
                                    }
                                    with self.results_lock:
                                        self.results.append(error_result)
                                    
                                    # Store to database if enabled
                                    if self.enable_storage:
                                        try:
                                            path_id = self.storage_pipeline.store_file_complete(
                                                file_info, error_result, use_async=False
                                            )
                                            if path_id:
                                                logger.debug(f"⚠ Stored error remaining future file to database (path_id: {path_id})")
                                        except Exception as storage_error:
                                            logger.error(f"✗ Storage error for remaining future: {storage_error}")
                                    
                                    with self.stats_lock:
                                        self.stats['failed'] += 1
                                    pbar.update(1)
                        except Exception as e:
                            logger.error(f"Error accessing remaining future: {e}")
                            # Create error result for future we can't access
                            try:
                                file_info, priority = future_to_file[future]
                                error_result = {
                                    "Metadata": file_info,
                                    "Content": {"error": f"Could not access future result: {str(e)}"}
                                }
                                with self.results_lock:
                                    self.results.append(error_result)
                                
                                # Store to database if enabled
                                if self.enable_storage:
                                    try:
                                        path_id = self.storage_pipeline.store_file_complete(
                                            file_info, error_result, use_async=False
                                        )
                                        if path_id:
                                            logger.debug(f"⚠ Stored inaccessible future file to database (path_id: {path_id})")
                                    except Exception as storage_error:
                                        logger.error(f"✗ Storage error for inaccessible future: {storage_error}")
                                
                                with self.stats_lock:
                                    self.stats['failed'] += 1
                                pbar.update(1)
                            except:
                                pass
            
            # Process pool tasks - process ALL tasks regardless of circuit breaker
            processed_pool_tasks = set()
            all_pool_tasks = list(task_id_to_file.items())
            logger.info(f"Processing {len(all_pool_tasks)} pool tasks...")
            
            # Process ALL pool tasks - no skipping
            for task_id, (file_info, priority, _) in all_pool_tasks:
                if task_id in processed_pool_tasks:
                    logger.warning(f"⚠️ Task {task_id} already processed, skipping...")
                    continue
                
                logger.debug(f"Processing pool task {task_id}: {file_info.get('name', 'unknown')}")
                    
                try:
                    # Increased timeout for large files (images, PDFs, archives)
                    result_obj = self.pool_manager.wait_for_task(
                        self.pool_pool_id,
                        task_id,
                        timeout=3600  # 1 hour for very large files
                    )
                    
                    file_name = file_info.get('name', 'unknown')
                    
                    if result_obj and result_obj.success:
                        result = result_obj.result
                        processed_pool_tasks.add(task_id)
                        completed += 1
                        files_processed_count += 1
                    elif result_obj is None:
                        # Timeout or task not found
                        logger.warning(f"Pool task {task_id} returned None (timeout or not found) for {file_name}")
                        result = {
                            "Metadata": file_info,
                            "Content": {"error": "Pool task timeout or not found"}
                        }
                        processed_pool_tasks.add(task_id)  # Mark as processed to avoid infinite loop
                        completed += 1
                        files_processed_count += 1
                    else:
                        # Create error result for failed pool task
                        error_msg = result_obj.error if result_obj else "Pool task failed or timed out"
                        logger.warning(f"Pool task failed for {file_name}: {error_msg}")
                        result = {
                            "Metadata": file_info,
                            "Content": {"error": error_msg}
                        }
                        processed_pool_tasks.add(task_id)
                        completed += 1
                        files_processed_count += 1
                    
                    # Always add result to results list (even if failed)
                    with self.results_lock:
                        self.results.append(result)
                    
                    is_failure = bool(result and result.get("Content", {}).get("error"))
                    
                    # Store to database if enabled (even if failed, to track all files)
                    if self.enable_storage and result:
                        try:
                            file_info_meta = result.get("Metadata", {})
                            if file_info_meta:
                                # Use synchronous storage to ensure it completes
                                path_id = self.storage_pipeline.store_file_complete(
                                    file_info_meta,
                                    result,
                                    use_async=False
                                )
                                if path_id:
                                    if is_failure:
                                        logger.debug(f"⚠ Stored failed file {file_name} to database (path_id: {path_id})")
                                    else:
                                        logger.debug(f"✓ Stored {file_name} to database (path_id: {path_id})")
                                else:
                                    logger.warning(f"⚠ Storage returned None for {file_name} (may be duplicate or error)")
                                
                                # Store extracted files from archives/emails individually (only if path_id exists)
                                # Note: Even if main file failed, extracted files should still be stored
                                if path_id:
                                    self._store_extracted_files(result, path_id)
                                elif not is_failure:
                                    # If main file succeeded but path_id is None (duplicate), 
                                    # still try to store extracted files with parent_path_id=None
                                    # This ensures extracted files are not lost
                                    logger.debug(f"Main file returned None (duplicate), storing extracted files without parent")
                                    self._store_extracted_files(result, None)
                        except Exception as storage_error:
                            logger.error(f"✗ Storage error for {file_name}: {storage_error}", exc_info=True)
                    
                    with self.stats_lock:
                        if not is_failure:
                            self.stats['completed'] += 1
                        else:
                            self.stats['failed'] += 1
                    
                    self.recent_failures.append(is_failure)
                    pbar.update(1)
                    pbar.set_postfix({"Priority": priority, "File": file_name[:30]})
                        
                except Exception as e:
                    logger.error(f"Error processing pool task {task_id}: {e}")
                    # Create error result for exception
                    error_result = {
                        "Metadata": file_info,
                        "Content": {"error": f"Pool task exception: {str(e)}"}
                    }
                    with self.results_lock:
                        self.results.append(error_result)
                    
                    # Store to database if enabled (even if failed, to track all files)
                    if self.enable_storage:
                        try:
                            path_id = self.storage_pipeline.store_file_complete(
                                file_info,
                                error_result,
                                use_async=False
                            )
                            if path_id:
                                logger.debug(f"⚠ Stored error pool task file {file_info.get('name', 'unknown')} to database (path_id: {path_id})")
                        except Exception as storage_error:
                            logger.error(f"✗ Storage error for error pool task file: {storage_error}", exc_info=True)
                    
                    with self.stats_lock:
                        self.stats['failed'] += 1
                    self.recent_failures.append(True)
                    pbar.update(1)
        
        except TimeoutError:
            logger.warning("⚠ Some tasks timed out, but continuing with remaining files...")
            # Don't cancel - let them continue in background
            # for future in future_to_file.keys():
            #     if not future.done():
            #         future.cancel()
                    
        finally:
            pbar.close()
        
        # Count all processed files (including those that returned results with errors)
        total_processed = len(self.results)
        total_submitted_final = len(processed_futures) + len(processed_pool_tasks) if 'processed_futures' in locals() and 'processed_pool_tasks' in locals() else total_submitted
        
        files_processed_final = files_processed_count if 'files_processed_count' in locals() else total_processed
        
        # Get final counts
        futures_completed = len(processed_futures) if 'processed_futures' in locals() else 0
        pool_tasks_completed = len(processed_pool_tasks) if 'processed_pool_tasks' in locals() else 0
        total_tasks_completed = futures_completed + pool_tasks_completed
        
        # Count extracted files separately
        extracted_files_count = sum(1 for r in self.results if r and isinstance(r, dict) and r.get("Metadata", {}).get("path", "").count("::") > 0)
        original_results = [r for r in self.results if r and isinstance(r, dict) and r.get("Metadata", {}).get("path", "").count("::") == 0]
        original_files_processed = len(original_results)
        
        logger.info(f"Completed processing:")
        logger.info(f"  - Total results in list: {total_processed}")
        logger.info(f"  - Original files processed: {original_files_processed}")
        logger.info(f"  - Extracted files: {extracted_files_count}")
        logger.info(f"Tasks completed: {total_tasks_completed}/{total_submitted} (futures: {futures_completed}/{len(future_to_file)}, pool: {pool_tasks_completed}/{len(task_id_to_file)})")
        
        # Log detailed statistics - compare against ORIGINAL files only
        if original_files_processed < len(files) or total_tasks_completed < total_submitted:
            missing_files_count = len(files) - original_files_processed
            missing_tasks_count = total_submitted - total_tasks_completed
            
            logger.error(f"❌ INCOMPLETE PROCESSING DETECTED!")
            logger.error(f"   Original files: {missing_files_count} files not processed ({original_files_processed}/{len(files)})")
            logger.error(f"   Tasks: {missing_tasks_count} tasks not completed ({total_tasks_completed}/{total_submitted})")
            logger.error(f"   Futures: {len(future_to_file) - futures_completed} not completed")
            logger.error(f"   Pool tasks: {len(task_id_to_file) - pool_tasks_completed} not completed")
            
            # Try to identify which files were not processed
            processed_file_names = {r.get("Metadata", {}).get("name") for r in original_results if r and r.get("Metadata")}
            all_file_names = {f.get("name") for f in files}
            missing_files = all_file_names - processed_file_names
            if missing_files:
                logger.error(f"   Missing files (first 50): {list(missing_files)[:50]}")
                logger.error(f"   Total missing files: {len(missing_files)}")
                
                # Log file types of missing files
                missing_file_types = {}
                for file_info in files:
                    if file_info.get('name') in missing_files:
                        ext = file_info.get('extension', 'no_ext').lower()
                        missing_file_types[ext] = missing_file_types.get(ext, 0) + 1
                logger.error(f"   Missing file types: {dict(sorted(missing_file_types.items(), key=lambda x: x[1], reverse=True)[:10])}")
        
        # FINAL CHECK: Ensure all files are in results (even if failed)
        final_original_results = [r for r in self.results if r and isinstance(r, dict) and r.get("Metadata", {}).get("path", "").count("::") == 0]
        final_original_count = len(final_original_results)
        
        if final_original_count < len(files):
            logger.warning(f"⚠️ Final check: {len(files) - final_original_count} files still missing from results")
            logger.warning(f"   This may indicate files that were submitted but never returned results")
        
        with self.stats_lock:
            self.stats['end_time'] = time.time()
            
        self.is_processing = False
        
        # Display summary
        self._display_summary(circuit_breaker_triggered)
        
        # Record completion
        record_command_line_action(
            "FUNCTION_CALL",
            "Folder processing completed",
            {
                "folder_path": folder_path,
                "total_files": self.stats['total'],
                "completed": self.stats['completed'],
                "failed": self.stats['failed'],
                "processing_time": self.stats['end_time'] - self.stats['start_time'],
                "circuit_breaker_triggered": circuit_breaker_triggered
            }
        )
        
        return self.results
    
    def _check_circuit_breaker(self) -> bool:
        """Check if we should stop processing due to too many failures"""
        if len(self.recent_failures) < self.failure_window:
            return False
        
        recent = self.recent_failures[-self.failure_window:]
        failure_count = sum(1 for failed in recent if failed)
        
        if failure_count >= self.failure_threshold:
            logger.error(
                f"Circuit breaker triggered: {failure_count}/{self.failure_window} recent failures"
            )
            return True
        
        return False
    
    def _display_summary(self, circuit_breaker_triggered=False):
        """Display processing summary"""
        with self.stats_lock:
            total = self.stats.get('total', 0)
            original_files = self.stats.get('original_files', total)
            extracted_files = self.stats.get('extracted_files', 0)
            completed = self.stats['completed']
            failed = self.stats['failed']
            processing_time = (self.stats['end_time'] or time.time()) - (self.stats['start_time'] or time.time())
            
        success_rate = (completed / original_files * 100) if original_files > 0 else 0
        
        logger.info(f"{'='*70}")
        logger.info(f"FOLDER PROCESSING SUMMARY")
        logger.info(f"{'='*70}")
        logger.info(f"Original Files:          {original_files}")
        logger.info(f"Extracted Files:         {extracted_files}")
        logger.info(f"Total Files Processed:   {total}")
        logger.info(f"Successful:              {completed}")
        logger.info(f"Failed:                  {failed}")
        logger.info(f"Success Rate:            {success_rate:.1f}%")
        logger.info(f"Total Time:              {processing_time:.2f}s")
        logger.info(f"Avg Time per File:       {processing_time/original_files:.2f}s" if original_files > 0 else "N/A")
        logger.info(f"Files per Second:        {original_files/processing_time:.2f}" if processing_time > 0 else "N/A")
        if circuit_breaker_triggered:
            logger.warning(f"⚠️  Circuit Breaker:      TRIGGERED")
        logger.info(f"{'='*70}\n")
        
        if self.results:
            calculate_processing_statistics(self.results)



   
    def _store_extracted_files(self, result: Dict, parent_path_id: Optional[int] = None):
        """
        Recursively store extracted files from archives/emails individually
        Also adds them to results list for proper tracking
        
        Args:
            result: Processing result that may contain extracted_files
            parent_path_id: Optional parent path ID for hierarchy
        """
        if not result or not isinstance(result, dict):
            return
        
        content = result.get("Content", {})
        if not isinstance(content, dict):
            return
        
        # Check for archive extracted files
        if "extracted_files" in content and isinstance(content["extracted_files"], list):
            extracted_count = 0
            for extracted_result in content["extracted_files"]:
                if isinstance(extracted_result, dict) and extracted_result.get("Metadata"):
                    extracted_file_info = extracted_result.get("Metadata", {})
                    extracted_content = extracted_result.get("Content", {})
                    
                    # Add to results list for tracking (even if has error)
                    with self.results_lock:
                        self.results.append(extracted_result)
                    
                    # Update statistics AND file counter
                    is_failure = bool(isinstance(extracted_content, dict) and extracted_content.get("error"))
                    with self.stats_lock:
                        if not is_failure:
                            self.stats['completed'] += 1
                        else:
                            self.stats['failed'] += 1
                        # Track extracted files separately
                        self.stats['extracted_files'] = self.stats.get('extracted_files', 0) + 1
                        self.stats['total'] += 1  # Total includes extracted files
                    
                    # Update files_processed_count if it exists in the scope
                    if 'files_processed_count' in globals() or 'files_processed_count' in locals():
                        # We'll update it through a different mechanism
                        pass
                    
                    # Store ALL extracted files (even if failed) to track them in database
                    # This ensures all processed files are stored, not just successful ones
                    if self.enable_storage:
                        try:
                            # Build hierarchy path
                            parent_path = result.get("Metadata", {}).get("path", "")
                            extracted_path = extracted_file_info.get("path", "")
                            hierarchy_path = f"{parent_path}::{extracted_path}" if parent_path else extracted_path
                            
                            # Store extracted file individually (even if failed)
                            extracted_path_id = self.storage_pipeline.store_file_complete(
                                extracted_file_info,
                                extracted_result,
                                parent_path_id=parent_path_id,
                                hierarchy_path=hierarchy_path,
                                use_async=False
                            )
                            
                            if extracted_path_id:
                                extracted_count += 1
                                if is_failure:
                                    logger.debug(f"⚠ Stored failed extracted file: {extracted_file_info.get('name', 'unknown')} (path_id: {extracted_path_id})")
                                else:
                                    logger.debug(f"✓ Stored extracted file: {extracted_file_info.get('name', 'unknown')} (path_id: {extracted_path_id})")
                                
                                # Recursively store nested extracted files (for nested archives)
                                self._store_extracted_files(extracted_result, extracted_path_id)
                            else:
                                logger.warning(f"⚠ Storage returned None for extracted file: {extracted_file_info.get('name', 'unknown')} (may be duplicate)")
                        except Exception as e:
                            logger.error(f"✗ Error storing extracted file: {e}", exc_info=True)
            
            if extracted_count > 0:
                logger.info(f"✓ Stored {extracted_count} extracted files from archive")
        
        # Check for email attachments
        if "attachments" in content and isinstance(content["attachments"], dict):
            attachments_data = content["attachments"]
            if "extracted_files" in attachments_data and isinstance(attachments_data["extracted_files"], list):
                attachment_count = 0
                for attachment_result in attachments_data["extracted_files"]:
                    if isinstance(attachment_result, dict) and attachment_result.get("Metadata"):
                        attachment_file_info = attachment_result.get("Metadata", {})
                        attachment_content = attachment_result.get("Content", {})
                        
                        # Add to results list for tracking (even if has error)
                        with self.results_lock:
                            self.results.append(attachment_result)
                        
                        # Update statistics AND file counter
                        is_failure = bool(isinstance(attachment_content, dict) and attachment_content.get("error"))
                        with self.stats_lock:
                            if not is_failure:
                                self.stats['completed'] += 1
                            else:
                                self.stats['failed'] += 1
                            # Track extracted files separately
                            self.stats['extracted_files'] = self.stats.get('extracted_files', 0) + 1
                            self.stats['total'] += 1  # Total includes extracted files
                        
                        # Store ALL attachments (even if failed) to track them in database
                        # This ensures all processed files are stored, not just successful ones
                        if self.enable_storage:
                            try:
                                # Build hierarchy path
                                parent_path = result.get("Metadata", {}).get("path", "")
                                attachment_path = attachment_file_info.get("path", "")
                                hierarchy_path = f"{parent_path}::attachment::{attachment_path}" if parent_path else attachment_path
                                
                                # Store attachment individually (even if failed)
                                attachment_path_id = self.storage_pipeline.store_file_complete(
                                    attachment_file_info,
                                    attachment_result,
                                    parent_path_id=parent_path_id,
                                    hierarchy_path=hierarchy_path,
                                    use_async=False
                                )
                                
                                if attachment_path_id:
                                    attachment_count += 1
                                    if is_failure:
                                        logger.debug(f"⚠ Stored failed email attachment: {attachment_file_info.get('name', 'unknown')} (path_id: {attachment_path_id})")
                                    else:
                                        logger.debug(f"✓ Stored email attachment: {attachment_file_info.get('name', 'unknown')} (path_id: {attachment_path_id})")
                                    
                                    # Recursively store nested extracted files
                                    self._store_extracted_files(attachment_result, attachment_path_id)
                                else:
                                    logger.warning(f"⚠ Storage returned None for email attachment: {attachment_file_info.get('name', 'unknown')} (may be duplicate)")
                            except Exception as e:
                                logger.error(f"✗ Error storing email attachment: {e}", exc_info=True)
                
                if attachment_count > 0:
                    logger.info(f"✓ Stored {attachment_count} email attachments")
    
    def _process_file_worker(self, file_info: Dict, depth: int = 0) -> Optional[Dict]:
        """
        Worker function that processes a single file
        This wraps your existing main_specify_method_of_reading_the_file
        
        Args:
            file_info: File metadata
            depth: Recursion depth for nested files
            
        Returns:
            Processing result (always returns a dict, never None)
        """
        try:
            logger.debug(f"Worker processing: {file_info.get('name', 'unknown')}")
            
            # Use your existing file processing function
            result = main_specify_method_of_reading_the_file(
                file_info,
                collect=True,
                depth=depth
            )
            
            # Ensure we always return a result dict, never None
            if result is None:
                logger.warning(f"Worker returned None for {file_info.get('name', 'unknown')}, creating error result")
                result = {
                    "Metadata": file_info,
                    "Content": {"error": "File processing returned None"}
                }
            
            logger.debug(f"Worker completed: {file_info.get('name', 'unknown')}")
            return result
            
        except Exception as e:
            logger.error(f"Worker error processing {file_info.get('path')}: {e}", exc_info=True)
            return {
                "Metadata": file_info,
                "Content": {"error": str(e)}
            }
            
    def get_statistics(self) -> Dict:
        """
        Get current processing statistics from all managers
        
        Returns:
            Dictionary with statistics
        """
        with self.stats_lock:
            stats = self.stats.copy()
            
        # Add statistics from all managers
        if self.is_initialized:
            stats['thread_manager'] = self.thread_manager.get_statistics()
            stats['pool_manager'] = self.pool_manager.get_statistics()
            stats['process_manager'] = self.process_manager.get_statistics()
            stats['async_manager'] = self.async_manager.get_statistics()
                
        return stats
        
    def get_results(self) -> List[Dict]:
        """Get all processing results"""
        with self.results_lock:
            return self.results.copy()
            
    def is_complete(self) -> bool:
        """Check if processing is complete"""
        return not self.is_processing
        
    # Control operations
    
    def pause_processing(self):
        """Pause all file processing across all managers"""
        if self.is_initialized:
            # Pause all threads
            for thread_id in list(self.thread_manager.threads.keys()):
                self.thread_manager.pause_thread(thread_id)
            
            # Note: Pool and Process managers don't support pause, but we can stop accepting new tasks
            logger.info("⏸️  Processing paused")
            
    def resume_processing(self):
        """Resume file processing across all managers"""
        if self.is_initialized:
            # Resume all threads
            for thread_id in list(self.thread_manager.threads.keys()):
                self.thread_manager.resume_thread(thread_id)
            
            logger.info("▶️  Processing resumed")
            
    def stop_processing(self):
        """Stop all file processing across all managers"""
        if self.is_initialized:
            # Stop thread executor
            if hasattr(self, 'thread_executor'):
                self.thread_executor.shutdown(wait=False, cancel_futures=True)
            
            # Stop all managers
            self.thread_manager.stop_all(timeout=10.0)
            self.pool_manager.stop_all_pools()
            self.process_manager.stop_all(timeout=10.0)
            self.async_manager.stop_all()
            
            self.is_processing = False
            logger.info("🛑 Processing stopped")
            
    def get_health_report(self) -> Dict:
        """Get system health report from all managers"""
        health = {}
        if self.is_initialized and self.enable_monitoring:
            health['thread_manager'] = self.thread_manager.get_statistics()
            health['pool_manager'] = self.pool_manager.get_statistics()
            health['process_manager'] = self.process_manager.get_statistics()
            health['async_manager'] = self.async_manager.get_statistics()
        return health
        
    # Context manager support
    
    def __enter__(self):
        """Context manager entry"""
        self.initialize()
        return self
        
    def shutdown(self):
        """Shutdown all managers and storage pipelines"""
        if self.is_processing:
            logger.info("Stopping processing due to shutdown")
            self.stop_processing()
        
        if self.is_initialized:
            logger.info("Shutting down all concurrency managers...")
            
            # Flush storage batches if enabled
            if self.enable_storage:
                try:
                    if self.batch_pipeline:
                        logger.info("Flushing storage batches...")
                        self.batch_pipeline.flush_all_batches()
                        self.batch_pipeline.shutdown()
                    
                    if self.storage_pipeline:
                        # Wait a moment for any pending storage operations
                        time.sleep(0.5)
                        
                        storage_stats = self.storage_pipeline.get_statistics()
                        logger.info(f"Storage statistics: {storage_stats}")
                        logger.info(f"  - Total files attempted: {storage_stats.get('total', 0)}")
                        logger.info(f"  - Successfully stored: {storage_stats.get('completed', 0)}")
                        logger.info(f"  - Failed: {storage_stats.get('failed', 0)}")
                        logger.info(f"  - Duplicates skipped: {storage_stats.get('duplicates', 0)}")
                        self.storage_pipeline.shutdown()
                except Exception as e:
                    logger.warning(f"Error during storage shutdown: {e}")
            
            # Stop monitoring
            if self.enable_monitoring:
                self.thread_manager.stop_monitoring()
                self.pool_manager.stop_monitoring()
                self.process_manager.stop_monitoring()
                # Async manager monitoring is handled by thread, no need to stop separately
                if hasattr(self, 'monitor_task_id') and self.monitor_task_id:
                    # Thread will stop automatically when daemon=True
                    pass
            
            # Shutdown thread executor
            if hasattr(self, 'thread_executor'):
                self.thread_executor.shutdown(wait=True)
            
            # Shutdown all managers
            self.thread_manager.shutdown()
            self.pool_manager.shutdown()
            self.process_manager.shutdown()
            self.async_manager.shutdown()
            
            logger.info("All managers shut down successfully")
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.shutdown()
        return False