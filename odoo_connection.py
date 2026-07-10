# Python PostgreSQL Connection Helper for Odoo
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

load_dotenv('.env.local')

class OdooConnection:
    def __init__(self):
        self.conn = None
        self.connect()

    def connect(self):
        """Establish database connection"""
        try:
            self.conn = psycopg2.connect(
                host=os.getenv('ODOO_DB_HOST'),
                port=os.getenv('ODOO_DB_PORT'),
                user=os.getenv('ODOO_DB_USER'),
                password=os.getenv('ODOO_DB_PASSWORD'),
                database=os.getenv('ODOO_DB_NAME')
            )
            print("✓ Connected to Odoo database")
        except psycopg2.Error as e:
            print(f"✗ Connection error: {e}")
            self.conn = None

    def query(self, sql, params=None):
        """Execute SELECT query"""
        if not self.conn:
            return {'success': False, 'error': 'No database connection'}

        try:
            cursor = self.conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(sql, params or [])
            data = cursor.fetchall()
            cursor.close()
            return {'success': True, 'data': data, 'count': len(data)}
        except psycopg2.Error as e:
            return {'success': False, 'error': str(e)}

    def get_tables(self):
        """List all tables in database"""
        sql = """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """
        return self.query(sql)

    def get_table_schema(self, table_name):
        """Get table columns and data types"""
        sql = """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = %s
            ORDER BY ordinal_position
        """
        return self.query(sql, [table_name])

    def get_data(self, table_name, limit=50, offset=0):
        """Fetch data from table with pagination"""
        sql = f"SELECT * FROM {table_name} LIMIT %s OFFSET %s"
        return self.query(sql, [limit, offset])

    def count(self, table_name):
        """Count records in table"""
        sql = f"SELECT COUNT(*) as count FROM {table_name}"
        result = self.query(sql)
        if result['success']:
            return result['data'][0]['count']
        return None

    def close(self):
        """Close database connection"""
        if self.conn:
            self.conn.close()
            print("✓ Connection closed")

# Example usage
if __name__ == '__main__':
    db = OdooConnection()

    # List tables
    tables = db.get_tables()
    print(f"\nTables: {tables}")

    # Get first table's schema
    if tables['success'] and tables['data']:
        first_table = tables['data'][0]['table_name']
        schema = db.get_table_schema(first_table)
        print(f"\nSchema of {first_table}: {schema}")

    db.close()
