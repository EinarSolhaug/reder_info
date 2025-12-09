"""
Hash Operations - Operations for hashs table
Extracted from storage.py
"""

from typing import Optional, Tuple


class HashOperations:
    """Operations for hashs table"""
    
    def __init__(self, connection_manager):
        self.connection_manager = connection_manager
    
    def store_hash(self, file_hash: str, source_id: int, side_id: int) -> int:
        """
        Store file hash and return hash_id.
        
        Duplicate checking: Only if hash + source_id + side_id are ALL the same.
        If any one is different, it's a new entry.
        
        Args:
            file_hash: SHA256 hash of file
            source_id: Source ID
            side_id: Side ID
            
        Returns:
            hash_id
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            # Check if hash + source + side combination already exists
            cursor.execute(
                "SELECT id FROM hashs WHERE hash = %s AND source_id = %s AND side_id = %s",
                (file_hash, source_id, side_id)
            )
            result = cursor.fetchone()
            
            if result:
                # Already exists with same hash + source + side
                return result[0]
            
            # Insert new hash with source and side
            # ON CONFLICT handles the case where hash + source + side already exists
            cursor.execute(
                "INSERT INTO hashs (hash, side_id, source_id) VALUES (%s, %s, %s) "
                "ON CONFLICT (hash, source_id, side_id) DO NOTHING "
                "RETURNING id",
                (file_hash, side_id, source_id)
            )
            result = cursor.fetchone()
            
            if result:
                # New entry was inserted
                hash_id = result[0]
            else:
                # Conflict occurred, get existing id
                cursor.execute(
                    "SELECT id FROM hashs WHERE hash = %s AND source_id = %s AND side_id = %s",
                    (file_hash, source_id, side_id)
                )
                hash_id = cursor.fetchone()[0]
            
            conn.commit()
            return hash_id
            
        finally:
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
        
        Logic: File is duplicate ONLY if hash + source_id + side_id are ALL the same.
        If any one is different, it's NOT a duplicate and should be stored.
        
        Args:
            file_hash: File hash
            source_id: Source ID
            side_id: Side ID
            
        Returns:
            (is_duplicate, existing_path_id or hash_id)
            - If duplicate: returns (True, path_id) if path exists, otherwise (True, hash_id)
            - If not duplicate: returns (False, None)
        """
        if not file_hash or file_hash in ('N/A', 'SKIPPED_LARGE_FILE', 'ERROR'):
            return False, None
        
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            # Check if hash + source + side combination exists
            # Logic: Duplicate ONLY if hash + source_id + side_id are ALL the same
            # If any one is different, it's NOT a duplicate
            
            # First check if hash + source + side exists in hashs table
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
            
            # Hash + source + side exists, now find the associated path_id if any
            hash_id = hash_result[0]
            cursor.execute("""
                SELECT p.id
                FROM paths p
                WHERE p.hash_id = %s
                ORDER BY p.id DESC
                LIMIT 1
            """, (hash_id,))
            path_result = cursor.fetchone()
            
            if path_result:
                # Found existing path - return it as duplicate
                return True, path_result[0]
            else:
                # Hash exists but no path yet - still consider it duplicate
                # Return hash_id as identifier
                return True, hash_id
            
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