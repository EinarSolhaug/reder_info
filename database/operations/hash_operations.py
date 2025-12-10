"""
Hash Operations - Fixed version without ON CONFLICT issues
"""

from typing import Optional, Tuple


class HashOperations:
    """Operations for hashs table"""
    
    def __init__(self, connection_manager):
        self.connection_manager = connection_manager
    
    def store_hash(self, file_hash: str, source_id: int, side_id: int) -> int:
        """
        Store file hash with explicit checking (no ON CONFLICT)
        
        This approach avoids the PostgreSQL "no unique constraint matching" error
        by explicitly checking for existence before inserting.
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            
            # Start transaction
            conn.autocommit = False
            
            try:
                # First, check if hash + source + side combination already exists
                cursor.execute(
                    "SELECT id FROM hashs WHERE hash = %s AND source_id = %s AND side_id = %s",
                    (file_hash, source_id, side_id)
                )
                result = cursor.fetchone()
                
                if result:
                    # Already exists, return existing ID
                    conn.commit()
                    return result[0]
                
                # Doesn't exist, insert new hash
                cursor.execute(
                    """INSERT INTO hashs (hash, side_id, source_id) 
                    VALUES (%s, %s, %s) 
                    RETURNING id""",
                    (file_hash, side_id, source_id)
                )
                result = cursor.fetchone()
                
                if result:
                    hash_id = result[0]
                    conn.commit()
                    return hash_id
                else:
                    # Should not happen, but handle gracefully
                    conn.rollback()
                    raise Exception("Insert returned no ID")
                    
            except Exception as e:
                conn.rollback()
                # If insert failed due to race condition, try to get existing ID
                try:
                    cursor.execute(
                        "SELECT id FROM hashs WHERE hash = %s AND source_id = %s AND side_id = %s",
                        (file_hash, source_id, side_id)
                    )
                    result = cursor.fetchone()
                    if result:
                        return result[0]
                except:
                    pass
                raise
                
        finally:
            conn.autocommit = True  # Restore autocommit
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    # In hash_operations.py, line ~45-80
    def check_duplicate(
        self,
        file_hash: str,
        source_id: int,
        side_id: int
    ) -> Tuple[bool, Optional[int]]:
        """
        UPDATED: Check if file is duplicate with enhanced logging
        
        Returns:
            (is_duplicate, existing_path_id or None)
        """
        if not file_hash or file_hash in ('N/A', 'SKIPPED_LARGE_FILE', 'ERROR'):
            return False, None
        
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            
            # Step 1: Check if hash + source + side exists
            cursor.execute("""
                SELECT h.id
                FROM hashs h
                WHERE h.hash = %s AND h.source_id = %s AND h.side_id = %s
                LIMIT 1
            """, (file_hash, source_id, side_id))
            hash_result = cursor.fetchone()
            
            if not hash_result:
                return False, None
            
            hash_id = hash_result[0]
            
            # Step 2: Check if any path exists for this hash
            cursor.execute("""
                SELECT p.id, p.file_path, p.file_name
                FROM paths p
                WHERE p.hash_id = %s
                ORDER BY p.id DESC
                LIMIT 1
            """, (hash_id,))
            path_result = cursor.fetchone()
            
            if path_result:
                path_id, file_path, file_name = path_result
                # ADD LOGGING for duplicate detection
                import logging
                logger = logging.getLogger(__name__)
                logger.info(f"Duplicate detected: hash={file_hash[:16]}..., "
                        f"existing_path={file_path}, path_id={path_id}")
                return True, path_id
            else:
                # Orphaned hash - log this unusual case
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Orphaned hash detected: hash={file_hash[:16]}..., "
                            f"hash_id={hash_id}, no paths found")
                return False, None
                
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
        
        
    def get_hash_by_id(self, hash_id: int) -> Optional[str]:
        """
        Get hash string by ID.
        
        Args:
            hash_id: Hash ID
            
        Returns:
            Hash string or None
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT hash FROM hashs WHERE id = %s", (hash_id,))
            result = cursor.fetchone()
            return result[0] if result else None
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)