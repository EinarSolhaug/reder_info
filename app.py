
import os
import time
from pathlib import Path
import sys
import logging
logger = logging.getLogger(__name__)
# Add paths
parent_dir = Path(__file__).parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))



# NEW: Import threaded reader
from pipeline.integrated_reader import IntegratedFileReader  

# Add this import with other core imports
from core.storage_utils import recursively_store_extracted

from core.time_utils import (
    print_execution_time,
    calculate_processing_statistics
)

from core.logging_utils import (
    record_command_line_action,
    start_action_recording,
    stop_action_recording,
    is_recording_enabled
    
)

from core.concurrency import hub


# OPTIONAL: Import for backward compatibility (if threading fails)
try:
    from reader.main_specify_method import (
        main_specify_method_of_reading_the_file,
        specify_method_of_reading_the_file_list
    )

    from core.file_utils import (
        get_standardized_metadata,
        read_tree
    )
    FALLBACK_AVAILABLE = True
except ImportError:
    FALLBACK_AVAILABLE = False


# ============================================================================
# CONFIGURATION
# ============================================================================

# Threading configuration
USE_THREADING = True  # Set to False to use old sequential processing
MAX_WORKERS = 4  # Number of parallel workers
ENABLE_MONITORING = True  # Enable health monitoring
MONITOR_INTERVAL = 5.0  # Monitoring interval in seconds
# Keep hub monitoring interval aligned with app configuration
hub.set_monitoring_interval(MONITOR_INTERVAL)

# Storage configuration (will be set by user input)
ENABLE_STORAGE = True  # Always enable storage when user provides source/side
STORAGE_SOURCE = None  # Will be set by user input
STORAGE_SIDE = None  # Will be set by user input


# ============================================================================
# NEW: THREADED FILE PROCESSING
# ============================================================================

def main_read_file_threaded(file_path, storage_source=None, storage_side=None):
    """
    Process a single file using threading
    
    This is the NEW version that uses parallel processing capabilities
    """
    record_command_line_action(
        "FUNCTION_CALL", 
        f"Processing file (threaded): {os.path.basename(file_path)}", 
        {"file_path": file_path, "function": "main_read_file_threaded"}
    )
    
    # Use provided source/side or defaults
    source = storage_source or STORAGE_SOURCE or "default"
    side = storage_side or STORAGE_SIDE or "default"
    
    try:
        with IntegratedFileReader(
            max_workers=MAX_WORKERS,
            enable_monitoring=ENABLE_MONITORING,
            monitor_interval=MONITOR_INTERVAL,
            enable_storage=True,  # Always enable when source/side provided
            storage_source=source,
            storage_side=side,
            thread_manager=hub.thread_mgr,
            pool_manager=hub.pool_mgr,
            process_manager=hub.process_mgr,
            async_manager=hub.async_mgr
        ) as reader:
            result = reader.process_single_file(file_path)
            
            if result:
                record_command_line_action(
                    "FILE_OP", 
                    f"File processed successfully (threaded): {os.path.basename(file_path)}",
                    {"file_path": file_path, "success": True}
                )
            else:
                record_command_line_action(
                    "FILE_OP", 
                    f"File processing failed (threaded): {os.path.basename(file_path)}",
                    {"file_path": file_path, "success": False}, 
                    level="ERROR"
                )
                
            return result
            
    except Exception as e:
        error_msg = f"Error in threaded processing: {str(e)}"
        print(f"✗ {error_msg}")
        record_command_line_action(
            "ERROR", 
            error_msg, 
            {"file_path": file_path, "error": str(e)}, 
            level="ERROR"
        )
        
        # Fallback to sequential if available
        if FALLBACK_AVAILABLE:
            print("→ Falling back to sequential processing...")
            # Note: Sequential file processing doesn't support storage yet
            return main_read_file_sequential(file_path)
        return None

# app.py - Enable priority in IntegratedFileReader

