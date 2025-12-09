"""
Utilities for recursively storing extracted files via the storage pipeline.

This module provides a single function `recursively_store_extracted` which
walks the `result` structure produced by readers, adds extracted/attachment
results via a caller-provided `add_result_fn` (if any), and calls
`storage_pipeline.store_file_complete` for each extracted file. It returns
summary counts so callers can update their own statistics.
"""
from typing import Callable, Dict, Any, Optional


def recursively_store_extracted(
    storage_pipeline,
    result: Dict[str, Any],
    parent_path_id: Optional[int] = None,
    add_result_fn: Optional[Callable[[Dict[str, Any]], None]] = None,
    logger=None
) -> Dict[str, int]:
    """Recursively store extracted files and attachments.

    Args:
        storage_pipeline: instance with `store_file_complete` and `get_statistics`
        result: processing result dict (should contain 'Metadata' and 'Content')
        parent_path_id: optional parent path id for storage
        add_result_fn: optional callback to add a result to caller's results list
        logger: optional logger for debug/info messages

    Returns:
        dict with counts: {'stored': int, 'duplicates': int, 'errors': int, 'processed': int}
    """
    counts = {'stored': 0, 'duplicates': 0, 'errors': 0, 'processed': 0}

    if not result or not isinstance(result, dict):
        return counts

    content = result.get('Content', {})
    if not isinstance(content, dict):
        return counts

    # Helper to store a single extracted_result
    def _store_one(extracted_result: Dict[str, Any], parent_id: Optional[int] = parent_path_id):
        nonlocal counts

        if not isinstance(extracted_result, dict) or not extracted_result.get('Metadata'):
            return

        extracted_file_info = extracted_result.get('Metadata', {})
        extracted_content = extracted_result.get('Content', {})

        # Let caller track results
        if add_result_fn:
            try:
                add_result_fn(extracted_result)
            except Exception:
                # ignore failures in callback
                pass

        counts['processed'] += 1

        # Detect extraction failure
        is_extraction_failure = isinstance(extracted_content, dict) and bool(extracted_content.get('error'))

        # Attempt to store via storage pipeline
        try:
            storage_response = storage_pipeline.store_file_complete(
                extracted_file_info,
                extracted_result,
                parent_path_id=parent_id,
                hierarchy_path=None,
                use_async=False
            )

            if hasattr(storage_response, 'is_success') and storage_response.is_success:
                counts['stored'] += 1
                # Recurse into nested extracted files using returned path_id
                try:
                    child_parent_id = getattr(storage_response, 'path_id', None)
                except Exception:
                    child_parent_id = None
                # Recurse
                child_counts = recursively_store_extracted(
                    storage_pipeline,
                    extracted_result,
                    parent_path_id=child_parent_id,
                    add_result_fn=add_result_fn,
                    logger=logger
                )
                for k, v in child_counts.items():
                    counts[k] += v

            elif hasattr(storage_response, 'is_duplicate') and storage_response.is_duplicate:
                counts['duplicates'] += 1
            else:
                # Treat as error
                counts['errors'] += 1

        except Exception as e:
            counts['errors'] += 1
            if logger:
                try:
                    logger.error(f"Error storing extracted file: {e}")
                except Exception:
                    pass

    # Process archive extracted files
    if 'extracted_files' in content and isinstance(content['extracted_files'], list):
        for extracted in content['extracted_files']:
            _store_one(extracted, parent_path_id)

    # Process email attachments
    attachments = content.get('attachments')
    if attachments and isinstance(attachments, dict):
        if 'extracted_files' in attachments and isinstance(attachments['extracted_files'], list):
            for attachment_result in attachments['extracted_files']:
                _store_one(attachment_result, parent_path_id)

    return counts
