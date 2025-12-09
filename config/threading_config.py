# config/threading_config.py
from dataclasses import dataclass

@dataclass
class ThreadingConfig:
    # Thread pool settings
    max_workers: int = 4
    queue_size: int = 100
    
    # Monitoring settings
    enable_monitoring: bool = True
    monitor_interval: float = 5.0
    
    # Health thresholds
    max_cpu_percent: float = 80.0
    max_memory_mb: float = 500.0
    max_runtime_seconds: float = 3600.0
    
    # Timeout settings
    task_timeout: float = 300.0
    shutdown_timeout: float = 10.0
    
    # Circuit breaker
    failure_threshold: int = 5
    failure_window: int = 10
    
    # Cleanup
    cleanup_interval: float = 60.0
    stats_cache_ttl: float = 1.0

# Load from environment or file
def load_config() -> ThreadingConfig:
    import os
    return ThreadingConfig(
        max_workers=int(os.getenv('THREAD_MAX_WORKERS', 4)),
        enable_monitoring=os.getenv('THREAD_MONITORING', 'true').lower() == 'true',
        # ... etc
    )