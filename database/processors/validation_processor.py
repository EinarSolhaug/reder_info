"""
Validation Processor - Data validation and sanitization
"""
from typing import Dict, Any

class ValidationProcessor:
    """Validates and sanitizes data before storage"""
    
    @staticmethod
    def sanitize_text(text: str) -> str:
        """Sanitize text for database storage"""
        if not isinstance(text, str):
            try:
                text = text.decode('utf-8', errors='replace')
            except:
                text = str(text)
        
        # Remove NULL bytes
        text = text.replace('\x00', '')
        
        # Remove control characters except common whitespace
        sanitized = []
        for char in text:
            code = ord(char)
            if code >= 32 or code in (9, 10, 13):
                sanitized.append(char)
        
        return ''.join(sanitized)
    
    @staticmethod
    def validate_file_info(file_info: Dict[str, Any]) -> bool:
        """Validate file info structure"""
        required_fields = ['name', 'path', 'type']
        return all(field in file_info for field in required_fields)
    
    @staticmethod
    def validate_hash(file_hash: str) -> bool:
        """Validate hash format"""
        if not file_hash or file_hash in ('N/A', 'SKIPPED_LARGE_FILE', 'ERROR'):
            return False
        return len(file_hash) == 64  # SHA256