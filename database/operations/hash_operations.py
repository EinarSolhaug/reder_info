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
    
    def check_duplicate(
        self,
        file_hash: str,
        source_id: int,
        side_id: int
    ) -> Tuple[bool, Optional[int]]:
        """
        Check if file is duplicate.
        
        Logic: File is duplicate ONLY if:
        1. Hash + source_id + side_id combination exists in hashs table, AND
        2. At least one path exists for that hash
        
        If hash exists but no path exists, it's NOT a duplicate - it's an orphaned hash
        that should be reused for the new file.
        
        Args:
            file_hash: File hash
            source_id: Source ID
            side_id: Side ID
            
        Returns:
            (is_duplicate, existing_path_id or None)
            - If true duplicate with existing path: (True, path_id)
            - If not duplicate: (False, None)
            - If orphaned hash (no path): (False, None)
        """
        if not file_hash or file_hash in ('N/A', 'SKIPPED_LARGE_FILE', 'ERROR'):
            return False, None
        
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            
            # Step 1: Check if hash + source + side combination exists
            cursor.execute("""
                SELECT h.id
                FROM hashs h
                WHERE h.hash = %s AND h.source_id = %s AND h.side_id = %s
                LIMIT 1
            """, (file_hash, source_id, side_id))
            hash_result = cursor.fetchone()
            
            if not hash_result:
                # Hash + source + side combination doesn't exist - NOT a duplicate
                return False, None
            
            hash_id = hash_result[0]
            
            # Step 2: Check if any path exists for this hash
            cursor.execute("""
                SELECT p.id
                FROM paths p
                WHERE p.hash_id = %s
                ORDER BY p.id DESC
                LIMIT 1
            """, (hash_id,))
            path_result = cursor.fetchone()
            
            if path_result:
                # Hash exists AND path exists - TRUE DUPLICATE
                path_id = path_result[0]
                return True, path_id
            else:
                # Hash exists but NO path exists - ORPHANED HASH
                # This is NOT a duplicate - the file should be stored
                # The orphaned hash can be reused
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