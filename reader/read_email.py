"""
Email file readers - Enhanced Version
- Supports all file sizes and types
- Merges all message content into single message
- Preserves attachment extraction logic
"""

from email import policy
import email
from email.parser import BytesParser
import json
import os
from pathlib import Path
from core.detect_binanry_utils import detect_file_type , get_filename_with_correct_extension
from core.file_utils import sanitize_filename
from core.path_utils import get_extraction_name_file


def extensions_type_extract():
    """Return set of supported email extensions"""
    from core.extension_registry import get_extensions_for
    return get_extensions_for('email')


def specify_email_method_of_reading_the_file(file_info, logger=None):
    file_path = file_info.get("path")
    
    if not file_path or not os.path.exists(file_path):
        print(f"✗ File not found: {file_path}")
        return {"error": "File not found", "path": file_path}
    
    file_path = str(file_path)
    file_lower = file_path.lower()
    
    try:
        result = None
        
        if file_lower.endswith('.msg'):
            result = extract_msg(file_path)
            if result and 'error' not in result:
                result["email_type"] = "msg"
                
        elif file_lower.endswith('.eml'):
            result = extract_eml(file_path)
            if result and 'error' not in result:
                result["email_type"] = "eml"
            
        elif file_lower.endswith('.mbox'):
            result = extract_mbox(file_path)
            if result and 'error' not in result:
                result["email_type"] = "mbox"
                
        elif file_lower.endswith('.pst'):
            result = extract_pst_pypff(file_path)
            if result and 'error' not in result:
                result["email_type"] = "pst"
        else:
            print(f"✗ Unsupported file type: {file_path}")
            result = {"error": "Unsupported email type", "path": file_path}
        
        # If extraction failed, ensure we have an error result
        if not result or 'error' in result:
            if not result:
                result = {"error": "Email extraction failed", "path": file_path}
        
        return result
        
    except Exception as e:
        print(f"✗ Error processing {file_path}: {str(e)}")
        return {"error": str(e), "path": file_path}


