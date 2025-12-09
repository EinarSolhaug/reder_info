"""
Database Hub - Central access point for all database operations
Provides unified interface to all database components
"""

from typing import Optional, Dict, Any
from .connection_manager import ConnectionManager
from .transaction_manager import TransactionManager


class DatabaseHub:
    """
    Central hub for database operations.
    Provides lazy-initialized access to all database components.
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._connection_mgr: Optional[ConnectionManager] = None
        self._transaction_mgr: Optional[TransactionManager] = None
        
        # Operations managers (lazy-loaded)
        self._hash_ops = None
        self._path_ops = None
        self._content_ops = None
        self._word_ops = None
        self._keyword_ops = None
        self._title_ops = None
        self._source_ops = None
        self._side_ops = None
        
        # Processors (lazy-loaded)
        self._content_processor = None
        self._compression_processor = None
        self._validation_processor = None
        
        # Pipelines (lazy-loaded)
        self._storage_pipeline = None
        self._batch_pipeline = None
        
        # Utilities (lazy-loaded)
        self._cache_mgr = None
        self._checkpoint_mgr = None
        self._monitor = None
        
        self._config: Optional[Dict[str, Any]] = None
        self._initialized = True
    
    def initialize(
        self,
        db_config: Optional[Dict[str, Any]] = None,
        min_connections: int = 2,
        max_connections: int = 10
    ):
        """
        Initialize database hub with configuration.
        
        Args:
            db_config: Database configuration dict
            min_connections: Minimum connection pool size
            max_connections: Maximum connection pool size
        """
        if db_config is None:
            from ..utilities.config import get_default_config
            config_obj = get_default_config()
            if config_obj:
                db_config = config_obj.get_db_config()
            else:
                raise ValueError("No database configuration provided")
        
        self._config = db_config
        
        # Initialize connection manager
        self._connection_mgr = ConnectionManager(
            db_config=db_config,
            min_connections=min_connections,
            max_connections=max_connections
        )
        
        # Initialize transaction manager
        self._transaction_mgr = TransactionManager(self._connection_mgr)
        
        print("[DatabaseHub] Initialized")
    
    @property
    def connection_manager(self) -> ConnectionManager:
        """Get connection manager"""
        if not self._connection_mgr:
            self.initialize()
        return self._connection_mgr
    
    @property
    def transaction_manager(self) -> TransactionManager:
        """Get transaction manager"""
        if not self._transaction_mgr:
            self.initialize()
        return self._transaction_mgr
    
    @property
    def hash_operations(self):
        """Get hash operations (lazy)"""
        if not self._hash_ops:
            from ..operations.hash_operations import HashOperations
            self._hash_ops = HashOperations(self.connection_manager)
        return self._hash_ops
    
    @property
    def path_operations(self):
        """Get path operations (lazy)"""
        if not self._path_ops:
            from ..operations.path_operations import PathOperations
            self._path_ops = PathOperations(self.connection_manager)
        return self._path_ops
    
    @property
    def content_operations(self):
        """Get content operations (lazy)"""
        if not self._content_ops:
            from ..operations.content_operations import ContentOperations
            self._content_ops = ContentOperations(self.connection_manager)
        return self._content_ops
    
    @property
    def word_operations(self):
        """Get word operations (lazy)"""
        if not self._word_ops:
            from ..operations.word_operations import WordOperations
            self._word_ops = WordOperations(self.connection_manager)
        return self._word_ops
    
    @property
    def keyword_operations(self):
        """Get keyword operations (lazy)"""
        if not self._keyword_ops:
            from ..operations.keyword_operations import KeywordOperations
            self._keyword_ops = KeywordOperations(self.connection_manager)
        return self._keyword_ops
    
    @property
    def title_operations(self):
        """Get title operations (lazy)"""
        if not self._title_ops:
            from ..operations.title_operations import TitleOperations
            self._title_ops = TitleOperations(self.connection_manager)
        return self._title_ops
    
    @property
    def source_operations(self):
        """Get source operations (lazy)"""
        if not self._source_ops:
            from ..operations.source_operations import SourceOperations
            self._source_ops = SourceOperations(self.connection_manager)
        return self._source_ops
    
    @property
    def side_operations(self):
        """Get side operations (lazy)"""
        if not self._side_ops:
            from ..operations.side_operations import SideOperations
            self._side_ops = SideOperations(self.connection_manager)
        return self._side_ops
    
    @property
    def content_processor(self):
        """Get content processor (lazy)"""
        if not self._content_processor:
            from ..processors.content_processor import ContentProcessor
            self._content_processor = ContentProcessor()
        return self._content_processor
    
    @property
    def compression_processor(self):
        """Get compression processor (lazy)"""
        if not self._compression_processor:
            from ..processors.compression_processor import CompressionProcessor
            self._compression_processor = CompressionProcessor()
        return self._compression_processor
    
    @property
    def cache_manager(self):
        """Get cache manager (lazy)"""
        if not self._cache_mgr:
            from ..utilities.cache import CacheManager
            self._cache_mgr = CacheManager()
        return self._cache_mgr
    
    def shutdown(self):
        """Shutdown all database components"""
        print("[DatabaseHub] Shutting down...")
        
        if self._connection_mgr:
            self._connection_mgr.close_all()
        
        print("[DatabaseHub] Shutdown complete")


# Global instance
_hub_instance: Optional[DatabaseHub] = None


def get_database_hub() -> DatabaseHub:
    """Get or create global database hub"""
    global _hub_instance
    if _hub_instance is None:
        _hub_instance = DatabaseHub()
    return _hub_instance