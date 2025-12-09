"""
Async Management Module - Independent and reusable
Handles async task creation, communication, monitoring, priorities, and lifecycle
No dependencies on other project modules.
"""
import asyncio
import time
import traceback
from dataclasses import dataclass
from typing import Dict, List, Callable, Any, Optional, Coroutine
from enum import Enum
from datetime import datetime
import psutil
import os


class TaskPriority(Enum):
    CRITICAL = 1
    HIGH = 2
    NORMAL = 3
    LOW = 4


class TaskState(Enum):
    CREATED = "created"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"
    ERROR = "error"
    COMPLETED = "completed"


@dataclass
class TaskMetrics:
    task_id: str
    name: str
    state: TaskState
    priority: TaskPriority
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_msg: Optional[str] = None
    execution_count: int = 0
    runtime_seconds: float = 0.0


class ManagedTask:
    """Async task wrapper with control capabilities"""
    
    def __init__(self, task_id: str, name: str, coro: Coroutine,
                 priority=TaskPriority.NORMAL):
        self.task_id = task_id
        self.name = name
        self.coro = coro
        self.priority = priority
        
        # Control
        self.pause_event = asyncio.Event()
        self.stop_event = asyncio.Event()
        self.pause_event.set()
        
        # Communication
        self.inbox = asyncio.Queue()
        self.outbox = asyncio.Queue()
        
        # Metrics
        self.metrics = TaskMetrics(
            task_id=task_id,
            name=name,
            state=TaskState.CREATED,
            priority=priority,
            created_at=datetime.now()
        )
        
        self.task: Optional[asyncio.Task] = None
    
    async def _controlled_run(self):
        """Execute coroutine with controls"""
        try:
            self.metrics.state = TaskState.RUNNING
            self.metrics.started_at = datetime.now()
            
            await self.coro
            
            self.metrics.state = TaskState.COMPLETED
            self.metrics.execution_count += 1
            
        except asyncio.CancelledError:
            self.metrics.state = TaskState.STOPPED
        except Exception as e:
            self.metrics.state = TaskState.ERROR
            self.metrics.error_msg = str(e)
            traceback.print_exc()
        finally:
            self.metrics.completed_at = datetime.now()
            if self.metrics.started_at:
                self.metrics.runtime_seconds = (
                    self.metrics.completed_at - self.metrics.started_at
                ).total_seconds()
    
    async def check_pause(self):
        """Pause point - call in coroutine"""
        await self.pause_event.wait()
    
    def check_stop(self) -> bool:
        """Stop check - call in coroutine"""
        return self.stop_event.is_set()
    
    async def send_message(self, msg: Any):
        """Send message from task"""
        await self.outbox.put(msg)
    
    async def receive_message(self, timeout: float = 0.1) -> Optional[Any]:
        """Receive message in task"""
        try:
            return await asyncio.wait_for(self.inbox.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
    
    def start(self, loop: asyncio.AbstractEventLoop):
        """Start task"""
        self.task = loop.create_task(self._controlled_run())
    
    def pause(self):
        """Pause task"""
        self.metrics.state = TaskState.PAUSED
        self.pause_event.clear()
    
    def resume(self):
        """Resume task"""
        self.metrics.state = TaskState.RUNNING
        self.pause_event.set()
    
    def stop(self):
        """Stop task"""
        self.stop_event.set()
        self.pause_event.set()
        if self.task:
            self.task.cancel()
        self.metrics.state = TaskState.STOPPED
    
    def is_done(self) -> bool:
        """Check if task is done"""
        return self.task.done() if self.task else False


class AsyncManager:
    """Manages async tasks with full lifecycle control"""
    
    def __init__(self):
        self.tasks: Dict[str, ManagedTask] = {}
        self.next_id = 0
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.monitor_task: Optional[asyncio.Task] = None
        self.monitor_active = False
    
    def initialize(self):
        """Initialize event loop"""
        if self.loop is None:
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)
    
    # 1) LAUNCHING
    def create_task(self, name: str, coro: Coroutine,
                   priority=TaskPriority.NORMAL,
                   auto_start=True) -> str:
        """Create and optionally start an async task"""
        if self.loop is None:
            self.initialize()
        
        task_id = f"task_{self.next_id}"
        self.next_id += 1
        
        managed = ManagedTask(task_id, name, coro, priority)
        self.tasks[task_id] = managed
        
        if auto_start:
            managed.start(self.loop)
        
        print(f"[AsyncMgr] Created task: {task_id} ({name})")
        return task_id
    
    def start_task(self, task_id: str):
        """Start a created task"""
        if task_id in self.tasks and self.loop:
            self.tasks[task_id].start(self.loop)
    
    # 2) COMMUNICATION
    async def send_to_task(self, task_id: str, message: Any):
        """Send message to task"""
        if task_id in self.tasks:
            await self.tasks[task_id].inbox.put(message)
    
    async def receive_from_task(self, task_id: str, timeout: float = 0.1) -> Optional[Any]:
        """Receive message from task"""
        if task_id in self.tasks:
            try:
                return await asyncio.wait_for(
                    self.tasks[task_id].outbox.get(),
                    timeout=timeout
                )
            except asyncio.TimeoutError:
                return None
        return None
    
    async def broadcast(self, message: Any):
        """Broadcast message to all tasks"""
        for task in self.tasks.values():
            await task.inbox.put(message)
    
    # 3) STOPPING
    def pause_task(self, task_id: str):
        """Pause task"""
        if task_id in self.tasks:
            self.tasks[task_id].pause()
    
    def resume_task(self, task_id: str):
        """Resume task"""
        if task_id in self.tasks:
            self.tasks[task_id].resume()
    
    def stop_task(self, task_id: str):
        """Stop specific task"""
        if task_id in self.tasks:
            self.tasks[task_id].stop()
    
    def stop_all(self):
        """Stop all tasks"""
        for task in self.tasks.values():
            task.stop()
    
    # 4) ERROR MANAGEMENT
    def get_errors(self) -> List[TaskMetrics]:
        """Get all tasks with errors"""
        return [t.metrics for t in self.tasks.values()
                if t.metrics.state == TaskState.ERROR]
    
    def restart_task(self, task_id: str):
        """Restart a failed task - NOT IMPLEMENTED (coroutines are single-use)"""
        print(f"[AsyncMgr] Cannot restart task {task_id} - coroutines are single-use")
        # In production, you'd need to store the coroutine factory
    
    # 5) MONITORING
    async def start_monitoring(self, interval: float = 2.0):
        """Start task monitoring"""
        if self.monitor_active:
            return
        
        self.monitor_active = True
        self.monitor_task = asyncio.create_task(self._monitor_loop(interval))
    
    async def _monitor_loop(self, interval: float):
        """Monitor task health"""
        while self.monitor_active:
            for tid, task in list(self.tasks.items()):
                if task.metrics.state == TaskState.RUNNING and task.is_done():
                    if task.task and task.task.exception():
                        task.metrics.state = TaskState.ERROR
                        task.metrics.error_msg = str(task.task.exception())
                        print(f"[Monitor] Task {tid} failed: {task.metrics.error_msg}")
            
            await asyncio.sleep(interval)
    
    def stop_monitoring(self):
        """Stop monitoring"""
        self.monitor_active = False
        if self.monitor_task:
            self.monitor_task.cancel()
    
    # 6) PRIORITIES
    def get_by_priority(self, priority: TaskPriority) -> List[str]:
        """Get tasks by priority"""
        return [tid for tid, t in self.tasks.items()
                if t.priority == priority]
    
    def set_priority(self, task_id: str, priority: TaskPriority):
        """Change task priority"""
        if task_id in self.tasks:
            self.tasks[task_id].priority = priority
            self.tasks[task_id].metrics.priority = priority
    
    # 7) MEMORY MANAGEMENT
    def cleanup_completed(self):
        """Remove completed tasks"""
        to_remove = [tid for tid, t in self.tasks.items()
                    if t.metrics.state in (TaskState.COMPLETED, TaskState.STOPPED)
                    and t.is_done()]
        
        for tid in to_remove:
            del self.tasks[tid]
        
        if to_remove:
            print(f"[AsyncMgr] Cleaned up {len(to_remove)} tasks")
    
    def get_statistics(self) -> Dict:
        """Get task statistics"""
        stats = {
            "total": len(self.tasks),
            "running": sum(1 for t in self.tasks.values()
                          if t.metrics.state == TaskState.RUNNING),
            "paused": sum(1 for t in self.tasks.values()
                         if t.metrics.state == TaskState.PAUSED),
            "stopped": sum(1 for t in self.tasks.values()
                          if t.metrics.state == TaskState.STOPPED),
            "completed": sum(1 for t in self.tasks.values()
                            if t.metrics.state == TaskState.COMPLETED),
            "errors": sum(1 for t in self.tasks.values()
                         if t.metrics.state == TaskState.ERROR),
            "total_runtime": sum(t.metrics.runtime_seconds for t in self.tasks.values()),
            "by_priority": {}
        }
        
        for priority in TaskPriority:
            stats["by_priority"][priority.name] = sum(
                1 for t in self.tasks.values() if t.priority == priority
            )
        
        return stats
    
    def get_task_info(self, task_id: str) -> Optional[TaskMetrics]:
        """Get task metrics"""
        if task_id in self.tasks:
            return self.tasks[task_id].metrics
        return None
    
    def run_until_complete(self, coro: Coroutine):
        """Run coroutine until complete"""
        if self.loop:
            return self.loop.run_until_complete(coro)
    
    def shutdown(self):
        """Shutdown manager"""
        self.stop_monitoring()
        self.stop_all()
        
        if self.loop:
            pending = asyncio.all_tasks(self.loop)
            for task in pending:
                task.cancel()
            
            # Give tasks a chance to finish
            if pending:
                self.loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        
        print("[AsyncMgr] Shutdown complete")
