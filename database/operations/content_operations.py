"""
Content Operations - Operations for contents table
Extracted from storage.py
"""

from typing import List, Tuple
from datetime import date
import pickle
import zlib


class ContentOperations:
    """Operations for contents table"""
    
    def __init__(self, connection_manager):
        self.connection_manager = connection_manager
    
    def store_content_chunks(
        self,
        token_tuples: List[Tuple[int, int, int, int]],
        path_id: int,
        chunk_size: int = 100000
    ):
        """
        Store compressed content chunks.
        
        Args:
            token_tuples: List of (word_id, punct_before_id, punct_after_id, spacing_id)
            path_id: Path ID
            chunk_size: Size of each chunk
        """
        # Chunk tokens based on size
        if len(token_tuples) < 1000000:
            chunk_size = 100000
        else:
            chunk_size = 5000
        
        chunks = [
            token_tuples[i:i+chunk_size] 
            for i in range(0, len(token_tuples), chunk_size)
        ]
        
        # Store chunks
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            
            for chunk in chunks:
                # Serialize and compress (70-90% space savings)
                pickled = pickle.dumps(chunk, protocol=4)
                compressed = zlib.compress(pickled)
                
                cursor.execute(
                    "INSERT INTO contents (content_data, content_date, path_id) "
                    "VALUES (%s, %s, %s)",
                    (compressed, date.today(), path_id)
                )
            
            conn.commit()
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def retrieve_content(self, path_id: int) -> List[Tuple[int, int, int, int]]:
        """
        Retrieve and decompress content chunks for a file.
        
        Args:
            path_id: Path ID
            
        Returns:
            List of token tuples
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT content_data FROM contents WHERE path_id = %s ORDER BY id",
                (path_id,)
            )
            
            all_tokens = []
            for (compressed_data,) in cursor.fetchall():
                if compressed_data:
                    # Decompress and unpickle
                    decompressed = zlib.decompress(compressed_data)
                    tokens = pickle.loads(decompressed)
                    all_tokens.extend(tokens)
            
            return all_tokens
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def get_content_stats(self, path_id: int) -> dict:
        """
        Get statistics about stored content.
        
        Args:
            path_id: Path ID
            
        Returns:
            Dict with content stats
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    COUNT(*) as chunk_count,
                    SUM(LENGTH(content_data)) as total_bytes
                FROM contents 
                WHERE path_id = %s
            """, (path_id,))
            
            result = cursor.fetchone()
            return {
                'chunk_count': result[0] or 0,
                'total_compressed_bytes': result[1] or 0
            }
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def delete_content(self, path_id: int):
        """
        Delete all content for a file.
        
        Args:
            path_id: Path ID
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM contents WHERE path_id = %s", (path_id,))
            conn.commit()
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)