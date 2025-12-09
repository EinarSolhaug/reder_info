"""
File utilities - Independent functions for file operations
No dependencies on other project modules.
"""

import os
import re
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional


def format_file_size(size_bytes: Optional[int]) -> str:
    """
    Format file size in human-readable format.
    
    Args:
        size_bytes: File size in bytes
        
    Returns:
        Formatted string (e.g., "1.23 MB")
    """
    if size_bytes is None:
        return "N/A"
    
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} PB"


def calculate_file_hash(file_path: str, algorithm: str = 'sha256') -> str:
    """
    Calculate file hash.
    
    Args:
        file_path: Path to file
        algorithm: Hash algorithm (default: 'sha256')
        
    Returns:
        Hexadecimal hash string
    """
    hash_obj = hashlib.new(algorithm)
    
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            hash_obj.update(chunk)
    
    return hash_obj.hexdigest()


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename by removing invalid characters.
    
    Args:
        filename: Original filename
        
    Returns:
        Sanitized filename
    """
    if not filename:
        return "unnamed_attachment"
    filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', filename)
    filename = filename.strip('. ')
    return filename if filename else "unnamed_attachment"


def get_standardized_metadata(file_path: str) -> Optional[Dict[str, Any]]:
    """
    Get standardized metadata for a file or directory.
    
    Args:
        file_path: Path to file or directory
        
    Returns:
        Dictionary with metadata or None if error
    """
    try:
        path = Path(file_path)
        
        if not path.exists():
            return {
                "name": path.name,
                "path": str(path),
                "type": "UNKNOWN",
                "extension": path.suffix.lower() if path.suffix else "none",
                "size": "N/A",
                "size_bytes": None,
                "hash": "N/A",
                "created": "N/A",
                "modified": "N/A",
                "accessed": "N/A",
                "readable": False,
                "writable": False,
                "executable": False,
                "processing_time": "N/A"
            }
        
        stats = path.stat()
        
        # Determine file type
        if path.is_file():
            file_type = "FILE"
        elif path.is_dir():
            file_type = "DIRECTORY"
        elif path.is_symlink():
            file_type = "SYMLINK"
        else:
            file_type = "OTHER"
        
        is_readable = os.access(file_path, os.R_OK)
        is_writable = os.access(file_path, os.W_OK)
        is_executable = os.access(file_path, os.X_OK)
        
        file_size = format_file_size(stats.st_size)
        
        file_hash = "N/A"
        if path.is_file() and is_readable:
            try:
                if stats.st_size < 100 * 1024 * 1024:  # 100MB limit
                    file_hash = calculate_file_hash(file_path)
                else:
                    file_hash = "SKIPPED_LARGE_FILE"
            except Exception:
                file_hash = "ERROR"
        
        metadata = {
            "name": path.name,
            "path": str(path.absolute()),
            "type": file_type,
            "extension": path.suffix.lower() if path.suffix else "none",
            "size": file_size,
            "size_bytes": stats.st_size,
            "hash": file_hash,
            "created": datetime.fromtimestamp(stats.st_ctime).isoformat(),
            "modified": datetime.fromtimestamp(stats.st_mtime).isoformat(),
            "accessed": datetime.fromtimestamp(stats.st_atime).isoformat(),
            "readable": is_readable,
            "writable": is_writable,
            "executable": is_executable,
            "processing_time": "N/A"
        }
        
        return metadata
        
    except Exception:
        return {
            "name": Path(file_path).name if file_path else "Unknown",
            "path": str(file_path) if file_path else "Unknown",
            "type": "ERROR",
            "extension": "none",
            "size": "N/A",
            "size_bytes": None,
            "hash": "N/A",
            "created": "N/A",
            "modified": "N/A",
            "accessed": "N/A",
            "readable": False,
            "writable": False,
            "executable": False,
            "processing_time": "N/A"
        }


def read_tree(path: str) -> list:
    """
    Read directory tree and return list of file metadata.
    
    Args:
        path: Directory path
        
    Returns:
        List of file metadata dictionaries
    """
    file_info_list = []
    
    for p in Path(path).rglob("*"):
        file_info = get_standardized_metadata(p)
        if file_info:
            file_info_list.append(file_info)
    
    return file_info_list


def create_standardized_result(file_path: str, content_data: Any, 
                               processing_time: Optional[float] = None) -> Dict[str, Any]:
    """
    Create standardized result structure.
    
    Args:
        file_path: Path to processed file
        content_data: Content data from processing
        processing_time: Processing time in seconds
        
    Returns:
        Standardized result dictionary
    """
    metadata = get_standardized_metadata(file_path)
    
    # Update processing time
    if processing_time is not None:
        metadata["processing_time"] = f"{processing_time:.4f} seconds"
    
    # Create the standardized format
    result = {
        "Metadata": metadata,
        "Content": content_data if content_data is not None else {}
    }
    
    return result

