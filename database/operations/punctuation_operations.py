"""
Punctuation Operations Module
Handles punctuation table operations with batch support and caching.
"""

import threading
from typing import Dict, Optional, List, Tuple
from psycopg2.extras import execute_batch

from database.processors.validation_processor import ValidationProcessor


class PunctuationOperations:
    """Operations for punctuation table"""
    
    def __init__(self, connection_manager, cache_max_size: int = 1000, batch_size: int = 500):
        """
        Initialize punctuation operations.
        
        Args:
            connection_manager: ConnectionManager instance
            cache_max_size: Maximum cache size for punctuation
            batch_size: Batch size for bulk operations
        """
        self.connection_manager = connection_manager
        self._punctuation_cache: Dict[str, int] = {}
        self._cache_lock = threading.RLock()
        self._cache_max_size = cache_max_size
        self.batch_size = batch_size
        
        # Batch buffer for batch operations
        self._punctuation_batch: List[Tuple[str]] = []
        self._batch_lock = threading.RLock()
        
        # Preload punctuation cache at startup
        self._preload_punctuation_cache()
    

    
    def _preload_punctuation_cache(self):
        """Preload all punctuation patterns from database at startup"""
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id, punctuation_text FROM punctuation")
            
            with self._cache_lock:
                for punct_id, punct_text in cursor.fetchall():
                    self._punctuation_cache[punct_text] = punct_id
            
            print(f"✓ Loaded {len(self._punctuation_cache)} punctuation patterns")
            
        except Exception as e:
            print(f"⚠️ Could not preload punctuation cache: {e}")
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_or_create_punctuation_id(self, punctuation: str) -> int:
        """Get or create punctuation ID with caching"""
        punctuation = ValidationProcessor.sanitize_text(punctuation)
        
        # Check cache
        with self._cache_lock:
            if punctuation in self._punctuation_cache:
                return self._punctuation_cache[punctuation]
        
        # Query database
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM punctuation WHERE punctuation_text = %s",
                (punctuation,)
            )
            result = cursor.fetchone()
            
            if result:
                punct_id = result[0]
            else:
                # Insert new punctuation
                cursor.execute(
                    "INSERT INTO punctuation (punctuation_text) VALUES (%s) "
                    "ON CONFLICT (punctuation_text) DO UPDATE SET punctuation_text = EXCLUDED.punctuation_text "
                    "RETURNING id",
                    (punctuation,)
                )
                punct_id = cursor.fetchone()[0]
                conn.commit()
            
            # Update cache
            with self._cache_lock:
                if len(self._punctuation_cache) < self._cache_max_size:
                    self._punctuation_cache[punctuation] = punct_id
            
            return punct_id
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def add_punctuation_to_batch(self, punctuation: str):
        """Add punctuation to batch buffer"""
        punctuation = ValidationProcessor.sanitize_text(punctuation)
        if not punctuation:
            return
        
        with self._batch_lock:
            # Check if already in batch
            if punctuation not in [p[0] for p in self._punctuation_batch]:
                self._punctuation_batch.append((punctuation,))
    
    def flush_punctuation_batch(self) -> Dict[str, int]:
        """
        Flush punctuation batch to database.
        
        Returns:
            {punctuation: punctuation_id} mapping
        """
        if not self._punctuation_batch:
            return {}
        
        conn = self.connection_manager.get_connection()
        punct_id_map = {}
        
        try:
            cursor = conn.cursor()
            
            # Get existing punctuation
            puncts_to_check = [p[0] for p in self._punctuation_batch]
            placeholders = ','.join(['%s'] * len(puncts_to_check))
            cursor.execute(
                f"SELECT id, punctuation_text FROM punctuation WHERE punctuation_text IN ({placeholders})",
                puncts_to_check
            )
            
            existing = {punct: punct_id for punct_id, punct in cursor.fetchall()}
            
            # Separate new and existing punctuation
            new_puncts = []
            for punct_tuple in self._punctuation_batch:
                punct = punct_tuple[0]
                if punct in existing:
                    punct_id_map[punct] = existing[punct]
                else:
                    new_puncts.append(punct_tuple)
            
            # Bulk insert new punctuation
            if new_puncts:
                for punct_tuple in new_puncts:
                    punct = punct_tuple[0]
                    cursor.execute(
                        "INSERT INTO punctuation (punctuation_text) VALUES (%s) ON CONFLICT (punctuation_text) DO NOTHING RETURNING id, punctuation_text",
                        (punct,)
                    )
                    result = cursor.fetchone()
                    if result:
                        punct_id, punct = result
                        punct_id_map[punct] = punct_id
            
            # Update cache
            with self._cache_lock:
                for punct, punct_id in punct_id_map.items():
                    self._punctuation_cache[punct] = punct_id
            
            conn.commit()
            
            # Clear batch
            with self._batch_lock:
                self._punctuation_batch.clear()
            
            return punct_id_map
            
        except Exception as e:
            conn.rollback()
            print(f"⚠️ Error flushing punctuation batch: {e}")
            return punct_id_map
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_batch_stats(self) -> Dict[str, int]:
        """Get batch statistics"""
        with self._batch_lock:
            return {'punctuation_in_batch': len(self._punctuation_batch)}
    
    def clear_cache(self):
        """Clear punctuation cache"""
        with self._cache_lock:
            self._punctuation_cache.clear()
