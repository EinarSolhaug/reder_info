"""
Word Operations - Operations for words and words_paths tables
Extracted from storage.py and batch_storage.py
"""

from typing import Dict, List, Tuple
from collections import Counter
import threading
from psycopg2.extras import execute_batch

from database.processors.validation_processor import ValidationProcessor

 
class WordOperations:
    """Operations for words and words_paths tables"""
    
    def __init__(self, connection_manager, cache_max_size: int = 50000, batch_size: int = 500):
        self.connection_manager = connection_manager
        self.cache_max_size = cache_max_size
        self.batch_size = batch_size
        
        # Thread-safe cache
        self._word_cache: Dict[str, int] = {}
        self._cache_lock = threading.RLock()
        
        # Batch buffer for batch operations
        self._word_batch: List[Tuple[str]] = []
        self._batch_lock = threading.RLock()
        
    
    def get_or_create_word_id(self, word: str) -> int:
        """
        Get or create word ID with caching.
        
        Args:
            word: Word to get/create
            
        Returns:
            word_id
        """
        word = ValidationProcessor.sanitize_text(word.lower())
        
        # Check cache
        with self._cache_lock:
            if word in self._word_cache:
                return self._word_cache[word]
        
        # Query database
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM words WHERE word = %s", (word,))
            result = cursor.fetchone()
            
            if result:
                word_id = result[0]
            else:
                cursor.execute(
                    "INSERT INTO words (word) VALUES (%s) "
                    "ON CONFLICT (word) DO UPDATE SET word = EXCLUDED.word "
                    "RETURNING id",
                    (word,)
                )
                word_id = cursor.fetchone()[0]
                conn.commit()
            
            # Update cache
            with self._cache_lock:
                if len(self._word_cache) < self.cache_max_size:
                    self._word_cache[word] = word_id
            
            return word_id
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def batch_insert_words(self, words: List[str]) -> Dict[str, int]:
        """
        Batch insert words and return word_id mapping.
        
        Args:
            words: List of words to insert
            
        Returns:
            Dict mapping word to word_id
        """
        conn = self.connection_manager.get_connection()
        word_id_map = {}
        
        try:
            cursor = conn.cursor()
            
            # Sanitize words
            sanitized_words = [ValidationProcessor.sanitize_text(w.lower()) for w in words]
            
            # Get existing words
            if sanitized_words:
                placeholders = ','.join(['%s'] * len(sanitized_words))
                cursor.execute(
                    f"SELECT id, word FROM words WHERE word IN ({placeholders})",
                    sanitized_words
                )
                
                existing = {word: word_id for word_id, word in cursor.fetchall()}
                word_id_map.update(existing)
                
                # Insert new words
                new_words = [w for w in sanitized_words if w not in existing]
                if new_words:
                    for word in new_words:
                        cursor.execute(
                            "INSERT INTO words (word) VALUES (%s) "
                            "ON CONFLICT (word) DO NOTHING RETURNING id, word",
                            (word,)
                        )
                        result = cursor.fetchone()
                        if result:
                            word_id_map[result[1]] = result[0]
                
                conn.commit()
                
                # Update cache
                with self._cache_lock:
                    for word, word_id in word_id_map.items():
                        if len(self._word_cache) < self.cache_max_size:
                            self._word_cache[word] = word_id
            
            return word_id_map
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def store_word_frequencies(self, path_id: int, word_counts: Dict[str, int]):
        """
        Store word frequency counts for a file.
        
        Args:
            path_id: Path ID
            word_counts: Dict mapping word to count
        """
        if not word_counts:
            return
        
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            
            # Get word IDs for all words
            bulk_data = []
            for word, count in word_counts.items():
                word_id = self.get_or_create_word_id(word)
                bulk_data.append((path_id, word_id, count))
            
            # Bulk insert
            execute_batch(
                cursor,
                "INSERT INTO words_paths (path_id, word_id, word_count) "
                "VALUES (%s, %s, %s) "
                "ON CONFLICT (path_id, word_id) DO UPDATE SET word_count = EXCLUDED.word_count",
                bulk_data,
                page_size=500
            )
            
            conn.commit()
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_word_frequencies(self, path_id: int) -> Dict[str, int]:
        """
        Get word frequencies for a file.
        
        Args:
            path_id: Path ID
            
        Returns:
            Dict mapping word to count
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT w.word, wp.word_count
                FROM words_paths wp
                JOIN words w ON wp.word_id = w.id
                WHERE wp.path_id = %s
            """, (path_id,))
            
            return {row[0]: row[1] for row in cursor.fetchall()}
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_cache_stats(self) -> Dict[str, int]:
        """Get cache statistics"""
        with self._cache_lock:
            return {
                'cached_words': len(self._word_cache),
                'cache_max_size': self.cache_max_size
            }
    
    def clear_cache(self):
        """Clear word cache"""
        with self._cache_lock:
            self._word_cache.clear()
    
    # ==================== BATCH OPERATIONS ====================
    
    def add_word_to_batch(self, word: str):
        """Add word to batch buffer"""
        word = ValidationProcessor.sanitize_text(word.lower())
        if not word:
            return
        
        with self._batch_lock:
            # Check if already in batch
            if word not in [w[0] for w in self._word_batch]:
                self._word_batch.append((word,))
    
    def flush_word_batch(self) -> Dict[str, int]:
        """
        Flush word batch to database.
        Returns: {word: word_id} mapping
        """
        if not self._word_batch:
            return {}
        
        conn = self.connection_manager.get_connection()
        word_id_map = {}
        
        try:
            cursor = conn.cursor()
            
            # Get existing words
            words_to_check = [w[0] for w in self._word_batch]
            placeholders = ','.join(['%s'] * len(words_to_check))
            cursor.execute(
                f"SELECT id, word FROM words WHERE word IN ({placeholders})",
                words_to_check
            )
            
            existing = {word: word_id for word_id, word in cursor.fetchall()}
            
            # Separate new and existing words
            new_words = []
            for word_tuple in self._word_batch:
                word = word_tuple[0]
                if word in existing:
                    word_id_map[word] = existing[word]
                else:
                    new_words.append(word_tuple)
            
            # Bulk insert new words
            if new_words:
                # Insert one by one to get IDs (execute_batch doesn't return values)
                for word_tuple in new_words:
                    word = word_tuple[0]
                    cursor.execute(
                        "INSERT INTO words (word) VALUES (%s) ON CONFLICT (word) DO NOTHING RETURNING id, word",
                        (word,)
                    )
                    result = cursor.fetchone()
                    if result:
                        word_id, word = result
                        word_id_map[word] = word_id
            
            # Update cache
            with self._cache_lock:
                for word, word_id in word_id_map.items():
                    if len(self._word_cache) < self.cache_max_size:
                        self._word_cache[word] = word_id
            
            conn.commit()
            
            # Clear batch
            with self._batch_lock:
                self._word_batch.clear()
            
            return word_id_map
            
        except Exception as e:
            conn.rollback()
            print(f"⚠️ Error flushing word batch: {e}")
            return word_id_map
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_batch_stats(self) -> Dict[str, int]:
        """Get batch statistics"""
        with self._batch_lock:
            return {'words_in_batch': len(self._word_batch)}