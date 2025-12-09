"""
Database Managers Module
Handles connection management, transactions, and central coordination.
"""

try:
    from .connection_manager import ConnectionManager
    CONNECTION_MANAGER_AVAILABLE = True
except ImportError:
    CONNECTION_MANAGER_AVAILABLE = False
    ConnectionManager = None

try:
    from .transaction_manager import TransactionManager
    TRANSACTION_MANAGER_AVAILABLE = True
except ImportError:
    TRANSACTION_MANAGER_AVAILABLE = False
    TransactionManager = None

try:
    from .hub import Hub, get_hub
    HUB_AVAILABLE = True
except ImportError:
    HUB_AVAILABLE = False
    Hub = None
    get_hub = None


__all__ = [
    'ConnectionManager',
    'CONNECTION_MANAGER_AVAILABLE',
    'TransactionManager',
    'TRANSACTION_MANAGER_AVAILABLE',
    'Hub',
    'get_hub',
    'HUB_AVAILABLE',
]