def extract_eml(filepath):
    """
    Extract EML file with complete separation:
    - Message content returned directly with metadata (no file created)
    - ALL content parts merged into single message
    - Attachments saved as separate physical files for independent processing
    Returns dict with message data and extraction path for attachments
    """
    try:
        if not os.path.exists(filepath):
            return {"error": "File not found", "filepath": filepath}

        with open(filepath, 'rb') as f:
            msg = BytesParser(policy=policy.default).parse(f)

        # Create extraction folder for attachments only
        extract_to = get_extraction_name_file(filepath, '.eml')
        os.makedirs(extract_to, exist_ok=True)

        # -----------------------------------------
        # 1. EXTRACT MESSAGE METADATA + ALL BODY CONTENT (MERGED)
        # -----------------------------------------
        message = {
            "source_filepath": filepath,
            "from": msg.get('From', ''),
            "to": msg.get('To', ''),
            "subject": msg.get('Subject', ''),
            "date": msg.get('Date', ''),
            "cc": msg.get('Cc', ''),
            "bcc": msg.get('Bcc', ''),
            "message_id": msg.get('Message-ID', ''),
            "content": ""  # Single merged content string
        }

        # Collect all text content parts
        content_parts = []
        
        for part in msg.walk():
            content_type = part.get_content_type()
            
            # Only process text content (not attachments)
            if content_type in ['text/plain', 'text/html']:
                disposition = part.get_content_disposition()
                # Skip if it's an attachment
                if disposition not in ['attachment', 'inline']:
                    try:
                        raw_content = part.get_payload(decode=True)
                        if raw_content:
                            text_content = raw_content.decode('utf-8', errors='ignore')
                            
                            # Convert HTML to plaintext if needed
                            if content_type == "text/html":
                                try:
                                    import html2text
                                    text_content = html2text.html2text(text_content)
                                except ImportError:
                                    import re
                                    text_content = re.sub('<[^<]+?>', '', text_content)
                            
                            if text_content.strip():
                                content_parts.append(text_content.strip())
                    except Exception as e:
                        print(f"  ⚠ Could not decode text part: {str(e)}")
                        continue

        # Merge all content parts with double newline separator
        message["content"] = "\n\n".join(content_parts) if content_parts else ""

        # -----------------------------------------
        # 2. EXTRACT ATTACHMENTS AS SEPARATE FILES
        # -----------------------------------------
        attachment_count = 0

        for part in msg.walk():
            disposition = part.get_content_disposition()

            if disposition in ['attachment', 'inline']:
                original_filename = part.get_filename() or "unnamed"
                payload = part.get_payload(decode=True)

                if not payload:
                    continue

                # Detect correct file type and update filename
                filename = sanitize_filename(original_filename)
                filename = get_filename_with_correct_extension(filename, payload)

                # Save attachment as physical file
                filepath = os.path.join(extract_to, filename)
                
                # Handle duplicate filenames
                counter = 1
                base_name = Path(filename).stem
                extension = Path(filename).suffix
                while os.path.exists(filepath):
                    filename = f"{base_name}_{counter}{extension}"
                    filepath = os.path.join(extract_to, filename)
                    counter += 1

                # Write attachment to disk
                with open(filepath, 'wb') as f:
                    f.write(payload)
                
                attachment_count += 1
                detected_type = detect_file_type(payload)
                if original_filename != filename:
                    print(f"  ✓ Saved attachment: {filename} ({len(payload)} bytes) [detected: {detected_type}]")
                else:
                    print(f"  ✓ Saved attachment: {filename} ({len(payload)} bytes)")

        # -----------------------------------------
        # RETURN MESSAGE DATA + EXTRACTION PATH
        # -----------------------------------------
        if attachment_count > 0:
            print(f"✓ Extracted {attachment_count} attachment(s) from {filepath}")
        else:
            print(f"✓ No attachments found in {filepath}")
        
        if attachment_count > 0:
            print(f"✓ Attachments saved to: {extract_to}/")
        
        return {
            "message": message,                    # Message content with metadata (merged content)
            "extraction_path": extract_to,         # Path to attachments folder
            "attachment_count": attachment_count,
            "has_attachments": attachment_count > 0
        }

    except Exception as e:
        print(f"✗ Error extracting {filepath}: {str(e)}")
        return {"error": str(e), "filepath": filepath}


def extract_msg(file_path):
    """
    Extract MSG file with complete separation:
    - Message metadata returned directly with merged content
    - Attachments saved as separate physical files for processing
    """
    try:
        import extract_msg
    except ImportError:
        print("⚠ extract-msg not installed. Install with: pip install extract-msg")
        return {"error": "extract-msg package not installed"}
    
    extract_to = get_extraction_name_file(file_path, '.msg')
    os.makedirs(extract_to, exist_ok=True)
    
    try:
        msg = extract_msg.Message(file_path)
        

        content_parts = []
        
        # Add main body
        if msg.body:
            content_parts.append(msg.body.strip())
        
        # Add HTML body if different (converted to text)
        if hasattr(msg, 'htmlBody') and msg.htmlBody:
            try:
                import html2text
                html_text = html2text.html2text(msg.htmlBody)
                if html_text.strip() and html_text.strip() != content_parts[0] if content_parts else True:
                    content_parts.append(html_text.strip())
            except Exception:
                pass
        
        message = {
            "source_filepath": file_path,
            "from": msg.sender or '',
            "to": msg.to or '',
            "subject": msg.subject or '',
            "date": msg.date or '',
            "cc": msg.cc or '',
            "bcc": msg.bcc or '',
            "content": "\n\n".join(content_parts) if content_parts else ""
        }
        
        # -----------------------------------------
        # 2. SAVE ATTACHMENTS AS SEPARATE FILES
        # -----------------------------------------
        attachment_count = 0
        
        for attachment in msg.attachments:
            original_filename = attachment.longFilename or attachment.shortFilename or "unnamed"
            filename = sanitize_filename(original_filename)
            
            # Detect correct file type and update filename
            filename = get_filename_with_correct_extension(filename, attachment.data)
            
            filepath = os.path.join(extract_to, filename)
            
            counter = 1
            base_name = Path(filename).stem
            extension = Path(filename).suffix
            while os.path.exists(filepath):
                filename = f"{base_name}_{counter}{extension}"
                filepath = os.path.join(extract_to, filename)
                counter += 1
            
            with open(filepath, 'wb') as f:
                f.write(attachment.data)
            attachment_count += 1
            detected_type = detect_file_type(attachment.data)
            if original_filename != filename:
                print(f"  ✓ Saved attachment: {filename} [detected: {detected_type}]")
            else:
                print(f"  ✓ Saved attachment: {filename}")
        
        msg.close()
        
        if attachment_count > 0:
            print(f"✓ Extracted {attachment_count} attachment(s) from {file_path}")
            print(f"✓ Attachments saved to: {extract_to}/")
        else:
            print(f"✓ No attachments found in {file_path}")
        
        return {
            "message": message,
            "extraction_path": extract_to,
            "attachment_count": attachment_count,
            "has_attachments": attachment_count > 0
        }
        
    except Exception as e:
        print(f"✗ Error extracting {file_path}: {str(e)}")
        return {"error": str(e), "filepath": file_path}


