"""
Cache Manager - In-memory caching for frequently accessed data
Refactored from storage.py caching logic
"""
import threading
from typing import Dict, Any

class CacheManager:
    def __init__(self, max_size: int = 50000):
        self.max_size = max_size
        self._cache: Dict[str, Any] = {}
        self._lock = threading.RLock()
    
    def get(self, key: str) -> Any:
        with self._lock:
            return self._cache.get(key)
    
    def set(self, key: str, value: Any):
        with self._lock:
            if len(self._cache) < self.max_size:
                self._cache[key] = value
    
    def clear(self):
        with self._lock:
            self._cache.clear()
    
    def get_stats(self) -> Dict[str, int]:
        with self._lock:
            return {
                'cached_items': len(self._cache),
                'max_size': self.max_size
            }