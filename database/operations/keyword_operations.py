"""
Keyword Operations - Operations for keywords and keywords_paths tables
"""
from typing import Dict, List
import pickle
import zlib
from psycopg2.extras import execute_batch

class KeywordOperations:
    def __init__(self, connection_manager):
        self.connection_manager = connection_manager
    
    def load_keywords_from_database(self) -> Dict[int, List[int]]:
        """Load all keywords and decompress"""
        conn = self.connection_manager.get_connection()
        keywords_dict = {}
        
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id, keyword FROM keywords")
            
            for keyword_id, keyword_bytes in cursor.fetchall():
                if keyword_bytes:
                    try:
                        decompressed = zlib.decompress(keyword_bytes)
                        word_ids = pickle.loads(decompressed)
                        if isinstance(word_ids, list):
                            keywords_dict[keyword_id] = word_ids
                    except:
                        continue
            
            return keywords_dict
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def store_keyword_frequencies(self, path_id: int, keyword_counts: Dict[int, int]):
        """Store keyword frequencies for a file"""
        if not keyword_counts:
            return
        
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            bulk_data = [(path_id, kid, count) for kid, count in keyword_counts.items()]
            
            execute_batch(
                cursor,
                "INSERT INTO keywords_paths (path_id, keyword_id, word_count) "
                "VALUES (%s, %s, %s) "
                "ON CONFLICT (path_id, keyword_id) DO UPDATE SET word_count = EXCLUDED.word_count",
                bulk_data,
                page_size=500
            )
            conn.commit()
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)