"""
Side Operations Module
Handles side creation and retrieval.
"""

from typing import Dict, Any, Optional, List
from datetime import date

class SideOperations:
    """Operations for sides table"""
    
    def __init__(self, connection_manager):
        self.connection_manager = connection_manager
    
    def get_or_create_side(self, side_name: str, importance: float = 0.5) -> int:
        """
        Get or create side ID.
        
        Args:
            side_name: Side name
            importance: Importance value (0.0-1.0)
            
        Returns:
            side_id
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM sides WHERE name = %s", (side_name,))
            result = cursor.fetchone()
            
            if result:
                return result[0]
            
            # Insert new side
            cursor.execute(
                "INSERT INTO sides (name, importance, date_creation) "
                "VALUES (%s, %s, %s) RETURNING id",
                (side_name, importance, date.today())
            )
            side_id = cursor.fetchone()[0]
            conn.commit()
            return side_id
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)
    
    def list_sides(self, search_term: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """
        List all sides, optionally filtered.
        
        Args:
            search_term: Optional search term
            limit: Maximum results
            
        Returns:
            List of side dicts
        """
        conn = self.connection_manager.get_connection()
        try:
            cursor = conn.cursor()
            
            if search_term:
                search_pattern = f"%{search_term}%"
                cursor.execute("""
                    SELECT id, name, importance, date_creation 
                    FROM sides 
                    WHERE name ILIKE %s
                    ORDER BY name
                    LIMIT %s
                """, (search_pattern, limit))
            else:
                cursor.execute("""
                    SELECT id, name, importance, date_creation 
                    FROM sides 
                    ORDER BY name
                    LIMIT %s
                """, (limit,))
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    'id': row[0],
                    'name': row[1],
                    'importance': float(row[2]) if row[2] else 0.5,
                    'date_creation': row[3].isoformat() if row[3] else None
                })
            
            return results
            
        finally:
            cursor.close()
            self.connection_manager.return_connection(conn)