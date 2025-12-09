"""
Checkpoint Manager Module
Enables resuming interrupted file processing operations.
"""

import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Set
from datetime import datetime
import threading


class CheckpointManager:
    """
    Checkpoint manager for resuming operations.
    Tracks processed files and allows resuming from last checkpoint.
    """
    
    def __init__(self, checkpoint_dir: Optional[Path] = None):
        """
        Initialize checkpoint manager.
        
        Args:
            checkpoint_dir: Directory for checkpoint files.
                           If None, uses CHECKPOINT_DIR environment variable
        """
        if checkpoint_dir is None:
            import os
            checkpoint_dir_env = os.getenv('CHECKPOINT_DIR')
            if checkpoint_dir_env:
                checkpoint_dir = Path(checkpoint_dir_env)
            else:
                checkpoint_dir = Path.cwd() / ".checkpoints"
        
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        
        self.lock = threading.RLock()
        self.current_checkpoint: Optional[str] = None
    
    def create_checkpoint(self, checkpoint_id: str, 
                         processed_files: List[str],
                         total_files: int,
                         metadata: Optional[Dict[str, Any]] = None) -> bool:
        """
        Create a checkpoint.
        
        Args:
            checkpoint_id: Unique identifier for this checkpoint
            processed_files: List of file paths that have been processed
            total_files: Total number of files to process
            metadata: Optional additional metadata
            
        Returns:
            True if successful
        """
        checkpoint_data = {
            'checkpoint_id': checkpoint_id,
            'created_at': datetime.now().isoformat(),
            'processed_files': processed_files,
            'total_files': total_files,
            'progress': len(processed_files) / total_files if total_files > 0 else 0.0,
            'metadata': metadata or {}
        }
        
        checkpoint_file = self.checkpoint_dir / f"{checkpoint_id}.json"
        
        try:
            with self.lock:
                with open(checkpoint_file, 'w', encoding='utf-8') as f:
                    json.dump(checkpoint_data, f, indent=2, default=str)
                
                self.current_checkpoint = checkpoint_id
                return True
        except Exception as e:
            print(f"Error creating checkpoint: {e}")
            return False
    
    def load_checkpoint(self, checkpoint_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a checkpoint.
        
        Args:
            checkpoint_id: Checkpoint identifier
            
        Returns:
            Checkpoint data dict or None if not found
        """
        checkpoint_file = self.checkpoint_dir / f"{checkpoint_id}.json"
        
        if not checkpoint_file.exists():
            return None
        
        try:
            with open(checkpoint_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return None
    
    def get_latest_checkpoint(self) -> Optional[Dict[str, Any]]:
        """Get the most recent checkpoint"""
        checkpoints = list(self.checkpoint_dir.glob("*.json"))
        
        if not checkpoints:
            return None
        
        checkpoints.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        latest_file = checkpoints[0]
        checkpoint_id = latest_file.stem
        
        return self.load_checkpoint(checkpoint_id)
    
    def get_processed_files(self, checkpoint_id: Optional[str] = None) -> Set[str]:
        """
        Get set of processed files from checkpoint.
        
        Args:
            checkpoint_id: Optional specific checkpoint ID
        
        Returns:
            Set of processed file paths
        """
        if checkpoint_id:
            checkpoint = self.load_checkpoint(checkpoint_id)
        else:
            checkpoint = self.get_latest_checkpoint()
        
        if checkpoint:
            return set(checkpoint.get('processed_files', []))
        
        return set()
    
    def mark_file_processed(self, checkpoint_id: str, file_path: str) -> bool:
        """
        Mark a file as processed in checkpoint.
        
        Args:
            checkpoint_id: Checkpoint identifier
            file_path: Path to processed file
            
        Returns:
            True if successful
        """
        checkpoint = self.load_checkpoint(checkpoint_id)
        if not checkpoint:
            return False
        
        processed_files = set(checkpoint.get('processed_files', []))
        processed_files.add(file_path)
        checkpoint['processed_files'] = list(processed_files)
        checkpoint['progress'] = len(processed_files) / checkpoint.get('total_files', 1)
        checkpoint['updated_at'] = datetime.now().isoformat()
        
        checkpoint_file = self.checkpoint_dir / f"{checkpoint_id}.json"
        
        try:
            with self.lock:
                with open(checkpoint_file, 'w', encoding='utf-8') as f:
                    json.dump(checkpoint, f, indent=2, default=str)
            return True
        except Exception:
            return False
    
    def delete_checkpoint(self, checkpoint_id: str) -> bool:
        """Delete a checkpoint"""
        checkpoint_file = self.checkpoint_dir / f"{checkpoint_id}.json"
        
        try:
            if checkpoint_file.exists():
                checkpoint_file.unlink()
                with self.lock:
                    if self.current_checkpoint == checkpoint_id:
                        self.current_checkpoint = None
                return True
        except Exception:
            pass
        
        return False
    
    def list_checkpoints(self) -> List[Dict[str, Any]]:
        """List all available checkpoints"""
        checkpoints = []
        
        for checkpoint_file in self.checkpoint_dir.glob("*.json"):
            checkpoint_id = checkpoint_file.stem
            checkpoint = self.load_checkpoint(checkpoint_id)
            
            if checkpoint:
                checkpoint['file'] = str(checkpoint_file)
                checkpoint['modified'] = datetime.fromtimestamp(
                    checkpoint_file.stat().st_mtime
                ).isoformat()
                checkpoints.append(checkpoint)
        
        checkpoints.sort(
            key=lambda c: c.get('created_at', ''),
            reverse=True
        )
        
        return checkpoints
    
    def resume_from_checkpoint(self, checkpoint_id: Optional[str] = None,
                              all_files: Optional[List[str]] = None) -> List[str]:
        """
        Get list of files that still need processing.
        
        Args:
            checkpoint_id: Optional specific checkpoint ID
            all_files: List of all files to process
        
        Returns:
            List of files that still need processing
        """
        if not all_files:
            return []
        
        processed = self.get_processed_files(checkpoint_id)
        remaining = [f for f in all_files if f not in processed]
        
        return remaining
    
    def clear_all(self):
        """Clear all checkpoints"""
        with self.lock:
            for checkpoint_file in self.checkpoint_dir.glob("*.json"):
                try:
                    checkpoint_file.unlink()
                except Exception:
                    pass
            
            self.current_checkpoint = None
