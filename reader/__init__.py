"""
Reader module - File reading functionality
All file readers are independent and can be used separately.
"""

from .main_specify_method import (
    main_specify_method_of_reading_the_file,
    specify_method_of_reading_the_file_list
)

__all__ = [
    'main_specify_method_of_reading_the_file',
    'specify_method_of_reading_the_file_list',
]