def main_read_folder_threaded(folder_path, storage_source=None, storage_side=None):
    """
    Process an entire folder using parallel threading with priority
    """
    record_command_line_action(
        "FUNCTION_CALL", 
        f"Processing folder (threaded): {os.path.basename(folder_path)}",
        {"folder_path": folder_path, "function": "main_read_folder_threaded"}
    )
    
    # Use provided source/side or defaults
    source = storage_source or STORAGE_SOURCE or "default"
    side = storage_side or STORAGE_SIDE or "default"
    
    try:
        with IntegratedFileReader(
            max_workers=MAX_WORKERS,
            enable_monitoring=ENABLE_MONITORING,
            monitor_interval=MONITOR_INTERVAL,
            use_priority=True,  # ENABLE PRIORITY
            enable_storage=True,  # Always enable when source/side provided
            storage_source=source,
            storage_side=side,
            thread_manager=hub.thread_mgr,
            pool_manager=hub.pool_mgr,
            process_manager=hub.process_mgr,
            async_manager=hub.async_mgr
        ) as reader:
            results = reader.process_folder(folder_path)
            
            stats = reader.get_statistics()
            
            record_command_line_action(
                "FUNCTION_CALL", 
                "Folder processing completed (threaded with priority)",
                {
                    "folder_path": folder_path,
                    "total_files": stats['total'],
                    "completed": stats['completed'],
                    "failed": stats['failed']
                }
            )
            
            return results
            
    except Exception as e:
        error_msg = f"Error in threaded processing: {str(e)}"
        logger.error(error_msg)
        record_command_line_action(
            "ERROR", 
            error_msg, 
            {"folder_path": folder_path, "error": str(e)}, 
            level="ERROR"
        )
        
        if FALLBACK_AVAILABLE:
            logger.info("→ Falling back to sequential processing...")
            return main_read_folder_sequential(
                folder_path,
                storage_source=storage_source,
                storage_side=storage_side
            )
        return []
    
# ============================================================================
# ORIGINAL: SEQUENTIAL FILE PROCESSING (Fallback)
# ============================================================================

def main_read_file_sequential(file_path):
    """
    ORIGINAL sequential file processing (kept for fallback)
    This is your original main_read_file() function
    """
    if not FALLBACK_AVAILABLE:
        print("✗ Sequential processing not available (imports failed)")
        return None
        
    record_command_line_action(
        "FUNCTION_CALL", 
        f"Processing file (sequential): {os.path.basename(file_path)}", 
        {"file_path": file_path, "function": "main_read_file_sequential"}
    )
    
    def _process_file():
        file_info = get_standardized_metadata(file_path)
        
        if file_info is None:
            error_msg = f"Could not read file info for: {file_path}"
            print(f"✗ {error_msg}")
            record_command_line_action(
                "ERROR", error_msg, 
                {"file_path": file_path}, 
                level="ERROR"
            )
            return None

        result = main_specify_method_of_reading_the_file(file_info, collect=True)
        return result
    
    result = print_execution_time(
        f"Processing file: {os.path.basename(file_path)}", 
        _process_file
    )
    
    if result:
        calculate_processing_statistics([result])
        record_command_line_action(
            "FILE_OP", 
            f"File processed successfully (sequential): {os.path.basename(file_path)}",
            {"file_path": file_path, "success": True}
        )
    else:
        record_command_line_action(
            "FILE_OP", 
            f"File processing failed (sequential): {os.path.basename(file_path)}",
            {"file_path": file_path, "success": False}, 
            level="ERROR"
        )
    
    return result


