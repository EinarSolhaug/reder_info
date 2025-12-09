"""
Shared OCR utilities: tesseract configuration and preprocessing helper.

This module relies on `core.library_utils.get_shared_libs()` to determine
which optional modules are available.
"""
from functools import lru_cache
from typing import Tuple

from .library_utils import get_shared_libs


@lru_cache(maxsize=4)
def get_tesseract_config(languages=None) -> Tuple[str, str]:
    """Return (lang_string, config_string) for pytesseract.

    If pytesseract is unavailable returns default ('eng', '--oem 3 --psm 6').
    """
    libs = get_shared_libs()
    pytesseract = libs.get('pytesseract')

    if not pytesseract:
        return 'eng', '--oem 3 --psm 6'

    try:
        available = pytesseract.get_languages(config="")
    except Exception:
        available = []

    selected = []
    if languages:
        for lang in languages:
            if lang in available:
                selected.append(lang)

    if not selected:
        selected = ['eng'] if 'eng' in available else (available[:1] if available else ['eng'])

    lang_str = '+'.join(selected)
    config = '--oem 3 --psm 6'
    return lang_str, config


def preprocess_for_ocr(img_array, libs=None):
    """Preprocess numpy image array for OCR using OpenCV if available.

    Returns processed array. If cv2/np unavailable returns input unchanged.
    """
    if libs is None:
        libs = get_shared_libs()

    cv2 = libs.get('cv2')
    np = libs.get('np')

    if not cv2 or not np:
        return img_array

    # Convert to grayscale if needed
    try:
        if len(img_array.shape) == 3:
            gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
        else:
            gray = img_array

        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return binary
    except Exception:
        return img_array
