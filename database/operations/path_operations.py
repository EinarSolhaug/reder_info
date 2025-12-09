"""
Path Operations - Operations for paths table
Extracted from storage.py
"""

from typing import Dict, Any, Optional
from datetime import datetime, date


class PathOperations:
    """Operations for paths table"""
    
    def __init__(self, connection_manager):
        self.connection_manager = connection_manager
    
    def store_metadata(self, file_info: Dict[str, Any], hash_id: int, file_status: str = 'Unread') -> int:
        """
        Store file metadata and return path_id.
        
        Duplicate checking is done at hash level (hash + source + side) in hash_operations.
        Multiple files can have the same name or path as long as they have different hashes.
        
        Note: The database schema should NOT have UNIQUE constraints on file_name or file_path.
        If your database still has these constraints, run:
        ALTER TABLE paths DROP CONSTRAINT IF EXISTS paths_file_name_key;
        ALTER TABLE paths DROP CONSTRAINT IF EXISTS paths_file_path_key;
        
        Args:
            file_info: File information dict
            hash_id: Hash ID from hashs table
            file_status: 'Read' or 'Unread' (default: 'Unread' - will be updated after content check)
            
        Returns:
            path_id
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            
            # Extract metadata
            file_name = file_info.get('name', 'unknown')[:500]
            file_path = file_info.get('path', '')[:500]
            file_size = file_info.get('size_bytes', 0)
            file_type = file_info.get('type', 'FILE')[:100]
            file_date = datetime.fromisoformat(
                file_info.get('modified', datetime.now().isoformat())
            ).date()
            date_creation = date.today()
            
            # Ensure status is valid
            if file_status not in ('Read', 'Unread'):
                file_status = 'Unread'
            
            # Insert file metadata directly
            # Note: Duplicate checking is done at hash level (hash + source + side)
            # Multiple files can have the same name or path as long as they have different hashes
            cursor.execute(
                "INSERT INTO paths (file_name, file_path, file_size, file_type, "
                "file_status, file_date, date_creation, hash_id) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
                "RETURNING id",
                (file_name, file_path, file_size, file_type, file_status, 
                 file_date, date_creation, hash_id)
            )
            path_id = cursor.fetchone()[0]
            conn.commit()
            return path_id
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def update_file_status(self, path_id: int, status: str) -> bool:
        """
        Update file status in paths table.
        
        Args:
            path_id: Path ID
            status: 'Read' or 'Unread'
            
        Returns:
            True if updated successfully
        """
        if status not in ('Read', 'Unread'):
            return False
        
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE paths SET file_status = %s WHERE id = %s",
                (status, path_id)
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def is_file_processed(self, file_path: str) -> bool:
        """
        Check if file has already been processed.
        
        Args:
            file_path: File path to check
            
        Returns:
            True if file exists with status 'Read'
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id FROM paths WHERE file_path = %s AND file_status = 'Read'",
                (file_path,)
            )
            return cursor.fetchone() is not None
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_path_by_id(self, path_id: int) -> Optional[Dict[str, Any]]:
        """
        Get path information by ID.
        
        Args:
            path_id: Path ID
            
        Returns:
            Dict with path info or None
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT file_name, file_path, file_size, file_type, file_date, hash_id "
                "FROM paths WHERE id = %s",
                (path_id,)
            )
            result = cursor.fetchone()
            
            if result:
                return {
                    'file_name': result[0],
                    'file_path': result[1],
                    'file_size': result[2],
                    'file_type': result[3],
                    'file_date': result[4],
                    'hash_id': result[5]
                }
            return None
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_files_by_hash(self, hash_id: int) -> list:
        """
        Get all files with the same hash.
        
        Args:
            hash_id: Hash ID
            
        Returns:
            List of path dicts
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, file_name, file_path, file_size, file_type "
                "FROM paths WHERE hash_id = %s",
                (hash_id,)
            )
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    'id': row[0],
                    'file_name': row[1],
                    'file_path': row[2],
                    'file_size': row[3],
                    'file_type': row[4]
                })
            return results
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)