def extract_mbox(file_path):
    """
    Extract MBOX file with complete separation:
    - Each message's metadata returned with merged content
    - Attachments saved as separate physical files in subfolders
    """
    import mailbox
    
    extract_to = get_extraction_name_file(file_path, '.mbox')
    os.makedirs(extract_to, exist_ok=True)
    
    total_attachments = 0
    messages_data = []
    
    try:
        mbox = mailbox.mbox(file_path)
        
        for idx, message in enumerate(mbox):
            subject = message.get('Subject', 'No Subject')
            safe_subject = sanitize_filename(subject)[:50]
            
            message_folder = os.path.join(extract_to, f"msg_{idx:03d}_{safe_subject}")
            
            # -----------------------------------------
            # 1. EXTRACT MESSAGE METADATA + MERGED BODY CONTENT
            # -----------------------------------------
            content_parts = []
            
            # Extract all text content
            for part in message.walk():
                if part.get_content_type() in ['text/plain', 'text/html']:
                    disposition = part.get_content_disposition()
                    # Skip attachments
                    if disposition not in ['attachment', 'inline']:
                        try:
                            content = part.get_payload(decode=True)
                            if content:
                                text_content = content.decode('utf-8', errors='ignore')
                                
                                # Convert HTML to plain text
                                if part.get_content_type() == 'text/html':
                                    try:
                                        import html2text
                                        text_content = html2text.html2text(text_content)
                                    except ImportError:
                                        import re
                                        text_content = re.sub('<[^<]+?>', '', text_content)
                                
                                if text_content.strip():
                                    content_parts.append(text_content.strip())
                        except Exception as e:
                            continue
            
            msg_data = {
                "source_filepath": file_path,
                "message_index": idx,
                "from": message.get('From', ''),
                "to": message.get('To', ''),
                "subject": subject,
                "date": message.get('Date', ''),
                "cc": message.get('Cc', ''),
                "message_id": message.get('Message-ID', ''),
                "content": "\n\n".join(content_parts) if content_parts else ""
            }
            
            # -----------------------------------------
            # 2. SAVE ATTACHMENTS AS SEPARATE FILES
            # -----------------------------------------
            message_attachment_count = 0
            for part in message.walk():
                if part.get_content_disposition() in ['attachment', 'inline']:
                    original_filename = part.get_filename()
                    if original_filename:
                        # Create message folder only if it has attachments
                        if message_attachment_count == 0:
                            os.makedirs(message_folder, exist_ok=True)
                        
                        payload = part.get_payload(decode=True)
                        if not payload:
                            continue
                        
                        filename = sanitize_filename(original_filename)
                        # Detect correct file type and update filename
                        filename = get_filename_with_correct_extension(filename, payload)
                        
                        filepath = os.path.join(message_folder, filename)
                        
                        counter = 1
                        base_name = Path(filename).stem
                        extension = Path(filename).suffix
                        while os.path.exists(filepath):
                            filename = f"{base_name}_{counter}{extension}"
                            filepath = os.path.join(message_folder, filename)
                            counter += 1
                        
                        with open(filepath, 'wb') as f:
                            f.write(payload)
                        message_attachment_count += 1
                        total_attachments += 1
            
            # Add attachment info to message data
            msg_data["attachment_count"] = message_attachment_count
            msg_data["has_attachments"] = message_attachment_count > 0
            if message_attachment_count > 0:
                msg_data["attachments_folder"] = message_folder
            
            messages_data.append(msg_data)
        
        if total_attachments > 0:
            print(f"✓ Extracted {total_attachments} attachment(s) from {file_path}")
            print(f"✓ Attachments saved to: {extract_to}/")
        else:
            print(f"✓ No attachments found in {file_path}")
        
        return {
            "messages": messages_data,
            "extraction_path": extract_to,
            "total_messages": len(messages_data),
            "total_attachments": total_attachments
        }
        
    except Exception as e:
        print(f"✗ Error extracting {file_path}: {str(e)}")
        return {"error": str(e), "filepath": file_path}

