"""
PostgreSQL Database Schema Creation and Management
"""

import psycopg2
from psycopg2 import OperationalError
from typing import Optional, Dict, Any
import sys
import random
import string
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Try to import database config
try:
    from database.utilities.config import get_default_config, Config, DB_PASSWORD_DEFAULT
    DB_CONFIG_AVAILABLE = True
except ImportError:
    try:
        from database.utilities.config import get_default_config, Config, DB_PASSWORD_DEFAULT
        DB_CONFIG_AVAILABLE = True
    except ImportError:
        try:
            from database.utilities.config  import get_default_config, Config, DB_PASSWORD_DEFAULT
            DB_CONFIG_AVAILABLE = True
        except ImportError:
            DB_CONFIG_AVAILABLE = False
        DB_PASSWORD_DEFAULT = 'eggarf123'


# ==================== CONNECTION UTILITIES ====================

def get_postgres_connection(password: str = 'eggarf123') -> psycopg2.extensions.connection:
    """Connect to the default 'postgres' database for administrative tasks."""
    config = {
        'host': 'localhost',
        'port': 5432,
        'database': 'postgres',
        'user': 'postgres',
        'password': password
    }
    try:
        conn = psycopg2.connect(**config)
        conn.autocommit = True
        return conn
    except OperationalError as e:
        print(f"\n❌ Database connection failed: {e}")
        print("\nTroubleshooting:")
        print("1. Ensure PostgreSQL is running")
        print("2. Verify credentials")
        print("3. Check PostgreSQL service status")
        raise


def get_db_connection(db_name: str, password: str = 'eggarf123') -> psycopg2.extensions.connection:
    """Connect to a specific database."""
    config = {
        'host': 'localhost',
        'port': 5432,
        'database': db_name,
        'user': 'postgres',
        'password': password
    }
    try:
        return psycopg2.connect(**config)
    except OperationalError as e:
        print(f"\n❌ Connection to database '{db_name}' failed: {e}")
        raise


# ==================== DATABASE MANAGEMENT ====================

def database_exists(db_name: str, password: str = 'eggarf123') -> bool:
    """Check if a database exists."""
    conn = get_postgres_connection(password)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
        exists = cursor.fetchone() is not None
        return exists
    finally:
        cursor.close()
        conn.close()


