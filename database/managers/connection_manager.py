"""
Connection Manager - Database connection pooling and management
Extracted from original storage.py
"""

import psycopg2
from psycopg2 import pool, OperationalError
from typing import Dict, Any, Optional
import threading


class ConnectionManager:
    """
    Manages database connection pooling
    Thread-safe connection management
    """
    
    def __init__(
        self,
        db_config: Dict[str, Any],
        min_connections: int = 2,
        max_connections: int = 10
    ):
        """
        Initialize connection manager.
        
        Args:
            db_config: Database configuration dict (host, port, database, user, password)
            min_connections: Minimum pool size
            max_connections: Maximum pool size
        """
        self.db_config = db_config
        self.min_connections = min_connections
        self.max_connections = max_connections
        
        self.connection_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None
        self._lock = threading.RLock()
        
        self._init_connection_pool()
    
    def _init_connection_pool(self):
        """Initialize connection pool"""
        try:
            self.connection_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=self.min_connections,
                maxconn=self.max_connections,
                **self.db_config
            )
        except Exception as e:
            raise ConnectionError(f"Failed to create connection pool: {e}")
    
    def get_connection(self):
        """
        Get connection from pool.
        Thread-safe.
        
        Returns:
            Database connection
        """
        with self._lock:
            if not self.connection_pool:
                self._init_connection_pool()
            return self.connection_pool.getconn()
    
    def return_connection(self, conn):
        """
        Return connection to pool.
        
        Args:
            conn: Connection to return
        """
        with self._lock:
            if self.connection_pool:
                self.connection_pool.putconn(conn)
    
    def close_all(self):
        """Close all connections in pool"""
        with self._lock:
            if self.connection_pool:
                self.connection_pool.closeall()
                self.connection_pool = None
    
    def get_stats(self) -> Dict[str, int]:
        """
        Get connection pool statistics.
        
        Returns:
            Dict with pool stats
        """
        # Note: ThreadedConnectionPool doesn't expose internal stats
        # This is a basic implementation
        return {
            'min_connections': self.min_connections,
            'max_connections': self.max_connections,
            'initialized': self.connection_pool is not None
        }