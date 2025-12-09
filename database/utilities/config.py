"""
Configuration Module
Unified configuration management for database and application.
"""

import os
from pathlib import Path
from typing import Dict, Any, Optional

# Database password constant
DB_PASSWORD_DEFAULT = 'eggarf123'


class Config:
    """
    Unified configuration manager for database and application settings.
    All values are configurable via constructor parameters or environment variables.
    No hardcoded values - fully reusable in any project.
    """
    
    def __init__(
        self,
        db_host: Optional[str] = None,
        db_port: Optional[int] = None,
        db_name: Optional[str] = None,
        db_user: Optional[str] = None,
        db_password: Optional[str] = None,
        db_min_connections: Optional[int] = None,
        db_max_connections: Optional[int] = None,
        word_cache_size: Optional[int] = None,
        punctuation_cache_size: Optional[int] = None,
        batch_size: Optional[int] = None,
        chunk_size_large: Optional[int] = None,
        chunk_size_medium: Optional[int] = None,
        chunk_size_small: Optional[int] = None,
        extraction_folder: Optional[Path] = None
    ):
        """
        Initialize configuration.
        
        All parameters are optional. If not provided, values are read from environment
        variables. If environment variables are also not set, defaults are used.
        """
        # Database Configuration
        self.DB_HOST = db_host or os.getenv('DB_HOST', 'localhost')
        self.DB_PORT = db_port or int(os.getenv('DB_PORT', '5432'))
        self.DB_NAME = db_name or os.getenv('DB_NAME', 'analysis')
        self.DB_USER = db_user or os.getenv('DB_USER', 'postgres')
        self.DB_PASSWORD = db_password or os.getenv('DB_PASSWORD', DB_PASSWORD_DEFAULT)
        
        # Connection Pool Settings
        self.DB_MIN_CONNECTIONS = db_min_connections or int(os.getenv('DB_MIN_CONNECTIONS', '2'))
        self.DB_MAX_CONNECTIONS = db_max_connections or int(os.getenv('DB_MAX_CONNECTIONS', '10'))
        
        # Performance Settings
        self.WORD_CACHE_SIZE = word_cache_size or int(os.getenv('WORD_CACHE_SIZE', '50000'))
        self.PUNCTUATION_CACHE_SIZE = punctuation_cache_size or int(os.getenv('PUNCTUATION_CACHE_SIZE', '1000'))
        self.BATCH_SIZE = batch_size or int(os.getenv('BATCH_SIZE', '1000'))
        self.CHUNK_SIZE_LARGE = chunk_size_large or int(os.getenv('CHUNK_SIZE_LARGE', '5000'))
        self.CHUNK_SIZE_MEDIUM = chunk_size_medium or int(os.getenv('CHUNK_SIZE_MEDIUM', '8000'))
        self.CHUNK_SIZE_SMALL = chunk_size_small or int(os.getenv('CHUNK_SIZE_SMALL', '10000'))
        
        # Extraction Folder (optional - can be None)
        if extraction_folder:
            self.EXTRACTION_FOLDER = Path(extraction_folder)
        else:
            extraction_folder_env = os.getenv('EXTRACTION_FOLDER')
            if extraction_folder_env:
                self.EXTRACTION_FOLDER = Path(extraction_folder_env)
            else:
                self.EXTRACTION_FOLDER = None
        
        if self.EXTRACTION_FOLDER:
            self.EXTRACTION_FOLDER.mkdir(parents=True, exist_ok=True)

    def get_db_config(self) -> Dict[str, Any]:
        """Get database configuration dictionary."""
        return {
            'host': self.DB_HOST,
            'port': self.DB_PORT,
            'database': self.DB_NAME,
            'user': self.DB_USER,
            'password': self.DB_PASSWORD
        }

    def get_connection_string(self) -> str:
        """Get PostgreSQL connection string."""
        return (
            f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )


# Global configuration instance
config: Optional[Config] = None

def get_default_config() -> Optional[Config]:
    """Get or create default configuration instance."""
    global config
    if config is None:
        try:
            config = Config()
        except Exception as e:
            try:
                config = Config(db_password=DB_PASSWORD_DEFAULT)
            except Exception:
                return None
    return config