def main_read_folder_sequential(folder_path, storage_source=None, storage_side=None):
    """
    ORIGINAL sequential folder processing (kept for fallback)
    This is your original main_read_folder() function
    NOW WITH STORAGE SUPPORT
    """
    if not FALLBACK_AVAILABLE:
        print("✗ Sequential processing not available (imports failed)")
        return []
        
    record_command_line_action(
        "FUNCTION_CALL", 
        f"Processing folder (sequential): {os.path.basename(folder_path)}",
        {"folder_path": folder_path, "function": "main_read_folder_sequential"}
    )
    
    # Initialize storage pipeline if source/side provided
    storage_pipeline = None
    if storage_source and storage_side:
        try:
            from database.pipelines.storage_pipeline import StoragePipeline
            storage_pipeline = StoragePipeline(
                source_name=storage_source,
                side_name=storage_side,
                enable_concurrency=False,  # Sequential mode
                max_workers=1
            )
            print(f"💾 Storage enabled: Source='{storage_source}', Side='{storage_side}'")
        except Exception as e:
            logger.error(f"Failed to initialize storage pipeline: {e}")
            storage_pipeline = None
    
    def _process_folder():
        print(f"Scanning folder: {folder_path}...")
        record_command_line_action("FILE_OP", "Scanning folder", {"folder_path": folder_path})
        
        tree = read_tree(folder_path)
        files = [item for item in tree if item.get('type') == 'FILE']
        print(f"Found {len(files)} files\n")
        
        record_command_line_action(
            "FILE_OP", 
            f"Found {len(files)} files in folder",
            {"folder_path": folder_path, "file_count": len(files)}
        )
        
        if not files:
            print("No files to process.")
            record_command_line_action("INFO", "No files to process", {"folder_path": folder_path})
            return []
        
        results = specify_method_of_reading_the_file_list(tree, collect=True)
        return results
    
    results = print_execution_time(
        f"Processing folder: {os.path.basename(folder_path)}", 
        _process_folder
    )
    
    if not results:
        return []
    
    # STORE TO DATABASE if storage is enabled
    if storage_pipeline:
        print(f"\n💾 Storing {len(results)} files to database...")
        stored_count = 0
        failed_count = 0
        duplicate_count = 0
        extracted_count = 0  # Counter for extracted files
        
      
        for idx, result in enumerate(results, 1):
            if not result:
                continue
                
            is_failure = bool(result.get("Content", {}).get("error"))
            
            # Store even if failed (to track all files)
            try:
                file_info = result.get("Metadata", {})
                if file_info:
                    path_id = storage_pipeline.store_file_complete(
                        file_info,
                        result,
                        use_async=False
                    )
                    
                    if path_id:
                        stored_count += 1
                        
                        # Store extracted files from archives/emails using shared utility
                        counts = recursively_store_extracted(
                            storage_pipeline,
                            result,
                            parent_path_id=path_id,
                            add_result_fn=lambda r: results.append(r),
                            logger=logger
                        )
                        
                        stored_count += counts.get('stored', 0)
                        duplicate_count += counts.get('duplicates', 0)
                        failed_count += counts.get('errors', 0)
                        extracted_count += counts.get('processed', 0)
                        
                        if idx % 100 == 0:
                            print(f"  Stored {idx}/{len(results)} files (extracted: {extracted_count})...", end='\r')
                    else:
                        duplicate_count += 1
                else:
                    failed_count += 1
            except Exception as e:
                failed_count += 1
                logger.error(f"Storage error for file {idx}: {e}")
                
        
        print(f"\n💾 Storage complete:")
        print(f"   Stored: {stored_count}")
        print(f"   Extracted files stored: {extracted_count}")
        print(f"   Duplicates: {duplicate_count}")
        print(f"   Failed: {failed_count}")
        
        # Get storage statistics
        storage_stats = storage_pipeline.get_statistics()
        print(f"   Storage stats: {storage_stats}")
        
        # Shutdown storage pipeline
        storage_pipeline.shutdown()
    
    # Calculate statistics
    # stats = calculate_processing_statistics(results)
    
    # Display summary
    successful = sum(1 for r in results if r and not r.get("Content", {}).get("error"))
    failed = len(results) - successful
    
    print(f"\n{'='*70}")
    print("FOLDER PROCESSING SUMMARY (Sequential) ")
    print(f"{'='*70}")
    print(f"Total Files Processed:  {len(results)}")
    print(f"Successful:             {successful}")
    print(f"Failed:                 {failed}")
    if storage_pipeline and 'stored_count' in locals():
        print(f"Stored to Database:      {stored_count}")
        if 'extracted_count' in locals() and extracted_count > 0:
            print(f"Extracted Files Stored:  {extracted_count}")
    print(f"{'='*70}\n")
    
    record_command_line_action(
        "FUNCTION_CALL", 
        "Folder processing completed (sequential)",
        {
            "folder_path": folder_path,
            "total_files": len(results),
            "successful": successful,
            "failed": failed,
            "stored": stored_count if 'stored_count' in locals() else 0
        }
    )
    
    return results


# ============================================================================
# DATABASE SOURCE/SIDE MANAGEMENT
# ============================================================================

