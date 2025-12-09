"""
Batch Pipeline - Batch operations for efficient bulk inserts with multi-concurrency support
Uses ThreadManager, MultiprocessingManager, ProcessManager, and AsyncManager
for parallel batch processing
"""
from typing import Dict, List, Tuple
import threading
import sys
from pathlib import Path

# Add parent directory to path for imports
parent_dir = Path(__file__).parent.parent.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

from psycopg2.extras import execute_batch

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

class BatchPipeline:
    def __init__(self, batch_size: int = 500, enable_concurrency: bool = True, max_workers: int = 4):
        from ..managers.hub import get_database_hub
        self.hub = get_database_hub()
        self.batch_size = batch_size
        self.enable_concurrency = enable_concurrency
        self.max_workers = max_workers
        
        # Batch buffers
        self._word_batch: List[str] = []
        self._hash_batch: List[Tuple] = []
        self._path_batch: List[Tuple] = []
        self._word_path_batch: List[Tuple] = []
        self._keyword_path_batch: List[Tuple] = []
        
        self._lock = threading.RLock()
        
        # Initialize concurrency managers if enabled
        if self.enable_concurrency:
            self.thread_manager = ThreadManager()
            self.pool_manager = MultiprocessingManager()
            self.process_manager = ProcessManager()
            self.async_manager = AsyncManager()
            
            # Initialize async manager
            self.async_manager.initialize()
            
            # Create pool for batch processing
            self.batch_pool_id = self.pool_manager.create_pool(
                name="BatchProcessing",
                worker_count=min(max_workers, 2),  # Fewer workers for batch ops
                priority=PoolPriority.NORMAL
            )
            
            # Thread executor for I/O-bound batch operations
            from concurrent.futures import ThreadPoolExecutor
            self.thread_executor = ThreadPoolExecutor(
                max_workers=max_workers,
                thread_name_prefix="BatchWorker"
            )
        else:
            self.thread_manager = None
            self.pool_manager = None
            self.process_manager = None
            self.async_manager = None
            self.batch_pool_id = None
            self.thread_executor = None
    
    def add_word_to_batch(self, word: str):
        """Add word to batch"""
        with self._lock:
            if word not in self._word_batch:
                self._word_batch.append(word)
                if len(self._word_batch) >= self.batch_size:
                    self.flush_word_batch()
    
    def flush_word_batch(self, use_async: bool = False) -> Dict[str, int]:
        """
        Flush word batch with optional async/concurrent execution
        
        Args:
            use_async: If True, use async manager for non-blocking flush
            
        Returns:
            Dictionary mapping words to word IDs
        """
        if not self._word_batch:
            return {}
        
        with self._lock:
            words = self._word_batch.copy()
            self._word_batch.clear()
        
        if use_async and self.enable_concurrency and self.async_manager:
            # Use async for non-blocking batch insert
            import asyncio
            async def async_flush():
                return self.hub.word_operations.batch_insert_words(words)
            
            # Create async task
            task_id = self.async_manager.create_task(
                name="FlushWordBatch",
                coro=async_flush(),
                priority=TaskPriority.LOW,
                auto_start=True
            )
            # Return empty dict for now (caller can check later)
            return {}
        
        # Synchronous batch insert
        if self.enable_concurrency and len(words) > 1000:
            # Use pool for large batches (CPU-intensive)
            task_id = self.pool_manager.submit_task(
                self.batch_pool_id,
                self.hub.word_operations.batch_insert_words,
                (words,),
                {}
            )
            result_obj = self.pool_manager.wait_for_task(
                self.batch_pool_id,
                task_id,
                timeout=60
            )
            if result_obj and result_obj.success:
                return result_obj.result
            return {}
        
        return self.hub.word_operations.batch_insert_words(words)
    
    def add_hash_to_batch(self, file_hash: str, source_id: int, side_id: int):
        """Add hash to batch"""
        with self._lock:
            self._hash_batch.append((file_hash, source_id, side_id))
            if len(self._hash_batch) >= self.batch_size:
                self.flush_hash_batch()
    
    def flush_hash_batch(self, use_async: bool = False):
        """
        Flush hash batch with optional async/concurrent execution
        
        Args:
            use_async: If True, use async manager for non-blocking flush
        """
        if not self._hash_batch:
            return
        
        with self._lock:
            hashes = self._hash_batch.copy()
            self._hash_batch.clear()
        
        if use_async and self.enable_concurrency and self.async_manager:
            # Use async for non-blocking batch insert
            import asyncio
            async def async_flush():
                for file_hash, source_id, side_id in hashes:
                    self.hub.hash_operations.store_hash(file_hash, source_id, side_id)
            
            # Create async task
            task_id = self.async_manager.create_task(
                name="FlushHashBatch",
                coro=async_flush(),
                priority=TaskPriority.LOW,
                auto_start=True
            )
            return
        
        # Synchronous batch insert - use thread pool for I/O-bound operations
        if self.enable_concurrency and len(hashes) > 100:
            futures = []
            for file_hash, source_id, side_id in hashes:
                future = self.thread_executor.submit(
                    self.hub.hash_operations.store_hash,
                    file_hash,
                    source_id,
                    side_id
                )
                futures.append(future)
            
            # Wait for all to complete
            for future in futures:
                try:
                    future.result(timeout=30)
                except Exception as e:
                    print(f"✗ Error flushing hash: {e}")
        else:
            # Sequential for small batches
            for file_hash, source_id, side_id in hashes:
                self.hub.hash_operations.store_hash(file_hash, source_id, side_id)
    
    def flush_all_batches(self, use_async: bool = False):
        """
        Flush all pending batches with optional async/concurrent execution
        
        Args:
            use_async: If True, use async manager for non-blocking flush
        """
        if self.enable_concurrency and use_async:
            # Flush all batches asynchronously
            self.flush_word_batch(use_async=True)
            self.flush_hash_batch(use_async=True)
        else:
            # Sequential flush
            self.flush_word_batch()
            self.flush_hash_batch()
    
    def get_batch_stats(self) -> Dict[str, int]:
        """Get batch statistics"""
        with self._lock:
            stats = {
                'words': len(self._word_batch),
                'hashes': len(self._hash_batch),
                'paths': len(self._path_batch),
                'word_paths': len(self._word_path_batch),
                'keyword_paths': len(self._keyword_path_batch)
            }
            
            # Add concurrency manager stats if enabled
            if self.enable_concurrency:
                stats['thread_manager'] = self.thread_manager.get_statistics() if self.thread_manager else {}
                stats['pool_manager'] = self.pool_manager.get_statistics() if self.pool_manager else {}
                stats['process_manager'] = self.process_manager.get_statistics() if self.process_manager else {}
                stats['async_manager'] = self.async_manager.get_statistics() if self.async_manager else {}
            
            return stats
    
    def shutdown(self):
        """Shutdown concurrency managers"""
        if self.enable_concurrency:
            # Flush all batches before shutdown
            self.flush_all_batches()
            
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