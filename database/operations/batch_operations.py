"""
Batch Operations Module
Provides batch operation support for efficient bulk database operations.
"""

from typing import Dict, List, Tuple, Optional
from datetime import date
import threading
from psycopg2.extras import execute_batch


class BatchPathOperations:
    """Batch operations for paths table"""
    
    def __init__(self, connection_manager, batch_size: int = 500):
        self.connection_manager = connection_manager
        self.batch_size = batch_size
        self._path_batch: List[Tuple] = []
        self._batch_lock = threading.RLock()
    
    def add_path_to_batch(
        self,
        file_name: str,
        file_path: str,
        file_size: int,
        file_type: str,
        file_date: date,
        hash_id: int,
        file_status: str = 'Unread'
    ):
        """Add path to batch buffer"""
        # Ensure status is valid
        if file_status not in ('Read', 'Unread'):
            file_status = 'Unread'
        
        with self._batch_lock:
            self._path_batch.append((
                file_name[:500],
                file_path[:500],
                file_size,
                file_type[:100],
                file_status,
                file_date,
                date.today(),
                hash_id
            ))
    
    def flush_path_batch(self) -> Dict[str, int]:
        """
        Flush path batch to database.
        Returns: {file_path: path_id} mapping
        """
        if not self._path_batch:
            return {}
        
        conn = self.connection_manager.get_connection()
        path_id_map = {}
        
        try:
            cursor = conn.cursor()
            
            # Bulk insert paths (one by one to get IDs)
            for path_tuple in self._path_batch:
                file_name, file_path, file_size, file_type, file_status, file_date, date_creation, hash_id = path_tuple
                cursor.execute(
                    """INSERT INTO paths (file_name, file_path, file_size, file_type, 
                        file_status, file_date, date_creation, hash_id)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (file_path) DO UPDATE SET
                        file_name = EXCLUDED.file_name, file_size = EXCLUDED.file_size,
                        file_type = EXCLUDED.file_type, file_date = EXCLUDED.file_date,
                        file_status = EXCLUDED.file_status
                        RETURNING id, file_path""",
                    (file_name, file_path, file_size, file_type, file_status, file_date, date_creation, hash_id)
                )
                result = cursor.fetchone()
                if result:
                    path_id, ret_file_path = result
                    path_id_map[ret_file_path] = path_id
            
            conn.commit()
            
            # Clear batch
            with self._batch_lock:
                self._path_batch.clear()
            
            return path_id_map
            
        except Exception as e:
            conn.rollback()
            print(f"⚠️ Error flushing path batch: {e}")
            return path_id_map
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_batch_stats(self) -> Dict[str, int]:
        """Get path batch statistics"""
        with self._batch_lock:
            return {'paths_in_batch': len(self._path_batch)}


class BatchHashOperations:
    """Batch operations for hashs table"""
    
    def __init__(self, connection_manager, batch_size: int = 500):
        self.connection_manager = connection_manager
        self.batch_size = batch_size
        self._hash_batch: List[Tuple] = []
        self._batch_lock = threading.RLock()
    
    def add_hash_to_batch(self, file_hash: str, source_id: int, side_id: int):
        """Add hash to batch buffer"""
        with self._batch_lock:
            self._hash_batch.append((file_hash, side_id, source_id))
    
    def flush_hash_batch(self) -> Dict[Tuple[str, int, int], int]:
        """
        Flush hash batch to database.
        Returns: {(hash, source_id, side_id): hash_id} mapping
        """
        if not self._hash_batch:
            return {}
        
        conn = self.connection_manager.get_connection()
        hash_id_map = {}
        
        try:
            cursor = conn.cursor()
            
            # Bulk insert hashes (one by one to get IDs)
            for hash_tuple in self._hash_batch:
                file_hash, side_id, source_id = hash_tuple
                cursor.execute(
                    """INSERT INTO hashs (hash, side_id, source_id)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (hash, source_id) DO UPDATE SET side_id = EXCLUDED.side_id
                        RETURNING id, hash, source_id, side_id""",
                    (file_hash, side_id, source_id)
                )
                result = cursor.fetchone()
                if result:
                    hash_id, ret_hash, ret_source_id, ret_side_id = result
                    hash_id_map[(ret_hash, ret_source_id, ret_side_id)] = hash_id
            
            conn.commit()
            
            # Clear batch
            with self._batch_lock:
                self._hash_batch.clear()
            
            return hash_id_map
            
        except Exception as e:
            conn.rollback()
            print(f"⚠️ Error flushing hash batch: {e}")
            return hash_id_map
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_batch_stats(self) -> Dict[str, int]:
        """Get hash batch statistics"""
        with self._batch_lock:
            return {'hashes_in_batch': len(self._hash_batch)}


