"""
Content Processor Module
Handles text extraction, tokenization, and entity recognition.
"""

import re
from typing import List, Tuple, Dict, Set
from collections import Counter

from database.processors.validation_processor import ValidationProcessor


class ContentProcessor:
    """
    Processes file content for storage and indexing.
    Handles text extraction, tokenization, and entity recognition.
    """
    
    def __init__(self):
        """Initialize content processor"""
        # Special patterns for entities that should be preserved whole
        self.patterns = {
            # ISO date pattern: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
            'date_iso': re.compile(r'\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b'),
            
            # Comprehensive date pattern
            'date': re.compile(r"""
                \b(?:
                    # Numerical Dates (Natural Forms)
                    \d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4} |
                    \d{2,4}[/\-\.]\d{1,2}[/\-\.]\d{1,2} |
                    \d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2} |
                    # Written Dates (Natural Forms)
                    \d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4} |
                    (?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4} |
                    \d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4} |
                    # ISO Dates and Times (Natural Formats)
                    \d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)? |
                    \d{4}/\d{2}/\d{2}(?:\s+\d{2}:\d{2}:\d{2})?
                )\b
            """, re.IGNORECASE | re.VERBOSE),
            
            # Email pattern
            'email': re.compile(
                r'([a-zA-Z0-9](?:[a-zA-Z0-9._%+-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+)',
                re.IGNORECASE
            ),
            
            # URL with protocol
            'url': re.compile(
                r'\b(?:https?|ftp|ftps|file)://(?:[^\s<>"{}|\\`\[\]]+|\[[0-9a-fA-F:]+\])(?:/[^\s<>"{}|\\^`\[\]]*)?',
                re.IGNORECASE
            ),
            
            # URL without protocol
            'url_no_protocol': re.compile(
                r'\b(?:www\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?::\d+)?(?:/[^\s<>"{}|\\^`\[\]]*)?',
                re.IGNORECASE
            ),
            
            # Domain pattern
            'domain': re.compile(
                r'\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b',
                re.IGNORECASE
            ),
        }
        
        # Pattern matching order (most specific first)
        self.pattern_order = ['url', 'email', 'date', 'date_iso', 'url_no_protocol', 'domain']
        
        # Regular word pattern (fallback)
        self.word_pattern = re.compile(r'\b[\w\'-]+\b', re.UNICODE)
    
    def extract_words_with_punctuation(
        self, 
        text: str, 
        chunk_size: int = 10000
    ) -> List[Tuple[str, str, str, str]]:
        """
        Extract words with surrounding punctuation metadata.
        Special entities (emails, URLs, dates, domains) are preserved as complete units.
        
        Returns: [(word, punct_before, punct_after, spacing), ...]
        
        Example:
            "Contact: user@example.com, visit www.site.com" → [
                ("Contact", "", ":", " "),
                ("user@example.com", "", ",", " "),
                ("visit", "", "", " "),
                ("www.site.com", "", "", "")
            ]
        """
        if not text:
            return []
        
        # CRITICAL: Sanitize text to remove NULL bytes and binary data
        text = ValidationProcessor.sanitize_text(text)
        
        tokens = []
        
        # Process in chunks for memory efficiency
        for i in range(0, len(text), chunk_size):
            chunk = text[i:i + chunk_size]
            tokens.extend(self._process_chunk_with_entities(chunk))
        
        return tokens
    
    def _process_chunk_with_entities(self, text: str) -> List[Tuple[str, str, str, str]]:
        """
        Process a single text chunk, preserving special entities
        
        Strategy:
        1. Find all special entities (emails, URLs, dates, domains)
        2. Mark their positions in the text
        3. Extract regular words from unmarked regions
        4. Merge and sort by position
        """
        # Find all special entities with their positions
        entities = []
        
        for pattern_name in self.pattern_order:
            pattern = self.patterns[pattern_name]
            
            for match in pattern.finditer(text):
                # Store: (start, end, matched_text, pattern_type)
                entities.append({
                    'start': match.start(),
                    'end': match.end(),
                    'text': match.group(0),
                    'type': pattern_name
                })
        
        # Sort entities by start position
        entities.sort(key=lambda x: x['start'])
        
        # Remove overlapping entities (keep first/longest)
        filtered_entities = self._remove_overlaps(entities)
        
        # Build tokens list
        tokens = []
        position = 0
        
        for entity in filtered_entities:
            # Process any regular text before this entity
            if position < entity['start']:
                regular_text = text[position:entity['start']]
                tokens.extend(self._extract_regular_words(regular_text, position))
            
            # Process the entity itself
            entity_token = self._create_entity_token(
                text,
                entity['text'],
                entity['start'],
                entity['end'],
                filtered_entities
            )
            
            if entity_token:
                tokens.append(entity_token)
            
            position = entity['end']
        
        # Process any remaining text after the last entity
        if position < len(text):
            remaining_text = text[position:]
            tokens.extend(self._extract_regular_words(remaining_text, position))
        
        return tokens
    
    def _create_entity_token(
        self,
        text: str,
        entity_text: str,
        start: int,
        end: int,
        all_entities: List[Dict]
    ) -> Tuple[str, str, str, str]:
        """
        Create a token for a special entity (email, URL, date, domain)
        
        Returns: (entity, punct_before, punct_after, spacing)
        """
        # Find punctuation before the entity
        punct_before = ""
        punct_start = start - 1
        
        while punct_start >= 0:
            char = text[punct_start]
            
            # Stop at word character or space
            if char.isalnum() or char.isspace():
                break
            
            punct_before = char + punct_before
            punct_start -= 1
        
        # Find punctuation after the entity and spacing
        punct_after = ""
        spacing = ""
        pos = end
        
        # First collect punctuation
        while pos < len(text):
            char = text[pos]
            
            # Stop at word character or space
            if char.isalnum() or char.isspace():
                break
            
            punct_after += char
            pos += 1
        
        # Then collect spacing
        while pos < len(text):
            char = text[pos]
            
            # Stop at non-space
            if not char.isspace():
                break
            
            spacing += char
            pos += 1
        
        return (entity_text.lower(), punct_before, punct_after, spacing)
    
    def _extract_regular_words(
        self, 
        text: str, 
        base_position: int
    ) -> List[Tuple[str, str, str, str]]:
        """Extract regular words from text that doesn't contain special entities"""
        tokens = []
        position = 0
        
        for match in self.word_pattern.finditer(text):
            word = match.group(0)
            start = match.start()
            end = match.end()
            
            # Extract punctuation before word
            punct_before = text[position:start]
            punct_before = self._normalize_punctuation(punct_before)
            
            # Look ahead for punctuation after word
            next_word_match = self.word_pattern.search(text, end)
            
            if next_word_match:
                punct_after_end = next_word_match.start()
            else:
                punct_after_end = len(text)
            
            after_text = text[end:punct_after_end]
            
            # Separate punctuation from spacing
            punct_after, spacing = self._separate_punctuation_and_spacing(after_text)
            
            tokens.append((
                word.lower(),
                punct_before,
                punct_after,
                spacing
            ))
            
            position = end
        
        return tokens
    
    def _normalize_punctuation(self, text: str) -> str:
        """
        Normalize punctuation:
        - Remove duplicate whitespace
        - Keep only punctuation marks
        - Remove NULL bytes and problematic characters
        """
        if not text:
            return ""
        
        # Remove NULL bytes and other control characters first
        text = text.replace('\x00', '')
        
        # Remove whitespace, keep only punctuation
        # Filter out control characters except common ones
        punct_only = ''.join(
            c for c in text 
            if not c.isspace() and (ord(c) >= 32 or ord(c) in (9, 10, 13))
        )
        
        return punct_only
    
    def _separate_punctuation_and_spacing(self, text: str) -> Tuple[str, str]:
        """
        Separate punctuation marks from spacing
        
        Example:
            "! " → ("!", " ")
            ", " → (",", " ")
            "  " → ("", "  ")
        """
        if not text:
            return ("", "")
        
        # Find where punctuation ends and spacing begins
        punct_end = 0
        for i, char in enumerate(text):
            if char.isspace():
                punct_end = i
                break
        else:
            # No spacing found
            return (text, "")
        
        punctuation = text[:punct_end]
        spacing = text[punct_end:]
        
        # Normalize punctuation
        punctuation = self._normalize_punctuation(punctuation)
        
        return (punctuation, spacing)
    
    def extract_words(self, text: str) -> List[str]:
        """
        Simple word extraction (no punctuation metadata).
        Preserves special entities. Used for title processing.
        """
        if not text:
            return []
        
        text = ValidationProcessor.sanitize_text(text)
        
        # Extract all entities
        entities = []
        
        for pattern_name in self.pattern_order:
            pattern = self.patterns[pattern_name]
            
            for match in pattern.finditer(text):
                entities.append({
                    'start': match.start(),
                    'end': match.end(),
                    'text': match.group(0)
                })
        
        # Sort and remove overlaps
        entities.sort(key=lambda x: x['start'])
        entities = self._remove_overlaps(entities)
        
        # Extract words
        words = []
        position = 0
        
        for entity in entities:
            # Extract regular words before entity
            if position < entity['start']:
                regular_text = text[position:entity['start']]
                regular_words = self.word_pattern.findall(regular_text)
                words.extend([w.lower() for w in regular_words])
            
            # Add entity as a single word
            words.append(entity['text'].lower())
            position = entity['end']
        
        # Extract remaining words
        if position < len(text):
            remaining_text = text[position:]
            regular_words = self.word_pattern.findall(remaining_text)
            words.extend([w.lower() for w in regular_words])
        
        return words
    
    def calculate_word_frequency(self, words: List[str]) -> Dict[str, int]:
        """Calculate word frequency"""
        return dict(Counter(words))
    
    def extract_n_grams(self, words: List[str], n: int = 2) -> List[Tuple[str, ...]]:
        """
        Extract n-grams from word list.
        
        Args:
            words: List of words
            n: N-gram size (default: 2 for bigrams)
            
        Returns:
            List of n-gram tuples
        """
        if len(words) < n:
            return []
        
        return [tuple(words[i:i+n]) for i in range(len(words) - n + 1)]
    
    def get_text_statistics(self, text: str) -> Dict[str, any]:
        """
        Get comprehensive text statistics.
        
        Returns:
            Dict with character count, word count, frequency analysis, etc.
        """
        words = self.extract_words(text)
        word_freq = self.calculate_word_frequency(words)
        
        # Count special entities
        entity_counts = {}
        for pattern_name in self.pattern_order:
            pattern = self.patterns[pattern_name]
            matches = pattern.findall(text)
            if matches:
                entity_counts[pattern_name] = len(matches)
        
        return {
            'character_count': len(text),
            'word_count': len(words),
            'unique_word_count': len(word_freq),
            'average_word_length': sum(len(w) for w in words) / len(words) if words else 0,
            'most_common_words': Counter(words).most_common(10),
            'lexical_diversity': len(word_freq) / len(words) if words else 0,
            'special_entities': entity_counts
        }
    
    def extract_keywords_fast(self, word_ids: List[int], keywords_dict: Dict[int, List[int]]) -> Dict[int, int]:
        """
        Fast keyword extraction using set-based matching.
        
        Args:
            word_ids: List of word IDs in the document
            keywords_dict: {keyword_id: [word_id_1, word_id_2, ...]}
        
        Returns:
            {keyword_id: count}
        """
        if not keywords_dict:
            return {}
        
        # Convert word_ids to Counter for frequency lookup
        word_counter = Counter(word_ids)
        
        # Convert to set for fast membership testing
        word_id_set = set(word_ids)
        
        keyword_counts = {}
        
        for keyword_id, keyword_word_ids in keywords_dict.items():
            # Check if all keyword words are present
            keyword_word_set = set(keyword_word_ids)
            
            if keyword_word_set.issubset(word_id_set):
                # Calculate minimum occurrence count across all keyword words
                min_count = min(word_counter[wid] for wid in keyword_word_ids)
                keyword_counts[keyword_id] = min_count
        
        return keyword_counts
    
    
    def _remove_overlaps(self, entities: List[Dict]) -> List[Dict]:
        """Remove overlapping entities, keeping the first/longest match"""
        if not entities:
            return []
        
        filtered = []
        last_end = -1
        
        for entity in entities:
            if entity['start'] < last_end:
                if entity['end'] - entity['start'] > filtered[-1]['end'] - filtered[-1]['start']:
                    filtered[-1] = entity
                    last_end = entity['end']
                continue
            
            filtered.append(entity)
            last_end = entity['end']
        
        return filtered
    
    def extract_entities(self, text: str) -> Dict[str, List[str]]:
        """Extract all special entities from text"""
        entities = {
            'emails': [],
            'urls': [],
            'dates': [],
            'domains': []
        }
        
        text = ValidationProcessor.sanitize_text(text)
        
        # Extract emails
        for match in self.patterns['email'].finditer(text):
            entities['emails'].append(match.group(0))
        
        # Extract URLs
        for match in self.patterns['url'].finditer(text):
            entities['urls'].append(match.group(0))
        
        for match in self.patterns['url_no_protocol'].finditer(text):
            url = match.group(0)
            if url not in entities['urls']:
                entities['urls'].append(url)
        
        # Extract dates
        for match in self.patterns['date'].finditer(text):
            entities['dates'].append(match.group(0))
        
        for match in self.patterns['date_iso'].finditer(text):
            date = match.group(0)
            if date not in entities['dates']:
                entities['dates'].append(date)
        
        # Extract domains
        email_domains = set()
        for email in entities['emails']:
            if '@' in email:
                email_domains.add(email.split('@')[1])
        
        url_domains = set()
        for url in entities['urls']:
            domain_match = self.patterns['domain'].search(url)
            if domain_match:
                url_domains.add(domain_match.group(0))
        
        for match in self.patterns['domain'].finditer(text):
            domain = match.group(0)
            if domain not in email_domains and domain not in url_domains:
                entities['domains'].append(domain)
        
        return entities
