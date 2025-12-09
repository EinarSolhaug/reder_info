"""
Title Operations - Operations for titles_content table
"""
from typing import Optional, List
import pickle
import zlib
from datetime import date

class TitleOperations:
    def __init__(self, connection_manager):
        self.connection_manager = connection_manager
    
    def store_title(self, word_ids: List[int], path_id: int, 
                   parent_path_id: Optional[int] = None):
        """Store title as compressed word IDs"""
        if not word_ids:
            return
        
        # Serialize and compress
        pickled = pickle.dumps(word_ids, protocol=4)
        compressed = zlib.compress(pickled)
        
        # Determine title status
        title_status = 'Branch' if parent_path_id else 'Main'
        
        # Get parent title_content_id if exists
        title_content_id = None
        if parent_path_id:
            conn = self.connection_manager.get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT id FROM titles_content WHERE path_id = %s LIMIT 1",
                    (parent_path_id,)
                )
                result = cursor.fetchone()
                if result:
                    title_content_id = result[0]
            finally:
                cursor.close()
                self.connection_manager.return_connection(conn)
        
        # Store title
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO titles_content (title_data, title_status, title_content_id, path_id) "
                "VALUES (%s, %s, %s, %s)",
                (compressed, title_status, title_content_id, path_id)
            )
            conn.commit()
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def retrieve_title(self, path_id: int) -> Optional[List[int]]:
        """Retrieve and decompress title word IDs"""
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT title_data FROM titles_content WHERE path_id = %s",
                (path_id,)
            )
            result = cursor.fetchone()
            
            if result and result[0]:
                decompressed = zlib.decompress(result[0])
                return pickle.loads(decompressed)
            return None
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)