class BatchWordPathOperations:
    """Batch operations for words_paths relationships"""
    
    def __init__(self, connection_manager, batch_size: int = 500):
        self.connection_manager = connection_manager
        self.batch_size = batch_size
        self._word_path_batch: List[Tuple] = []
        self._batch_lock = threading.RLock()
    
    def add_word_path_to_batch(self, path_id: int, word_id: int, word_count: int):
        """Add word-path relationship to batch buffer"""
        with self._batch_lock:
            self._word_path_batch.append((path_id, word_id, word_count))
    
    def flush_word_path_batch(self):
        """Flush word-path relationship batch to database"""
        if not self._word_path_batch:
            return
        
        conn = self.connection_manager.get_connection()
        
        try:
            cursor = conn.cursor()
            
            # Bulk insert word-path relationships
            execute_batch(
                cursor,
                """INSERT INTO words_paths (path_id, word_id, word_count)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (path_id, word_id) DO UPDATE SET word_count = EXCLUDED.word_count""",
                self._word_path_batch,
                page_size=self.batch_size
            )
            
            conn.commit()
            
            # Clear batch
            with self._batch_lock:
                self._word_path_batch.clear()
            
        except Exception as e:
            conn.rollback()
            print(f"⚠️ Error flushing word-path batch: {e}")
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_batch_stats(self) -> Dict[str, int]:
        """Get word-path batch statistics"""
        with self._batch_lock:
            return {'word_paths_in_batch': len(self._word_path_batch)}


class BatchKeywordPathOperations:
    """Batch operations for keywords_paths relationships"""
    
    def __init__(self, connection_manager, batch_size: int = 500):
        self.connection_manager = connection_manager
        self.batch_size = batch_size
        self._keyword_path_batch: List[Tuple] = []
        self._batch_lock = threading.RLock()
    
    def add_keyword_path_to_batch(self, path_id: int, keyword_id: int, word_count: int):
        """Add keyword-path relationship to batch buffer"""
        with self._batch_lock:
            self._keyword_path_batch.append((path_id, keyword_id, word_count))
    
    def flush_keyword_path_batch(self):
        """Flush keyword-path relationship batch to database"""
        if not self._keyword_path_batch:
            return
        
        conn = self.connection_manager.get_connection()
        
        try:
            cursor = conn.cursor()
            
            # Bulk insert keyword-path relationships
            execute_batch(
                cursor,
                """INSERT INTO keywords_paths (path_id, keyword_id, word_count)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (path_id, keyword_id) DO UPDATE SET word_count = EXCLUDED.word_count""",
                self._keyword_path_batch,
                page_size=self.batch_size
            )
            
            conn.commit()
            
            # Clear batch
            with self._batch_lock:
                self._keyword_path_batch.clear()
            
        except Exception as e:
            conn.rollback()
            print(f"⚠️ Error flushing keyword-path batch: {e}")
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_batch_stats(self) -> Dict[str, int]:
        """Get keyword-path batch statistics"""
        with self._batch_lock:
            return {'keyword_paths_in_batch': len(self._keyword_path_batch)}
