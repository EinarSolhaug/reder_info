"""
Central registry of supported extensions per reader type.

Readers should call `get_extensions_for(key)` instead of re-defining
their own `extensions_type_extract()` lists. This keeps the mappings
in one place and makes it easy to keep them consistent.
"""
from typing import Set, Dict

_REGISTRY: Dict[str, Set[str]] = {
    'pdf': {'.pdf'},
    'office': {'.docx', '.doc', '.xlsx', '.xls', '.csv', '.pptx', '.ppt'},
    'image': {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.ico', '.svg'},
    'email': {'.eml', '.msg', '.mbox', '.pst'},
    'archive': {'.zip', '.tar', '.gz', '.bz2', '.rar', '.7z'},
    'remaining': {
        '.json', '.xml', '.txt', '.yaml', '.yml', '.html', '.htm', '.bin', '.rtf',
        '.md', '.csv', '.log', '.ini', '.cfg'
    }
}


def get_extensions_for(key: str) -> Set[str]:
    """Return a set of extensions for the given reader key.

    Common keys: 'pdf', 'office', 'image', 'email', 'archive', 'remaining'
    """
    return _REGISTRY.get(key, set())


def register_extensions(key: str, extensions: Set[str]):
    """Register or update extensions for a reader key."""
    _REGISTRY[key] = set(extensions)