def extract_pst_pypff(file_path):
    """
    Extract PST file with message content extraction:
    - Message metadata and merged content extracted
    - Attachments saved as separate physical files for processing
    - Fixed to prevent attachment loss
    """
    try:
        import pypff
    except ImportError:
        print("✗ pypff library not installed. Install with: pip install libpff-python")
        return {"error": "pypff package not installed"}
    
    extract_to = get_extraction_name_file(file_path, '.pst')
    os.makedirs(extract_to, exist_ok=True)
    
    total_attachments = 0
    attachment_counter = 0
    messages_data = []
    message_counter = 0
    
    try:
        pst = pypff.file()
        pst.open(file_path)
        root = pst.get_root_folder()

        # Optional: RTF conversion
        try:
            from striprtf.striprtf import rtf_to_text
            STRIP_RTF_AVAILABLE = True
        except ImportError:
            STRIP_RTF_AVAILABLE = False
            print("⚠ striprtf not installed. RTF bodies will be skipped.")

        import html2text
        h2t = html2text.HTML2Text()
        h2t.ignore_links = True

        def process_folder(folder):
            nonlocal total_attachments, attachment_counter, message_counter
            
            # Process messages
            for i in range(folder.get_number_of_sub_messages()):
                if message_counter >= 50000000:
                    return

                try:
                    message = folder.get_sub_message(i)
                except Exception as e:
                    print(f"⚠ Cannot access message {i}: {e}")
                    continue

                message_counter += 1

                # --- Metadata extraction ---
                try:
                    from_name = message.get_sender_name() or message.get_sender_email_address() or ""
                except Exception:
                    from_name = ""
                try:
                    to_name = message.get_transport_headers() or message.get_recipient_name() or ""
                except Exception:
                    to_name = ""
                try:
                    subject = message.get_subject() or ""
                except Exception:
                    subject = ""
                try:
                    date = str(message.get_delivery_time() or "")
                except Exception:
                    date = ""

                msg_data = {
                    "source_filepath": file_path,
                    "message_index": message_counter,
                    "from": from_name,
                    "to": to_name,
                    "subject": subject,
                    "date": date,
                    "content": "",
                    "attachment_count": 0,
                    "has_attachments": False
                }

                recipients = []
                try:
                    for i in range(message.get_number_of_recipients()):
                        recipient = message.get_recipient(i)
                        if recipient:
                            name = recipient.get_name() or recipient.get_email_address() or ""
                            recipients.append(name)
                except Exception:
                    pass
                # --- Body extraction ---
                content_parts = []

                # Plain text
                try:
                    body = message.get_plain_text_body()
                    if isinstance(body, bytes):
                        body = body.decode(errors="replace")
                    if body and body.strip():
                        content_parts.append(body.strip())
                except Exception as e:
                    print(f"⚠ Plain text error (msg {message_counter}): {e}")

                # HTML
                try:
                    body = message.get_html_body()
                    if isinstance(body, bytes):
                        body = body.decode(errors="replace")
                    if body and body.strip():
                        text = h2t.handle(body).strip()
                        if text and (not content_parts or text != content_parts[0]):
                            content_parts.append(text)
                except Exception as e:
                    print(f"⚠ HTML error (msg {message_counter}): {e}")

                # RTF
                if STRIP_RTF_AVAILABLE:
                    try:
                        body = message.get_rtf_body()
                        if isinstance(body, bytes):
                            body = body.decode(errors="replace")
                        if body and body.strip():
                            text = rtf_to_text(body).strip()
                            if text:
                                content_parts.append(text)
                    except Exception as e:
                        print(f"⚠ RTF error (msg {message_counter}): {e}")

                msg_data["content"] = "\n\n".join(content_parts) if content_parts else ""
                msg_data["to"] = ", ".join(recipients)


                message_attachment_count = 0
                
                try:
                    num_attachments = message.get_number_of_attachments()
                except Exception:
                    num_attachments = 0
                
                if num_attachments > 0:
                    for j in range(num_attachments):
                        try:
                            attachment = message.get_attachment(j)
                            attachment_counter += 1
                            
                            data = None
                            try:
                                data = attachment.read_buffer(attachment.get_size())
                            except Exception:
                                try:
                                    data = attachment.read()
                                except Exception:
                                    try:
                                        data = attachment.data
                                    except Exception:
                                        print(f"  ⚠ Could not read data for attachment {attachment_counter}")
                                        continue
                            
                            if not data:
                                continue
                            
                            # Get original filename before processing
                            original_filename = None
                            try:
                                original_filename = attachment.get_name()
                            except Exception:
                                pass
                            
                            if not original_filename:
                                extension = detect_file_type(data)
                                filename = f"attachment_{attachment_counter:05d}{extension}"
                            else:
                                filename = sanitize_filename(original_filename)
                                # Always detect and correct the extension based on actual file content
                                filename = get_filename_with_correct_extension(filename, data)
                            
                            filepath = os.path.join(extract_to, filename)
                            
                            counter = 1
                            base_name = Path(filename).stem
                            extension = Path(filename).suffix
                            while os.path.exists(filepath):
                                filename = f"{base_name}_{counter}{extension}"
                                filepath = os.path.join(extract_to, filename)
                                counter += 1
                            
                            with open(filepath, 'wb') as f:
                                f.write(data)
                            total_attachments += 1
                            message_attachment_count += 1
                            detected_type = detect_file_type(data)
                            # Show detection info if filename was changed
                            if original_filename and filename != original_filename:
                                print(f"  Extracted: {filename} ({len(data)} bytes) [detected: {detected_type}, was: {Path(original_filename).suffix or 'no ext'}]")
                            else:
                                print(f"  Extracted: {filename} ({len(data)} bytes)")
                            
                        except Exception as e:
                            print(f"  ⚠ Could not extract attachment {attachment_counter}: {str(e)[:80]}")
                            continue
                
                # Add attachment info to message data
                msg_data["attachment_count"] = message_attachment_count
                msg_data["has_attachments"] = message_attachment_count > 0
                
                messages_data.append(msg_data)
            
            # Process subfolders
            for i in range(folder.get_number_of_sub_folders()):
                try:
                    subfolder = folder.get_sub_folder(i)
                    process_folder(subfolder)
                except Exception:
                    continue
        
        print(f"Processing PST file: {file_path}")
        print(f"Extracting to: {extract_to}/")
        print()
        process_folder(root)
        pst.close()
        
        print()
        if total_attachments > 0:
            print(f"✓ Successfully extracted {total_attachments} attachment(s)")
            print(f"✓ Saved to: {extract_to}/")
        else:
            print(f"✓ No attachments found in {file_path}")
        
        print(f"✓ Processed {message_counter} message(s)")
        
        return {
            "messages": messages_data,
            "extraction_path": extract_to,
            "total_messages": message_counter,
            "attachment_count": total_attachments,
            "has_attachments": total_attachments > 0
        }
    
    except Exception as e:
        print(f"✗ pypff Error: {str(e)[:200]}")
        return {"error": str(e), "filepath": file_path}
    
    