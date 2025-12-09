"""
Transaction Manager - Database transaction handling
Provides context manager for automatic commit/rollback
"""

from typing import Optional
from contextlib import contextmanager
import psycopg2


class TransactionManager:
    """
    Manages database transactions.
    Provides context manager for safe transaction handling.
    """
    
    def __init__(self, connection_manager):
        """
        Initialize transaction manager.
        
        Args:
            connection_manager: ConnectionManager instance
        """
        self.connection_manager = connection_manager
    
    @contextmanager
    def transaction(self, isolation_level: Optional[str] = None):
        """
        Context manager for database transactions.
        Automatically commits on success, rolls back on exception.
        
        Args:
            isolation_level: Transaction isolation level (optional)
            
        Yields:
            Database connection
            
        Example:
            with transaction_mgr.transaction() as conn:
                cursor = conn.cursor()
                cursor.execute("INSERT INTO ...")
                # Auto-commit on success, rollback on exception
        """
        conn = self.connection_manager.get_connection()
        
        try:
            if isolation_level:
                conn.set_isolation_level(isolation_level)
            
            yield conn
            conn.commit()
            
        except Exception as e:
            conn.rollback()
            raise
            
        finally:
            self.connection_manager.return_connection(conn)
    
    def execute_in_transaction(self, func, *args, **kwargs):
        """
        Execute a function within a transaction.
        
        Args:
            func: Function to execute (receives connection as first arg)
            *args: Additional arguments for function
            **kwargs: Keyword arguments for function
            
        Returns:
            Result from function
        """
        with self.transaction() as conn:
            return func(conn, *args, **kwargs)