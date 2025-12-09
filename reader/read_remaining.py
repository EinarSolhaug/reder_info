import os


def extensions_type_extract():
    """Return set of supported remaining file extensions - supports ALL text-based files"""
    from core.extension_registry import get_extensions_for
    return get_extensions_for('remaining')


def specify_remaining_method_of_reading_the_file(file_info, logger=None):

    if not os.path.exists(file_info["path"]):
        print(f"✗ File not found: {file_info['path']}")
        # print(msg)
        # if logger:
        #     logger.error("Remaining-type file not found", file_path=file_info["path"])
        return None
    
    file_path = str(file_info["path"])
    file_lower = file_path.lower()
    
    try:
        if file_lower.endswith('.json'):
            return read_json_file(file_path)
        elif file_lower.endswith('.xml'):
            return read_xml_file(file_path)
        elif file_lower.endswith('.txt') :
            # Treat plain text and RTF as text; RTF control words will still appear
            return read_text_file(file_path)
        elif file_lower.endswith(('.yaml', '.yml')):
            return read_yaml_file(file_path)
        elif file_lower.endswith(('.html', '.htm')):
            return read_html_file(file_path)
        elif file_lower.endswith('.bin'):
            return read_binary_file(file_path)
        
        else:
            print(f"✗ Unsupported file type: {file_path}")
            # print(msg)
            # if logger:
            #     logger.warning("Unsupported remaining file type", file_path=file_path)
            return None
    except Exception as e:
        print(f"✗ Error reading {file_path}: {str(e)}")
        # print(msg)
        # if logger:
        #     logger.error("Error reading remaining-type file", file_path=file_path, error=str(e))
        return None


# ============================================================================
# JSON READER - No dependencies
# ============================================================================

def read_json_file(filepath, encoding='utf-8'):

    try:
        import json
        
        if not os.path.exists(filepath):
            return {"error": "File not found", "filepath": filepath}
        
        with open(filepath, 'r', encoding=encoding) as file:
            data = json.load(file)
        
        result = {
            "filepath": filepath,
            "data": data,
            "data_type": type(data).__name__
        }
        
        # Add some basic statistics
        if isinstance(data, dict):
            result["key_count"] = len(data)
            result["keys"] = list(data.keys())
        elif isinstance(data, list):
            result["item_count"] = len(data)
        
        return result
    except Exception as e:
        return {"error": str(e), "filepath": filepath}


# ============================================================================
# XML READER - No dependencies
# ============================================================================

def read_xml_file(filepath, encoding='utf-8'):

    try:
        import xml.etree.ElementTree as ET
        
        if not os.path.exists(filepath):
            return {"error": "File not found", "filepath": filepath}
        
        tree = ET.parse(filepath)
        root = tree.getroot()
        
        def element_to_dict(element):
            """Convert XML element to dictionary"""
            elem_dict = {
                "tag": element.tag,
                "attributes": element.attrib,
                "text": element.text.strip() if element.text and element.text.strip() else None,
                "children": []
            }
            
            for child in element:
                elem_dict["children"].append(element_to_dict(child))
            
            return elem_dict
        
        result = {
            "filepath": filepath,
            "root_tag": root.tag,
            "root_attributes": root.attrib,
            "tree": element_to_dict(root)
        }
        
        return result
    except Exception as e:
        return {"error": str(e), "filepath": filepath}


# ============================================================================
# TEXT READER - No dependencies
# ============================================================================

def read_text_file(filepath, encoding='utf-8'):

    try:
        if not os.path.exists(filepath):
            return {"error": "File not found", "filepath": filepath}
        
        # Try different encodings if utf-8 fails
        encodings = [encoding, 'utf-8', 'latin-1', 'cp1252']
        content = None
        encoding_used = None
        
        for enc in encodings:
            try:
                with open(filepath, 'r', encoding=enc) as file:
                    content = file.read()
                encoding_used = enc
                break
            except UnicodeDecodeError:
                if enc == encodings[-1]:
                    raise
                continue
        
        if content is None:
            return {"error": "Could not decode file with any encoding", "filepath": filepath}
        
        lines = content.splitlines()
        
        result = {
            "filepath": filepath,
            "content": content,
            "lines": lines,
            "line_count": len(lines),
            "character_count": len(content),
            "word_count": len(content.split()),
            "non_empty_lines": len([l for l in lines if l.strip()]),
            "encoding_used": encoding_used
        }
        # print(result)
        return result
    except Exception as e:
        return {"error": str(e), "filepath": filepath}


# ============================================================================
# YAML READER - Requires PyYAML
# ============================================================================

def read_yaml_file(filepath, encoding='utf-8'):

    try:
        import yaml
    except ImportError:
        return {
            "error": "PyYAML not installed. Install with: pip install pyyaml",
            "filepath": filepath
        }
    
    try:
        if not os.path.exists(filepath):
            return {"error": "File not found", "filepath": filepath}
        
        with open(filepath, 'r', encoding=encoding) as file:
            data = yaml.safe_load(file)
        
        result = {
            "filepath": filepath,
            "data": data,
            "data_type": type(data).__name__
        }
        
        if isinstance(data, dict):
            result["key_count"] = len(data)
            result["keys"] = list(data.keys())
        elif isinstance(data, list):
            result["item_count"] = len(data)
        
        return result
    except Exception as e:
        return {"error": str(e), "filepath": filepath}


# ============================================================================
# HTML READER - Requires beautifulsoup4
# ============================================================================

def read_html_file(filepath, encoding='utf-8'):

    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return {
            "error": "beautifulsoup4 not installed. Install with: pip install beautifulsoup4",
            "filepath": filepath
        }
    
    try:
        if not os.path.exists(filepath):
            return {"error": "File not found", "filepath": filepath}
        
        with open(filepath, 'r', encoding=encoding) as file:
            content = file.read()
        
        soup = BeautifulSoup(content, 'html.parser')
        
        result = {
            "filepath": filepath,
            "title": soup.title.string if soup.title else None,
            "text_content": soup.get_text(),
            "links": [{"href": a.get('href'), "text": a.get_text()} for a in soup.find_all('a', href=True)],
            "images": [{"src": img.get('src'), "alt": img.get('alt')} for img in soup.find_all('img')],
            "headings": {
                "h1": [h.get_text() for h in soup.find_all('h1')],
                "h2": [h.get_text() for h in soup.find_all('h2')],
                "h3": [h.get_text() for h in soup.find_all('h3')]
            },
            "link_count": len(soup.find_all('a', href=True)),
            "image_count": len(soup.find_all('img'))
        }
        
        return result
    except Exception as e:
        return {"error": str(e), "filepath": filepath}


# ============================================================================
# BINARY FILE READER - No dependencies
# ============================================================================

def read_binary_file(filepath, max_bytes=1024):

    try:
        if not os.path.exists(filepath):
            return {"error": "File not found", "filepath": filepath}
        
        file_size = os.path.getsize(filepath)
        
        with open(filepath, 'rb') as file:
            data = file.read(max_bytes)
        
        result = {
            "filepath": filepath,
            "file_size": file_size,
            "bytes_read": len(data),
            "hex_preview": data.hex()[:500],  # First 500 hex characters
            "first_bytes": list(data[:50])  # First 50 bytes as integers
        }
        
        return result
    except Exception as e:
        return {"error": str(e), "filepath": filepath}
