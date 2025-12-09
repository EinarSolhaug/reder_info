"""
Source and Side Operations - Operations for sources and sides tables
Extracted from storage.py
"""

from typing import Dict, Any, List, Optional
from datetime import date


class SourceOperations:
    """Operations for sources table"""
    
    def __init__(self, connection_manager):
        self.connection_manager = connection_manager
    
    def get_or_create_source(self, source_name: str, **kwargs) -> int:
        """
        Get or create source ID.
        
        Args:
            source_name: Source name
            **kwargs: Additional source fields (job, country, importance, etc.)
            
        Returns:
            source_id
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM sources WHERE name = %s", (source_name,))
            result = cursor.fetchone()
            
            if result:
                return result[0]
            
            # Insert new source
            defaults = {
                'job': '',
                'importance': 0.5,
                'country': '',
                'date_creation': date.today()
            }
            defaults.update(kwargs)
            
            cursor.execute(
                "INSERT INTO sources (name, job, importance, country, date_creation) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (source_name, defaults['job'], defaults['importance'], 
                 defaults['country'], defaults['date_creation'])
            )
            source_id = cursor.fetchone()[0]
            conn.commit()
            return source_id
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def list_sources(self, search_term: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """
        List all sources, optionally filtered.
        
        Args:
            search_term: Optional search term
            limit: Maximum results
            
        Returns:
            List of source dicts
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            
            if search_term:
                search_pattern = f"%{search_term}%"
                cursor.execute("""
                    SELECT id, name, country, job, importance, date_creation 
                    FROM sources 
                    WHERE name ILIKE %s OR country ILIKE %s OR job ILIKE %s
                    ORDER BY name
                    LIMIT %s
                """, (search_pattern, search_pattern, search_pattern, limit))
            else:
                cursor.execute("""
                    SELECT id, name, country, job, importance, date_creation 
                    FROM sources 
                    ORDER BY name
                    LIMIT %s
                """, (limit,))
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    'id': row[0],
                    'name': row[1],
                    'country': row[2] or '',
                    'job': row[3] or '',
                    'importance': float(row[4]) if row[4] else 0.5,
                    'date_creation': row[5].isoformat() if row[5] else None
                })
            
            return results
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)


