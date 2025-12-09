"""
Path utilities - Independent functions for path operations
No dependencies on other project modules.
"""

from pathlib import Path
from typing import Optional


def get_extraction_base_folder(base_path: Optional[Path] = None) -> Path:
    """
    Get base folder for file extractions.
    Creates the folder if it doesn't exist.
    
    Args:
        base_path: Optional base path for extraction folder.
                   If None, uses EXTRACTION_FOLDER environment variable or current directory.
    
    Returns:
        Path object to extraction base folder
    """
    if base_path:
        extraction_base = Path(base_path)
    else:
        import os
        extraction_folder_env = os.getenv('EXTRACTION_FOLDER')
        if extraction_folder_env:
            extraction_base = Path(extraction_folder_env)
        else:
            # Default to current working directory
            extraction_base = Path.cwd() / "extracted_files"
    
    extraction_base.mkdir(parents=True, exist_ok=True)
    return extraction_base


def get_extraction_name_file(
    file_path: str,
    extension: Optional[str] = None,
    base_path: Optional[Path] = None
) -> str:
    """
    Get extraction folder name for a file.
    Creates unique folder name if one already exists.
    
    Args:
        file_path: Path to file
        extension: Optional file extension to remove from name
        base_path: Optional base path for extraction folder
        
    Returns:
        String path to extraction folder
    """
    path = Path(file_path)
    name = path.name
    
    if extension:
        folder_name = name[:-len(extension)] if name.endswith(extension) else name
    else:
        folder_name = path.stem
    
    extraction_base = get_extraction_base_folder(base_path)
    extract_to = extraction_base / folder_name
    
    counter = 1
    original_extract_to = extract_to
    while extract_to.exists():
        extract_to = Path(f"{original_extract_to}_{counter}")
        counter += 1
    
    return str(extract_to)