def get_or_select_source() -> str:
    """
    Get source name from user - either select existing or create new
    
    Returns:
        Source name string
    """
    try:
        from database.managers.hub import get_database_hub
        hub = get_database_hub()
        hub.initialize()
        
        print("\n" + "="*70)
        print("📋 SOURCE SELECTION")
        print("="*70)
        print("Options:")
        print("  1. List existing sources")
        print("  2. Search sources")
        print("  3. Create new source")
        print("  4. Enter source name directly")
        print("="*70)
        
        choice = input("\nEnter your choice (1-4): ").strip()
        
        if choice == "1":
            # List all sources
            sources = hub.source_operations.list_sources(limit=20)
            if not sources:
                print("\n⚠️  No sources found. Creating new source...")
                source_name = input("Enter new source name: ").strip()
                if source_name:
                    hub.source_operations.get_or_create_source(source_name)
                    return source_name
                return "default"
            
            print("\n📋 Available Sources:")
            for i, source in enumerate(sources, 1):
                print(f"  {i}. {source['name']} (ID: {source['id']}, Country: {source['country']}, Job: {source['job']})")
            
            source_choice = input("\nEnter source number or name: ").strip()
            
            # Try to parse as number
            try:
                idx = int(source_choice) - 1
                if 0 <= idx < len(sources):
                    return sources[idx]['name']
            except ValueError:
                pass
            
            # Try to find by name
            for source in sources:
                if source['name'].lower() == source_choice.lower():
                    return source['name']
            
            print(f"⚠️  Source '{source_choice}' not found. Using it as new source name...")
            hub.source_operations.get_or_create_source(source_choice)
            return source_choice
        
        elif choice == "2":
            # Search sources
            search_term = input("Enter search term: ").strip()
            if search_term:
                sources = hub.source_operations.list_sources(search_term=search_term, limit=20)
                if not sources:
                    print(f"\n⚠️  No sources found matching '{search_term}'. Creating new source...")
                    source_name = input("Enter new source name: ").strip() or search_term
                    hub.source_operations.get_or_create_source(source_name)
                    return source_name
                
                print(f"\n📋 Search Results for '{search_term}':")
                for i, source in enumerate(sources, 1):
                    print(f"  {i}. {source['name']} (ID: {source['id']}, Country: {source['country']})")
                
                source_choice = input("\nEnter source number or name: ").strip()
                
                try:
                    idx = int(source_choice) - 1
                    if 0 <= idx < len(sources):
                        return sources[idx]['name']
                except ValueError:
                    pass
                
                for source in sources:
                    if source['name'].lower() == source_choice.lower():
                        return source['name']
                
                print(f"⚠️  Source '{source_choice}' not found. Using it as new source name...")
                hub.source_operations.get_or_create_source(source_choice)
                return source_choice
            else:
                return get_or_select_source()  # Retry
        
        elif choice == "3":
            # Create new source
            source_name = input("Enter new source name: ").strip()
            if not source_name:
                print("⚠️  Empty name. Using 'default'...")
                return "default"
            
            # Optional: ask for additional info
            print("\nOptional information (press Enter to skip):")
            country = input("Country: ").strip() or ""
            job = input("Job: ").strip() or ""
            
            hub.source_operations.get_or_create_source(
                source_name,
                country=country,
                job=job
            )
            print(f"✅ Source '{source_name}' created successfully!")
            return source_name
        
        elif choice == "4":
            # Direct input
            source_name = input("Enter source name: ").strip()
            if not source_name:
                return "default"
            
            # Try to get or create
            hub.source_operations.get_or_create_source(source_name)
            return source_name
        
        else:
            print("⚠️  Invalid choice. Using 'default'...")
            return "default"
            
    except Exception as e:
        print(f"⚠️  Error managing source: {e}")
        print("Using 'default' source...")
        return "default"


