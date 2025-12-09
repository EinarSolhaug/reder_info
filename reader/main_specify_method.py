"""
Main file routing module that determines which reader to use based on file extension.
Simplified version with only JSON collection
"""

import os
import threading
import time
import sys
from pathlib import Path

parent_dir = Path(__file__).parent.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))
from .read_img_fast import specify_img_method_of_reading_the_file, extensions_type_extract as img_extensions
from .read_archive import specify_archive_method_of_reading_the_file, extensions_type_extract as archive_extensions
from .read_office import specify_office_method_of_reading_the_file, extensions_type_extract as office_extensions
from .read_pdf import specify_pdf_method_of_reading_the_file, extensions_type_extract as pdf_extensions
from .read_remaining import specify_remaining_method_of_reading_the_file, extensions_type_extract as remaining_extensions
from .read_email import specify_email_method_of_reading_the_file, extensions_type_extract as email_extensions

import logging
logger = logging.getLogger(__name__)


from core.file_utils import (
    read_tree,
    create_standardized_result

)



from core.time_utils import (
    print_execution_time,
    calculate_file_processing_metrics
)

from core.logging_utils import (
    record_command_line_action,

)


MAX_RECURSION_DEPTH = 5


_extraction_lock = threading.Lock()

def _process_extracted_files(extraction_path, extraction_type, parent_file, collect, depth):
    """Process extracted files from archives/emails (thread-safe)"""
    
    # Ensure only one thread processes each extraction at a time
    with _extraction_lock:
        logger.info(f"{'─'*70}")
        logger.info(f"📦 PROCESSING EXTRACTED FILES FROM {extraction_type.upper()}")
        logger.info(f"{'─'*70}")
        logger.info(f"Source:        {os.path.basename(parent_file)}")
        logger.info(f"Location:      {extraction_path}")
    # Record extraction start
    record_command_line_action(
        "EXTRACTION_START",
        f"Processing extracted files from {extraction_type}",
        {
            "extraction_type": extraction_type,
            "parent_file": parent_file,
            "extraction_path": extraction_path,
            "depth": depth
        }
    )
    
    tree = read_tree(extraction_path)
    file_list = [item for item in tree if item.get('type') == 'FILE']
    
    print(f"Total Files:   {len(file_list)}")
    print(f"{'─'*70}\n")
    
    if not file_list:
        record_command_line_action(
            "EXTRACTION_COMPLETE",
            f"No files extracted from {extraction_type}",
            {
                "extraction_type": extraction_type,
                "parent_file": parent_file,
                "extracted_files_count": 0
            }
        )
        return {
            f"{extraction_type}_info": {
                "extraction_path": extraction_path,
                "extracted_files_count": 0
            },
            "extracted_files": []
        }
    
    extracted_results = []
    successful_extractions = 0
    failed_extractions = 0
    
    for idx, file_info in enumerate(file_list, 1):
        file_name = file_info.get('name', 'unknown')
        print(f"Processing: {idx}/{len(file_list)} - {file_name}", end='\r')
        
        # Record individual file processing
        record_command_line_action(
            "EXTRACTED_FILE_PROCESSING",
            f"Processing extracted file {idx}/{len(file_list)}: {file_name}",
            {
                "extraction_type": extraction_type,
                "parent_file": parent_file,
                "file_name": file_name,
                "file_path": file_info.get('path', 'unknown'),
                "progress": f"{idx}/{len(file_list)}"
            }
        )
        
        result = main_specify_method_of_reading_the_file(
            file_info,
            collect=collect,
            depth=depth + 1
        )
        
        if result:
            extracted_results.append(result)
            # Check if processing was successful
            content = result.get("Content", {})
            if content and not content.get("error"):
                successful_extractions += 1
            else:
                failed_extractions += 1
        else:
            failed_extractions += 1
    
    print(f"\n✓ Completed processing {len(extracted_results)}/{len(file_list)} files\n")
    
    # Record extraction completion with detailed results
    success_rate = (len(extracted_results) / len(file_list) * 100) if file_list else 0.0
    record_command_line_action(
        "EXTRACTION_COMPLETE",
        f"Completed processing extracted files from {extraction_type}",
        {
            "extraction_type": extraction_type,
            "parent_file": parent_file,
            "extraction_path": extraction_path,
            "total_files": len(file_list),
            "processed_files": len(extracted_results),
            "successful": successful_extractions,
            "failed": failed_extractions,
            "success_rate": f"{success_rate:.1f}%",
            "extracted_files": [
                {
                    "file_path": r.get("File_Path", "unknown"),
                    "success": not bool(r.get("Content", {}).get("error")),
                    "processing_time": r.get("Processing_Time", 0)
                }
                for r in extracted_results
            ]
        }
    )
    
    return {
        f"{extraction_type}_info": {
            "extraction_path": extraction_path,
            "total_files": len(file_list),
            "processed_files": len(extracted_results),
            "success_rate": f"{success_rate:.1f}%" if file_list else "0%"
        },
        "extracted_files": extracted_results
    }