def list_databases(password: str = 'eggarf123') -> list:
    """List all non-template databases."""
    conn = get_postgres_connection(password)
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT datname FROM pg_database 
            WHERE datistemplate = false 
            ORDER BY datname
        """)
        return [row[0] for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def create_database(db_name: str, password: str = 'eggarf123') -> bool:
    """Create a new database."""
    conn = get_postgres_connection(password)
    cursor = conn.cursor()
    try:
        cursor.execute(f"CREATE DATABASE {db_name}")
        print(f"✅ Database '{db_name}' created successfully.")
        return True
    except Exception as e:
        print(f"❌ Error creating database '{db_name}': {e}")
        return False
    finally:
        cursor.close()
        conn.close()


def delete_database(db_name: str, password: str = 'eggarf123') -> bool:
    """Delete a database and terminate all active connections."""
    conn = get_postgres_connection(password)
    cursor = conn.cursor()
    try:
        # Terminate all connections to the database
        print(f"🔌 Terminating active connections to '{db_name}'...")
        cursor.execute(f"""
            SELECT pg_terminate_backend(pg_stat_activity.pid)
            FROM pg_stat_activity
            WHERE pg_stat_activity.datname = '{db_name}'
            AND pid <> pg_backend_pid();
        """)
        terminated_count = cursor.rowcount
        print(f"   Terminated {terminated_count} session(s)")
        
        # Small delay to ensure connections are closed
        import time
        time.sleep(1)
        
        # Now drop the database
        cursor.execute(f"DROP DATABASE {db_name}")
        print(f"✅ Database '{db_name}' deleted successfully.")
        return True
    except Exception as e:
        print(f"❌ Error deleting database '{db_name}': {e}")
        return False
    finally:
        cursor.close()
        conn.close()


def generate_unique_db_name(prefix: str = "analysis", password: str = 'eggarf123') -> str:
    """Generate a unique database name."""
    conn = get_postgres_connection(password)
    cursor = conn.cursor()
    try:
        for _ in range(100):
            suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
            db_name = f"{prefix}_{suffix}"
            cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
            if not cursor.fetchone():
                return db_name
        raise Exception("Could not generate a unique database name after 100 attempts.")
    finally:
        cursor.close()
        conn.close()


# ==================== USER INTERACTION ====================

def prompt_user_action(db_name: str) -> str:
    """Prompt user for action when database exists."""
    print("\n" + "=" * 60)
    print(f"⚠️  DATABASE '{db_name}' ALREADY EXISTS")
    print("=" * 60)
    print("\nWhat would you like to do?")
    print("1. Update/Create tables (preserves existing data)")
    print("2. Delete and recreate database (⚠️  DESTROYS ALL DATA)")
    print("3. Use a different database name")
    print("4. Exit")
    print("-" * 60)
    
    while True:
        choice = input("Enter your choice (1-4): ").strip()
        if choice in ['1', '2', '3', '4']:
            return choice
        print("❌ Invalid choice. Please enter 1, 2, 3, or 4.")


def confirm_deletion(db_name: str) -> bool:
    """Confirm database deletion with user."""
    print(f"\n⚠️  WARNING: You are about to DELETE database '{db_name}'")
    print("⚠️  This action CANNOT be undone!")
    print("⚠️  ALL DATA will be permanently lost!")
    confirm = input(f"\nType '{db_name}' to confirm deletion: ").strip()
    return confirm == db_name


# ==================== SCHEMA CREATION ====================

def create_schema(conn: psycopg2.extensions.connection):
    """Create all database tables and indexes."""
    conn.autocommit = True
    cursor = conn.cursor()
    
    print("\n" + "=" * 60)
    print("Creating PostgreSQL schema...")
    print("=" * 60)

    # Enable pg_trgm extension
    cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    print("✅ pg_trgm extension enabled")

    # Migration check
    try:
        cursor.execute(
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'words' AND column_name = 'word'"
        )
        result = cursor.fetchone()
        if result and result[0] == "character varying":
            print("🔄 Migrating words table from VARCHAR(100) to TEXT...")
            cursor.execute("ALTER TABLE words ALTER COLUMN word TYPE TEXT")
            print("✅ Words table migrated to TEXT")
    except Exception as e:
        pass  # Table doesn't exist yet

    # Words table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS words (
        id SERIAL PRIMARY KEY,
        word TEXT UNIQUE NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_words_word ON words USING btree (word);
    CREATE INDEX IF NOT EXISTS idx_words_word_gin ON words USING gin (word gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_words_word_hash ON words USING hash (word);
    """)
    print("✅ words table created")

    # Punctuation table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS punctuation (
        id SERIAL PRIMARY KEY,
        punctuation_text TEXT UNIQUE NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_punctuation_text ON punctuation USING btree (punctuation_text);
    CREATE INDEX IF NOT EXISTS idx_punctuation_text_hash ON punctuation USING hash (punctuation_text);
    """)
    print("✅ punctuation table created")

    # Categorys table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categorys (
        id SERIAL PRIMARY KEY,
        word_id INTEGER UNIQUE NOT NULL,
        FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categorys_word_id ON categorys (word_id);
    CREATE INDEX IF NOT EXISTS idx_categorys_word_id ON categorys USING btree (word_id);
    """)
    print("✅ categorys table created")

    # Words_categorys table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS words_categorys (
        word_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categorys(id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wc_word_id ON words_categorys (word_id);
    CREATE INDEX IF NOT EXISTS idx_wc_category_id ON words_categorys (category_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wc_word_category ON words_categorys (word_id, category_id);
    CREATE INDEX IF NOT EXISTS idx_words_categorys_word_id ON words_categorys USING btree (word_id);
    CREATE INDEX IF NOT EXISTS idx_words_categorys_category_id ON words_categorys USING btree (category_id);
    CREATE INDEX IF NOT EXISTS idx_words_categorys_word_cat ON words_categorys USING btree (word_id, category_id);
    """)
    print("✅ words_categorys table created")

    # Keywords table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS keywords (
        id SERIAL PRIMARY KEY,
        keyword BYTEA,
        category_id INTEGER NOT NULL,
        FOREIGN KEY (category_id) REFERENCES categorys(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_keywords_category_id ON keywords (category_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_category_id ON keywords USING btree (category_id);
    """)
    print("✅ keywords table created")

    # Sides table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sides(
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        importance DECIMAL(5,4) NOT NULL,
        date_creation DATE NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sides_name ON sides (name);
    CREATE INDEX IF NOT EXISTS idx_sides_importance ON sides (importance DESC);
    CREATE INDEX IF NOT EXISTS idx_sides_date_creation ON sides (date_creation DESC);
    CREATE INDEX IF NOT EXISTS idx_sides_name ON sides USING btree (name);
    CREATE INDEX IF NOT EXISTS idx_sides_importance ON sides USING btree (importance DESC);
    CREATE INDEX IF NOT EXISTS idx_sides_date_creation ON sides USING btree (date_creation);
    """)
    print("✅ sides table created")

    # Sources table with enums
    cursor.execute("""
    DO $$ BEGIN
        CREATE TYPE ownership_enum AS ENUM ('Private', 'Government', 'Corporate', 'Non-Profit', 'Public', 'Other');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
    DO $$ BEGIN
        CREATE TYPE access_status_enum AS ENUM ('Open', 'Restricted', 'Classified', 'Confidential', 'Public', 'Limited');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
    
    CREATE TABLE IF NOT EXISTS sources(
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        job VARCHAR(255) NOT NULL,
        importance DECIMAL(5,4) NOT NULL,
        country VARCHAR(255) NOT NULL,
        city VARCHAR(255) NULL,
        description VARCHAR(255) NULL,
        accounts VARCHAR(255) NULL,
        note VARCHAR(255) NULL,
        attachments VARCHAR(255) NULL,
        date_creation DATE NOT NULL,
        ownership ownership_enum NULL,
        access_status access_status_enum NULL,
        date_source_discovery DATE NULL,
        category_id INTEGER NULL,
        FOREIGN KEY (category_id) REFERENCES categorys(id) ON DELETE SET NULL ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_name ON sources (name);
    CREATE INDEX IF NOT EXISTS idx_sources_country ON sources (country);
    CREATE INDEX IF NOT EXISTS idx_sources_job ON sources (job);
    CREATE INDEX IF NOT EXISTS idx_sources_importance ON sources (importance DESC);
    CREATE INDEX IF NOT EXISTS idx_sources_date_creation ON sources (date_creation DESC);
    CREATE INDEX IF NOT EXISTS idx_sources_ownership ON sources (ownership);
    CREATE INDEX IF NOT EXISTS idx_sources_access_status ON sources (access_status);
    CREATE INDEX IF NOT EXISTS idx_sources_date_source_discovery ON sources (date_source_discovery DESC);
    CREATE INDEX IF NOT EXISTS idx_sources_category_id ON sources (category_id);
    CREATE INDEX IF NOT EXISTS idx_sources_name ON sources USING btree (name);
    CREATE INDEX IF NOT EXISTS idx_sources_importance ON sources USING btree (importance DESC);
    CREATE INDEX IF NOT EXISTS idx_sources_country ON sources USING btree (country);
    CREATE INDEX IF NOT EXISTS idx_sources_city ON sources USING btree (city);
    CREATE INDEX IF NOT EXISTS idx_sources_date_creation ON sources USING btree (date_creation);
    CREATE INDEX IF NOT EXISTS idx_sources_ownership ON sources USING btree (ownership);
    CREATE INDEX IF NOT EXISTS idx_sources_access_status ON sources USING btree (access_status);
    CREATE INDEX IF NOT EXISTS idx_sources_date_source_discovery ON sources USING btree (date_source_discovery);
    CREATE INDEX IF NOT EXISTS idx_sources_category_id ON sources USING btree (category_id);
    """)
    print("✅ sources table created")

    # Hashs table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS hashs (
        id SERIAL PRIMARY KEY,
        hash CHAR(64) NOT NULL,
        side_id INTEGER NOT NULL,
        source_id INTEGER NOT NULL,
        FOREIGN KEY (side_id) REFERENCES sides(id),
        FOREIGN KEY (source_id) REFERENCES sources(id),
        UNIQUE (hash, source_id, side_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hashs_source_id ON hashs (source_id);
    CREATE INDEX IF NOT EXISTS idx_hashs_side_id ON hashs (side_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hashs_hash_source_side ON hashs (hash, source_id, side_id);
    
    -- Remove old UNIQUE constraint if it exists (hash, source_id only)
    DO $$ 
    BEGIN
        ALTER TABLE hashs DROP CONSTRAINT IF EXISTS hashs_hash_source_id_key;
        DROP INDEX IF EXISTS idx_hashs_hash_source;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_hashs_hash ON hashs USING btree (hash);
    CREATE INDEX IF NOT EXISTS idx_hashs_source_id ON hashs USING btree (source_id);
    CREATE INDEX IF NOT EXISTS idx_hashs_side_id ON hashs USING btree (side_id);
    CREATE INDEX IF NOT EXISTS idx_hashs_hash_source_side ON hashs USING btree (hash, source_id, side_id);
    """)
    print("✅ hashs table created")

    # Paths table
    cursor.execute("""
    DO $$ BEGIN
        CREATE TYPE file_status_enum AS ENUM ('Read', 'Unread');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
    
    CREATE TABLE IF NOT EXISTS paths (
        id SERIAL PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL CHECK (file_size >= 0),
        file_type VARCHAR(100) NOT NULL,
        file_status file_status_enum DEFAULT 'Unread',
        file_date DATE NOT NULL,
        date_creation DATE NOT NULL,
        hash_id INTEGER NOT NULL,
        FOREIGN KEY (hash_id) REFERENCES hashs(id)
    );
    
    -- Remove UNIQUE constraints on file_name and file_path if they exist
    -- Duplicate checking is done at hash level (hash + source + side)
    DO $$ 
    BEGIN
        ALTER TABLE paths DROP CONSTRAINT IF EXISTS paths_file_name_key;
        ALTER TABLE paths DROP CONSTRAINT IF EXISTS paths_file_path_key;
    EXCEPTION WHEN OTHERS THEN
        -- Ignore errors if constraints don't exist
        NULL;
    END $$;
    CREATE INDEX IF NOT EXISTS idx_paths_file_status ON paths (file_status);
    CREATE INDEX IF NOT EXISTS idx_paths_file_type ON paths (file_type);
    CREATE INDEX IF NOT EXISTS idx_paths_date_creation ON paths (date_creation DESC);
    CREATE INDEX IF NOT EXISTS idx_paths_file_date ON paths (file_date DESC);
    CREATE INDEX IF NOT EXISTS idx_paths_hash_id ON paths (hash_id);
    CREATE INDEX IF NOT EXISTS idx_paths_file_name_gin ON paths USING gin (file_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_paths_status_type_date ON paths (file_status, file_type, date_creation DESC);
    CREATE INDEX IF NOT EXISTS idx_paths_file_path ON paths USING btree (file_path);
    CREATE INDEX IF NOT EXISTS idx_paths_file_name ON paths USING btree (file_name);
    CREATE INDEX IF NOT EXISTS idx_paths_hash_id ON paths USING btree (hash_id);
    CREATE INDEX IF NOT EXISTS idx_paths_file_type ON paths USING btree (file_type);
    CREATE INDEX IF NOT EXISTS idx_paths_file_size ON paths USING btree (file_size);
    CREATE INDEX IF NOT EXISTS idx_paths_file_date ON paths USING btree (file_date);
    CREATE INDEX IF NOT EXISTS idx_paths_date_creation ON paths USING btree (date_creation);
    CREATE INDEX IF NOT EXISTS idx_paths_file_status ON paths USING btree (file_status);
    CREATE INDEX IF NOT EXISTS idx_paths_type_date ON paths USING btree (file_type, file_date DESC);
    CREATE INDEX IF NOT EXISTS idx_paths_hash_path ON paths USING btree (hash_id, file_path);
    """)
    print("✅ paths table created")

    # Contents table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS contents (
        id SERIAL PRIMARY KEY,
        content_data BYTEA,
        content_date DATE NULL,
        path_id INTEGER NOT NULL,
        FOREIGN KEY (path_id) REFERENCES paths(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_contents_path_id ON contents (path_id);
    CREATE INDEX IF NOT EXISTS idx_contents_content_date ON contents (content_date DESC);
    CREATE INDEX IF NOT EXISTS idx_contents_path_date ON contents (path_id, content_date);
    CREATE INDEX IF NOT EXISTS idx_contents_path_id ON contents USING btree (path_id);
    CREATE INDEX IF NOT EXISTS idx_contents_date ON contents USING btree (content_date);
    CREATE INDEX IF NOT EXISTS idx_contents_path_date ON contents USING btree (path_id, content_date);
    """)
    print("✅ contents table created")

    # Titles_content table
    cursor.execute("""
    DO $$ BEGIN
        CREATE TYPE title_status_enum AS ENUM ('Main', 'Branch');
    EXCEPTION WHEN duplicate_object THEN null;
    END $$;
    
    CREATE TABLE IF NOT EXISTS titles_content (
        id SERIAL PRIMARY KEY,
        title_data BYTEA,
        title_status title_status_enum DEFAULT 'Main',
        title_content_id INTEGER NULL,
        path_id INTEGER NOT NULL,
        FOREIGN KEY (title_content_id) REFERENCES titles_content(id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (path_id) REFERENCES paths(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_titles_path_id ON titles_content (path_id);
    CREATE INDEX IF NOT EXISTS idx_titles_title_status ON titles_content (title_status);
    CREATE INDEX IF NOT EXISTS idx_titles_title_content_id ON titles_content (title_content_id);
    CREATE INDEX IF NOT EXISTS idx_titles_content_path_id ON titles_content USING btree (path_id);
    CREATE INDEX IF NOT EXISTS idx_titles_content_title_status ON titles_content USING btree (title_status);
    CREATE INDEX IF NOT EXISTS idx_titles_content_title_content_id ON titles_content USING btree (title_content_id);
    """)
    print("✅ titles_content table created")

    # Words_paths table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS words_paths (
        path_id INTEGER NOT NULL,
        word_id INTEGER NOT NULL,
        word_count INTEGER,
        FOREIGN KEY (path_id) REFERENCES paths(id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE ON UPDATE CASCADE,
        UNIQUE (path_id, word_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wp_path_id ON words_paths (path_id);
    CREATE INDEX IF NOT EXISTS idx_wp_word_id ON words_paths (word_id);
    CREATE INDEX IF NOT EXISTS idx_wp_word_count ON words_paths (word_count DESC);
    CREATE INDEX IF NOT EXISTS idx_words_paths_word_id ON words_paths USING btree (word_id);
    CREATE INDEX IF NOT EXISTS idx_words_paths_path_id ON words_paths USING btree (path_id);
    CREATE INDEX IF NOT EXISTS idx_words_paths_word_count ON words_paths USING btree (word_count DESC);
    CREATE INDEX IF NOT EXISTS idx_words_paths_word_path ON words_paths USING btree (word_id, path_id);
    CREATE INDEX IF NOT EXISTS idx_words_paths_path_word ON words_paths USING btree (path_id, word_id);
    CREATE INDEX IF NOT EXISTS idx_words_paths_path_count ON words_paths USING btree (path_id, word_count DESC);
    """)
    print("✅ words_paths table created")

    # Keywords_paths table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS keywords_paths (
        path_id INTEGER NOT NULL,
        keyword_id INTEGER NOT NULL,
        word_count INTEGER,
        FOREIGN KEY (path_id) REFERENCES paths(id) ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE ON UPDATE CASCADE,
        UNIQUE (path_id, keyword_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kp_path_id ON keywords_paths (path_id);
    CREATE INDEX IF NOT EXISTS idx_kp_keyword_id ON keywords_paths (keyword_id);
    CREATE INDEX IF NOT EXISTS idx_kp_word_count ON keywords_paths (word_count DESC);
    CREATE INDEX IF NOT EXISTS idx_keywords_paths_keyword_id ON keywords_paths USING btree (keyword_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_paths_path_id ON keywords_paths USING btree (path_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_paths_word_count ON keywords_paths USING btree (word_count DESC);
    CREATE INDEX IF NOT EXISTS idx_keywords_paths_keyword_path ON keywords_paths USING btree (keyword_id, path_id);
    CREATE INDEX IF NOT EXISTS idx_keywords_paths_path_keyword ON keywords_paths USING btree (path_id, keyword_id);
    """)
    print("✅ keywords_paths table created")

    # Alerts table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        priority VARCHAR(20) NOT NULL,
        title VARCHAR(500) NOT NULL,
        message TEXT NOT NULL,
        file_id INTEGER REFERENCES paths(id) ON DELETE CASCADE,
        file_name VARCHAR(500),
        file_path TEXT,
        event_date DATE,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read BOOLEAN DEFAULT FALSE,
        dismissed BOOLEAN DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
    CREATE INDEX IF NOT EXISTS idx_alerts_priority ON alerts(priority);
    CREATE INDEX IF NOT EXISTS idx_alerts_event_date ON alerts(event_date);
    CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_dismissed ON alerts(dismissed);
    CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read);
    CREATE INDEX IF NOT EXISTS idx_alerts_file_id ON alerts(file_id);
    """)
    print("✅ alerts table created")

    # Performance optimizations
    print("\n🔧 Applying performance optimizations...")
    cursor.execute("ALTER SYSTEM SET shared_buffers = '2024MB';")
    cursor.execute("ALTER SYSTEM SET work_mem = '512MB';")
    cursor.execute("ALTER SYSTEM SET maintenance_work_mem = '1024MB';")
    cursor.execute("ALTER SYSTEM SET effective_cache_size = '2GB';")
    print("✅ Performance settings configured")

    print("\n" + "=" * 60)
    print("✅ Schema creation completed successfully!")
    print("=" * 60)
    
    cursor.close()


# ==================== MAIN EXECUTION ====================

def main():
    """Main execution function with user interaction."""
    db_name = "analysis"
    password = DB_PASSWORD_DEFAULT
    
    print("\n" + "=" * 60)
    print("PostgreSQL Database Schema Manager")
    print("=" * 60)
    
    # Check if database exists
    if database_exists(db_name, password):
        choice = prompt_user_action(db_name)
        
        if choice == '1':
            # Update/Create tables
            print(f"\n📊 Connecting to database '{db_name}'...")
            conn = get_db_connection(db_name, password)
            create_schema(conn)
            conn.close()
            
        elif choice == '2':
            # Delete and recreate
            if confirm_deletion(db_name):
                print(f"\n🗑️  Deleting database '{db_name}'...")
                if delete_database(db_name, password):
                    print(f"\n📦 Creating fresh database '{db_name}'...")
                    if create_database(db_name, password):
                        conn = get_db_connection(db_name, password)
                        create_schema(conn)
                        conn.close()
            else:
                print("\n❌ Deletion cancelled. Exiting.")
                sys.exit(0)
                
        elif choice == '3':
            # Use different name
            new_name = input("\nEnter new database name: ").strip()
            if not new_name:
                print("❌ Invalid database name. Exiting.")
                sys.exit(1)
            db_name = new_name
            if not database_exists(db_name, password):
                create_database(db_name, password)
            conn = get_db_connection(db_name, password)
            create_schema(conn)
            conn.close()
            
        elif choice == '4':
            print("\n👋 Exiting...")
            sys.exit(0)
    else:
        # Database doesn't exist, create it
        print(f"\n📦 Database '{db_name}' does not exist. Creating...")
        if create_database(db_name, password):
            conn = get_db_connection(db_name, password)
            create_schema(conn)
            conn.close()


if __name__ == "__main__":
    main()