def get_or_select_side() -> str:
    """
    Get side name from user - either select existing or create new
    
    Returns:
        Side name string
    """
    try:
        from database.managers.hub import get_database_hub
        hub = get_database_hub()
        hub.initialize()
        
        print("\n" + "="*70)
        print("📋 SIDE SELECTION")
        print("="*70)
        print("Options:")
        print("  1. List existing sides")
        print("  2. Search sides")
        print("  3. Create new side")
        print("  4. Enter side name directly")
        print("="*70)
        
        choice = input("\nEnter your choice (1-4): ").strip()
        
        if choice == "1":
            # List all sides
            sides = hub.side_operations.list_sides(limit=20)
            if not sides:
                print("\n⚠️  No sides found. Creating new side...")
                side_name = input("Enter new side name: ").strip()
                if side_name:
                    hub.side_operations.get_or_create_side(side_name)
                    return side_name
                return "default"
            
            print("\n📋 Available Sides:")
            for i, side in enumerate(sides, 1):
                print(f"  {i}. {side['name']} (ID: {side['id']}, Importance: {side['importance']})")
            
            side_choice = input("\nEnter side number or name: ").strip()
            
            # Try to parse as number
            try:
                idx = int(side_choice) - 1
                if 0 <= idx < len(sides):
                    return sides[idx]['name']
            except ValueError:
                pass
            
            # Try to find by name
            for side in sides:
                if side['name'].lower() == side_choice.lower():
                    return side['name']
            
            print(f"⚠️  Side '{side_choice}' not found. Using it as new side name...")
            hub.side_operations.get_or_create_side(side_choice)
            return side_choice
        
        elif choice == "2":
            # Search sides
            search_term = input("Enter search term: ").strip()
            if search_term:
                sides = hub.side_operations.list_sides(search_term=search_term, limit=20)
                if not sides:
                    print(f"\n⚠️  No sides found matching '{search_term}'. Creating new side...")
                    side_name = input("Enter new side name: ").strip() or search_term
                    hub.side_operations.get_or_create_side(side_name)
                    return side_name
                
                print(f"\n📋 Search Results for '{search_term}':")
                for i, side in enumerate(sides, 1):
                    print(f"  {i}. {side['name']} (ID: {side['id']}, Importance: {side['importance']})")
                
                side_choice = input("\nEnter side number or name: ").strip()
                
                try:
                    idx = int(side_choice) - 1
                    if 0 <= idx < len(sides):
                        return sides[idx]['name']
                except ValueError:
                    pass
                
                for side in sides:
                    if side['name'].lower() == side_choice.lower():
                        return side['name']
                
                print(f"⚠️  Side '{side_choice}' not found. Using it as new side name...")
                hub.side_operations.get_or_create_side(side_choice)
                return side_choice
            else:
                return get_or_select_side()  # Retry
        
        elif choice == "3":
            # Create new side
            side_name = input("Enter new side name: ").strip()
            if not side_name:
                print("⚠️  Empty name. Using 'default'...")
                return "default"
            
            # Optional: ask for importance
            try:
                importance_input = input("Importance (0.0-1.0, default 0.5): ").strip()
                importance = float(importance_input) if importance_input else 0.5
                importance = max(0.0, min(1.0, importance))  # Clamp to 0-1
            except ValueError:
                importance = 0.5
            
            hub.side_operations.get_or_create_side(side_name, importance=importance)
            print(f"✅ Side '{side_name}' created successfully!")
            return side_name
        
        elif choice == "4":
            # Direct input
            side_name = input("Enter side name: ").strip()
            if not side_name:
                return "default"
            
            # Try to get or create
            hub.side_operations.get_or_create_side(side_name)
            return side_name
        
        else:
            print("⚠️  Invalid choice. Using 'default'...")
            return "default"
            
    except Exception as e:
        print(f"⚠️  Error managing side: {e}")
        print("Using 'default' side...")
        return "default"


# ============================================================================
# MAIN APPLICATION
# ============================================================================