def _process_email_result(email_result, file_path, collect, depth):
    """
    Process email results with message content and attachments separated
    
    Returns:
    - message: Email metadata and body content (returned directly)
    - attachments: Processed independently through the file routing system
    """
    
    if not email_result or isinstance(email_result, dict) and email_result.get("error"):
        return email_result
    
    # Extract message content
    message_content = email_result.get("message") or email_result.get("messages")
    extraction_path = email_result.get("extraction_path")
    has_attachments = email_result.get("has_attachments", False)
    
    # Structure to hold final result
    final_result = {
        "email_content": message_content,  # Message(s) with metadata and body
        "email_metadata": {
            "source": file_path,
            "attachment_count": email_result.get("attachment_count", 0),
            "has_attachments": has_attachments
        }
    }
    
    # Process attachments if they exist
    if has_attachments and extraction_path and os.path.exists(extraction_path):
        print(f"\n📎 Processing email attachments from: {os.path.basename(file_path)}")
        
        attachments_result = _process_extracted_files(
            extraction_path,
            'email_attachment',
            file_path,
            collect,
            depth
        )
        
        final_result["attachments"] = attachments_result
    else:
        final_result["attachments"] = {
            "email_attachment_info": {
                "extraction_path": extraction_path or "N/A",
                "extracted_files_count": 0
            },
            "extracted_files": []
        }
    
    return final_result


def main_specify_method_of_reading_the_file(file_info, collect=True, depth=0):
    """Read a file using appropriate reader and optionally collect results"""
    
    if depth > MAX_RECURSION_DEPTH:
        file_path = file_info.get('path', 'unknown')
        print(f"⚠ Maximum recursion depth ({MAX_RECURSION_DEPTH}) exceeded for: {file_path}")
        
        result = create_standardized_result(
            file_path,
            {"error": f"Maximum recursion depth ({MAX_RECURSION_DEPTH}) exceeded"},
            0
        )
        

        
        return result
    
    if file_info.get('type') != 'FILE':
        return None
    
    file_path = file_info.get('path')
    extension = file_info.get('extension', '').lower()
    
    start_time = time.time()
    
    if not extension:
        print(f"⚠ No extension found for: {file_path}")
        
        processing_time = time.time() - start_time
        result = create_standardized_result(
            file_path, 
            {"error": "No file extension found"},
            processing_time
        )
        

        
        return result
    
    content_data = None
    
    try:
        # Direct processing - no threading
        if extension in office_extensions():
            content_data = print_execution_time(
                f"Reading office file: {os.path.basename(file_path)}",
                specify_office_method_of_reading_the_file,
                file_info
            )
        
        elif extension in remaining_extensions():
            content_data = print_execution_time(
                f"Reading file: {os.path.basename(file_path)}",
                specify_remaining_method_of_reading_the_file,
                file_info
            )
        
        elif extension in img_extensions():
            content_data = print_execution_time(
                f"Reading image: {os.path.basename(file_path)}",
                specify_img_method_of_reading_the_file,
                file_info
            )
        
        elif extension in pdf_extensions():
            content_data = print_execution_time(
                f"Reading PDF: {os.path.basename(file_path)}",
                specify_pdf_method_of_reading_the_file,
                file_info
            )
        
        elif extension in archive_extensions():
            archive_result = print_execution_time(
                f"Extracting archive: {os.path.basename(file_path)}",
                specify_archive_method_of_reading_the_file,
                file_info
            )
            extraction_path = archive_result.get("extraction_path") if archive_result else None
            
            if extraction_path and isinstance(extraction_path, str) and os.path.exists(extraction_path):
                content_data = _process_extracted_files(
                    extraction_path,
                    'archive',
                    file_path,
                    collect,
                    depth
                )
            else:
                content_data = {"error": "Failed to extract archive"}

        elif extension in email_extensions():
            # EMAIL HANDLING: Separate message content from attachments
            email_result = print_execution_time(
                f"Reading email: {os.path.basename(file_path)}",
                specify_email_method_of_reading_the_file,
                file_info
            )
            
            if email_result:
                content_data = _process_email_result(
                    email_result,
                    file_path,
                    collect,
                    depth
                )
            else:
                content_data = {"error": "No email data"}
        
        else:
            # Unrecognized file type - return result with error instead of None
            # This ensures the file is counted and tracked
            processing_time = time.time() - start_time
            result = create_standardized_result(
                file_path,
                {"error": f"Unsupported file type: {extension}"},
                processing_time
            )
            return result
            
    except Exception as e:
        print(f"✗ Error processing {file_path}: {str(e)}")
        content_data = {"error": str(e)}
    
    if content_data is None:
        # If content_data is None, create a result with error
        # This ensures all files are tracked, even if processing failed
        processing_time = time.time() - start_time
        result = create_standardized_result(
            file_path,
            {"error": "File processing returned no content"},
            processing_time
        )
        return result
    
    processing_time = time.time() - start_time
    result = create_standardized_result(file_path, content_data, processing_time)
    
    # Calculate and display file processing metrics
    calculate_file_processing_metrics(file_info, result)
    
    return result


def specify_method_of_reading_the_file_list(list_tree, collect=True):
    """Process a list of files"""
    results = []
    
    for file_info in list_tree:
        if 'extension' in file_info and file_info.get('type') == 'FILE':
            result = main_specify_method_of_reading_the_file(
                file_info, 
                collect=collect,
                depth=0
            )
            if result is not None:
                results.append(result)
    
    return results