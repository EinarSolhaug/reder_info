"""
Fast Image Reader - Optimized for speed
Replaces read_img.py with performance improvements
"""

import os
import logging
from functools import lru_cache
import time
from pathlib import Path
import threading
# Add these imports at the top with other imports
from core.library_utils import get_shared_libs
from core.ocr_utils import get_tesseract_config, preprocess_for_ocr
logger = logging.getLogger(__name__)

# Global cache for library imports (avoid repeated imports)



def extensions_type_extract():
    """Return set of supported image extensions"""
    from core.extension_registry import get_extensions_for
    return get_extensions_for('image')




def _should_skip_ocr(file_info: dict) -> tuple:
    width = file_info.get('width', 0)
    height = file_info.get('height', 0)
    format_type = file_info.get('format', '')

    # Skip tiny images
    if width < 50 or height < 50:
        return True, "too_small"

    # Skip ICO format
    if format_type == "ICO":
        return True, "icon_format"

    # Default: do not skip
    return False, ""

    


def specify_img_method_of_reading_the_file(file_info, logger_param=None):
    """Fast image file reader with optimized OCR"""
    file_path = file_info.get("path")
    
    if not file_path or not os.path.exists(file_path):
        logger.error(f"File not found: {file_path}")
        return None
    
    file_path = str(file_path)
    file_lower = file_path.lower()
    
    try:
        if file_lower.endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp', 
                               '.tiff', '.tif', '.webp', '.ico')):
            return read_image_file_fast(file_path)
        elif file_lower.endswith('.svg'):
            return read_svg_file(file_path)
        else:
            logger.warning(f"Unsupported image file type: {file_path}")
            return None
    except Exception as e:
        logger.error(f"Error reading {file_path}: {str(e)}")
        return None


def read_image_file_fast(filepath , languages=None):
    """
    Fast image file reader with optimized OCR
    
    Performance improvements:
    1. Early exit for non-document images (thumbnails, icons, photos)
    2. Cached library imports
    3. Single-language OCR (eng only)
    4. Fast preprocessing
    5. Optimized Tesseract config
    """
    result = {"text": "", "file_path": filepath}
    
    if not os.path.exists(filepath):
        result["error"] = "File not found"
        return result
    
    # Get file size early
    try:
        stat = os.stat(filepath)
        result["file_size"] = stat.st_size
    except Exception:
        pass
    
    # Get cached libraries
    libs = get_shared_libs()
    Image = libs.get('Image')
    pytesseract = libs.get('pytesseract')
    cv2 = libs.get('cv2')
    np = libs.get('np')
    
    if not Image:
        result["error"] = "Pillow not installed. Install with: pip install Pillow"
        return result
    
    OCR_AVAILABLE = bool(pytesseract)
    CV_AVAILABLE = bool(cv2 and np)
    
    try:
        with Image.open(filepath) as img:
            result["width"], result["height"] = img.size
            result["mode"] = img.mode
            result["format"] = img.format
            
            # Quick check: should we skip OCR?
            result["file_size"] = result.get("file_size", 0)
            skip_ocr, skip_reason = _should_skip_ocr(result)
            
            if skip_ocr:
                result["ocr_skipped"] = True
                result["skip_reason"] = skip_reason
                result["text"] = ""
                result["text_length"] = 0
                logger.debug(f"Skipped OCR for {Path(filepath).name}: {skip_reason}")
                return result
            
            # Check if OCR is available
            if not OCR_AVAILABLE:
                result["error"] = "pytesseract not installed. Install with: pip install pytesseract"
                return result
            
            # Get optimized Tesseract config
            lang, config = get_tesseract_config(languages)
            
            result["ocr_engine"] = "tesseract"
            result["ocr_language"] = lang
            result["ocr_used"] = True
            
            # Preprocess image
            # Preprocess image
            if CV_AVAILABLE:
                # Convert to RGB then to numpy array
                rgb_img = img.convert("RGB")
                arr = np.array(rgb_img)
                processed = preprocess_for_ocr(arr, libs)
                ocr_target = Image.fromarray(processed)
                
            else:
                # No OpenCV, use image directly
                ocr_target = img.convert("RGB")
            
            # Run OCR with optimized config
            try:
                text = pytesseract.image_to_string(ocr_target, lang=lang, config=config)
            except Exception as e:
                logger.error(f"OCR failed for {filepath}: {e}")
                text = ""
            
            # Store result
            if text and text.strip():
                result["text"] = text.strip()
                result["text_length"] = len(text.strip())
            else:
                result["text"] = ""
                result["text_length"] = 0
                
            logger.debug(f"OCR completed for {Path(filepath).name}: {result['text_length']} chars")
            
    
    except Exception as e:
        result["error"] = str(e)
        logger.error(f"Error processing {filepath}: {e}")

    return result


def read_svg_file(filepath):
    """Read SVG file (metadata only, no OCR needed)"""
    try:
        if not os.path.exists(filepath):
            return {"error": "File not found", "filepath": filepath}
        
        with open(filepath, 'r', encoding='utf-8') as file:
            content = file.read()
        
        result = {
            "filepath": filepath,
            "content": content,
            "size": len(content),
            "lines": len(content.splitlines())
        }
        
        import re
        width_match = re.search(r'width=["\'](\d+(?:\.\d+)?)["\']', content)
        height_match = re.search(r'height=["\'](\d+(?:\.\d+)?)["\']', content)
        viewbox_match = re.search(r'viewBox=["\']([^"\']+)["\']', content)
        
        if width_match:
            result["width"] = width_match.group(1)
        if height_match:
            result["height"] = height_match.group(1)
        if viewbox_match:
            result["viewBox"] = viewbox_match.group(1)
        
        return result
    except Exception as e:
        return {"error": str(e), "filepath": filepath}
    
    
    
    
