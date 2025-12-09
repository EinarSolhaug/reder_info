"""
Compression Processor - Handles pickle serialization and zlib compression
"""
import pickle
import zlib
from typing import Any, List, Tuple

class CompressionProcessor:
    """Handles data compression and decompression"""
    
    @staticmethod
    def compress_data(data: Any, protocol: int = 4) -> bytes:
        """Serialize and compress data"""
        pickled = pickle.dumps(data, protocol=protocol)
        compressed = zlib.compress(pickled)
        return compressed
    
    @staticmethod
    def decompress_data(compressed: bytes) -> Any:
        """Decompress and deserialize data"""
        decompressed = zlib.decompress(compressed)
        data = pickle.loads(decompressed)
        return data
    
    @staticmethod
    def compress_tokens(token_tuples: List[Tuple], chunk_size: int = 100000) -> List[bytes]:
        """Compress token tuples into chunks"""
        if len(token_tuples) < 1000000:
            chunk_size = 100000
        else:
            chunk_size = 5000
        
        chunks = [token_tuples[i:i+chunk_size] for i in range(0, len(token_tuples), chunk_size)]
        compressed_chunks = [CompressionProcessor.compress_data(chunk) for chunk in chunks]
        return compressed_chunks
    
    @staticmethod
    def get_compression_ratio(original_size: int, compressed_size: int) -> float:
        """Calculate compression ratio"""
        if original_size == 0:
            return 0.0
        return (1 - compressed_size / original_size) * 100