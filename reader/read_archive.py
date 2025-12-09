import bz2
import gzip
import os
from pathlib import Path
import shutil
import tarfile
import zipfile
from core.path_utils import get_extraction_name_file


def extensions_type_extract():
    """Return set of supported archive extensions"""
    return {
        '.zip',
        '.tar',
        '.gz',
        '.bz2',
        '.rar',
        '.7z'
    }


def specify_archive_method_of_reading_the_file(file_info, logger=None):

    if not os.path.exists(file_info["path"]):
        print(f"✗ File not found: {file_info['path']}")

        return {"error": "File not found", "path": file_info["path"]}
    
    file_path = str(file_info["path"])
    file_lower = file_path.lower()
    
    try:
        extraction_path = None
        
        if file_lower.endswith('.zip'):
            extraction_path = extract_zip(file_path)
        elif file_lower.endswith('.tar') or file_lower.endswith('.tar.gz') or file_lower.endswith('.tar.bz2') or file_lower.endswith('.tar.xz'):
            extraction_path = extract_tar(file_path)
        elif file_lower.endswith('.gz'):
            extraction_path = extract_gz(file_path)
        elif file_lower.endswith('.bz2'):
            extraction_path = extract_bz2(file_path)
        elif file_lower.endswith('.rar'):
            extraction_path = extract_rar(file_path)
        elif file_lower.endswith('.7z'):
            extraction_path = extract_7z(file_path)
        else:
            print(f"✗ Unsupported file type: {file_path}")

            return {"error": "Unsupported archive type", "path": file_path}
        
        # STANDARDIZED: Always return dict
        if extraction_path:
            return {
                "extraction_path": extraction_path,
                "status": "success",
                "archive_type": file_lower.split('.')[-1]
            }
        else:
            return {"error": "Extraction failed", "path": file_path}
            
    except Exception as e:
        print(f"✗ Error extracting {file_path}: {str(e)}")

        return {"error": str(e), "path": file_path}
    
# ============================================================================
# Archive extraction functions
# ============================================================================

def extract_zip(file_path):
    """Extract ZIP files"""
    extract_to = get_extraction_name_file(file_path, '.zip')
    os.makedirs(extract_to, exist_ok=True)
    
    with zipfile.ZipFile(file_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)
    print(f"✓ Extracted {file_path} to {extract_to}/")
    return extract_to


def extract_tar(file_path):
    """Extract TAR files (.tar, .tar.gz, .tar.bz2, .tar.xz)"""
    # Determine extension to use for folder name
    if file_path.endswith('.tar.gz'):
        extension = '.tar.gz'
    elif file_path.endswith('.tar.bz2'):
        extension = '.tar.bz2'
    elif file_path.endswith('.tar.xz'):
        extension = '.tar.xz'
    else:
        extension = '.tar'
    
    extract_to = get_extraction_name_file(file_path, extension)
    os.makedirs(extract_to, exist_ok=True)
    
    with tarfile.open(file_path, 'r:*') as tar_ref:
        tar_ref.extractall(extract_to)
    print(f"✓ Extracted {file_path} to {extract_to}/")
    return extract_to


def extract_gz(file_path):
    """Extract GZ files (single file compression)"""
    extract_to = get_extraction_name_file(file_path, '.gz')
    os.makedirs(extract_to, exist_ok=True)
    
    # Output file inside the folder
    output_file = os.path.join(extract_to, Path(file_path).stem)
    
    with gzip.open(file_path, 'rb') as f_in:
        with open(output_file, 'wb') as f_out:
            shutil.copyfileobj(f_in, f_out)
    print(f"✓ Extracted {file_path} to {extract_to}/")
    return extract_to


def extract_bz2(file_path):
    """Extract BZ2 files (single file compression)"""
    extract_to = get_extraction_name_file(file_path, '.bz2')
    os.makedirs(extract_to, exist_ok=True)
    
    # Output file inside the folder
    output_file = os.path.join(extract_to, Path(file_path).stem)
    
    with bz2.open(file_path, 'rb') as f_in:
        with open(output_file, 'wb') as f_out:
            shutil.copyfileobj(f_in, f_out)
    print(f"✓ Extracted {file_path} to {extract_to}/")
    return extract_to


def extract_rar(file_path):
    """Extract RAR files (requires rarfile package and UnRAR tool)"""
    try:
        import rarfile
        
        # Set UnRAR tool path for Windows
        rarfile.UNRAR_TOOL = "unrar"
        
        # Try to find WinRAR installation
        winrar_paths = [
            r"C:\Users\SOLO\Downloads\UnRAR.exe",
            r"C:\Program Files\WinRAR\UnRAR.exe",
            r"C:\Program Files (x86)\WinRAR\UnRAR.exe"
        ]
        for path in winrar_paths:
            if os.path.exists(path):
                rarfile.UNRAR_TOOL = path
                break
        
    except ImportError:
        print("⚠ rarfile not installed. Install with: pip install rarfile")
        return None
    
    extract_to = get_extraction_name_file(file_path, '.rar')
    os.makedirs(extract_to, exist_ok=True)
    
    try:
        with rarfile.RarFile(file_path, 'r') as rar_ref:
            rar_ref.extractall(extract_to)
        print(f"✓ Extracted {file_path} to {extract_to}/")
        return extract_to
    except rarfile.RarCannotExec:
        print("⚠ UnRAR tool not found. Please install UnRAR:")
        print("  Linux: sudo apt-get install unrar")
        print("  Mac: brew install unrar")
        return None
    except Exception as e:
        print(f"✗ Error extracting RAR file: {str(e)}")
        return None


def extract_7z(file_path):
    """Extract 7Z files (requires py7zr package)"""
    try:
        import py7zr
    except ImportError:
        print("⚠ py7zr not installed. Install with: pip install py7zr")
        return None
    
    extract_to = get_extraction_name_file(file_path, '.7z')
    os.makedirs(extract_to, exist_ok=True)
    
    try:
        with py7zr.SevenZipFile(file_path, 'r') as sz_ref:
            sz_ref.extractall(extract_to)
        print(f"✓ Extracted {file_path} to {extract_to}/")
        return extract_to
    except Exception as e:
        print(f"✗ Error extracting 7z file: {str(e)}")
        return None