def main():
    """Main application entry point"""
    
    # Start action recording
    log_file = start_action_recording()
    record_command_line_action("SYSTEM", "Application started", {"log_file": str(log_file)})
    print(f"📝 Action recording started: {log_file}\n")
    
    # Display mode
    mode = "THREADED" if USE_THREADING else "SEQUENTIAL"
    print(f"🔧 Processing Mode: {mode}")
    if USE_THREADING:
        print(f"   Workers: {MAX_WORKERS}")
        print(f"   Monitoring: {'Enabled' if ENABLE_MONITORING else 'Disabled'}")
    print()
    
    try:
        # STEP 1: Get file/folder path from user
        print("="*70)
        print("📂 STEP 1: FILE/FOLDER PATH")
        print("="*70)
        input_path_user = input("Enter file or folder path: ").strip()
        input_path_user = input_path_user.strip('"').strip("'")
        
        record_command_line_action("USER_INPUT", "User entered path", {"path": input_path_user})
        
        if not os.path.exists(input_path_user):
            error_msg = f"Path does not exist: {input_path_user}"
            print(f"\n✗ Error: {error_msg}")
            record_command_line_action("ERROR", error_msg, {"path": input_path_user}, level="ERROR")
            return
        
        # STEP 2: Get source from user
        storage_source = get_or_select_source()
        record_command_line_action("USER_INPUT", "User selected source", {"source": storage_source})
        
        # STEP 3: Get side from user
        storage_side = get_or_select_side()
        record_command_line_action("USER_INPUT", "User selected side", {"side": storage_side})
        
        # Display final configuration
        print("\n" + "="*70)
        print("⚙️  CONFIGURATION SUMMARY")
        print("="*70)
        print(f"Path:   {input_path_user}")
        print(f"Source: {storage_source}")
        print(f"Side:   {storage_side}")
        print(f"Mode:   {mode}")
        if USE_THREADING:
            print(f"Workers: {MAX_WORKERS}")
        print("="*70)
        print()
        
        # Confirm before proceeding
        confirm = input("Proceed with processing? (Y/n): ").strip().lower()
        if confirm and confirm != 'y':
            print("❌ Processing cancelled by user.")
            return
        
        # PROCESS BASED ON TYPE
        if os.path.isfile(input_path_user): 
            print(f"\n📄 Processing file: {input_path_user}\n")
            print(f"💾 Storage: Source='{storage_source}', Side='{storage_side}'\n")
            record_command_line_action("FILE_OP", "Detected file type", {
                "path": input_path_user, 
                "type": "FILE",
                "source": storage_source,
                "side": storage_side
            })
            
            # Choose processing mode
            if USE_THREADING:
                result = main_read_file_threaded(
                    input_path_user,
                    storage_source=storage_source,
                    storage_side=storage_side
                )
            else:
                result = main_read_file_sequential(input_path_user)
                
            if result:
                print("\n✓ File processed and stored successfully!")
        
        elif os.path.isdir(input_path_user):
            print(f"\n📁 Processing folder: {input_path_user}\n")
            print(f"💾 Storage: Source='{storage_source}', Side='{storage_side}'\n")
            record_command_line_action("FILE_OP", "Detected folder type", {
                "path": input_path_user, 
                "type": "DIRECTORY",
                "source": storage_source,
                "side": storage_side
            })
            
            # Choose processing mode
            if USE_THREADING:
                results = main_read_folder_threaded(
                    input_path_user,
                    storage_source=storage_source,
                    storage_side=storage_side
                )
            else:
                results = main_read_folder_sequential(
                    input_path_user,
                    storage_source=storage_source,
                    storage_side=storage_side
                )
                
            print(f"\n✓ Processed and stored {len(results)} files")
            
        else:
            error_msg = f"Invalid path type: {input_path_user}"
            print(f"\n✗ Error: {error_msg}")
            record_command_line_action("ERROR", error_msg, {"path": input_path_user}, level="ERROR")
            return
    
    finally:
        # Stop recording when done
        stop_action_recording()
        if is_recording_enabled():
            print(f"\n📝 Action recording stopped. Log saved to: {log_file}")
        # Ensure shared concurrency managers are shut down cleanly
        try:
            hub.shutdown_all()
        except Exception as shutdown_error:
            logger.error(f"Error shutting down concurrency hub: {shutdown_error}")


if __name__ == "__main__":
    try:
        main()
    
    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Exiting...")
        record_command_line_action("SYSTEM", "Application interrupted by user", {}, level="WARNING")
        stop_action_recording()
        input("\nPress Enter to exit...")
        
    except Exception as e:
        print(f"\n✗ Unexpected error: {str(e)}")
        import traceback
        error_trace = traceback.format_exc()
        record_command_line_action(
            "ERROR", 
            f"Unexpected error: {str(e)}", 
            {"error": str(e), "traceback": error_trace}, 
            level="ERROR"
        )
        traceback.print_exc()
        stop_action_recording()
        input("\nPress Enter to exit...")