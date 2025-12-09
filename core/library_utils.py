"""
Shared library detection and caching utilities.

Readers that need optional libraries (pytesseract, pillow, opencv, fitz, numpy)
should call `get_shared_libs()` which returns a dict with module objects
or None and a list of missing package names under the key 'missing'.
"""
from functools import lru_cache


@lru_cache(maxsize=1)
def get_shared_libs():
    """Return a dict of available optional libraries.

    Keys returned include: 'fitz', 'pytesseract', 'Image', 'cv2', 'np', 'missing'
    """
    libs = {}
    missing = []

    try:
        import fitz
        libs['fitz'] = fitz
    except Exception:
        libs['fitz'] = None
        missing.append('pymupdf')

    try:
        import pytesseract
        libs['pytesseract'] = pytesseract
    except Exception:
        libs['pytesseract'] = None
        missing.append('pytesseract')

    try:
        from PIL import Image
        libs['Image'] = Image
    except Exception:
        libs['Image'] = None
        missing.append('Pillow')

    try:
        import cv2
        import numpy as np
        libs['cv2'] = cv2
        libs['np'] = np
    except Exception:
        libs['cv2'] = None
        libs['np'] = None
        missing.append('opencv-python')

    libs['missing'] = missing
    return libs
