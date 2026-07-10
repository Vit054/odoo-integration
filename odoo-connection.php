<?php
// PHP PostgreSQL Connection Helper for Odoo

class OdooConnection {
    private $conn;
    private $host;
    private $port;
    private $user;
    private $password;
    private $database;

    public function __construct() {
        // Load from .env.local
        $this->loadEnv();
        $this->connect();
    }

    private function loadEnv() {
        $envFile = __DIR__ . '/.env.local';
        if (file_exists($envFile)) {
            $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                if (strpos($line, '=') !== false && strpos($line, '#') !== 0) {
                    list($key, $value) = explode('=', $line, 2);
                    $_ENV[trim($key)] = trim($value);
                }
            }
        }

        $this->host = $_ENV['ODOO_DB_HOST'] ?? '203.151.190.135';
        $this->port = $_ENV['ODOO_DB_PORT'] ?? '5432';
        $this->user = $_ENV['ODOO_DB_USER'] ?? 'odoo';
        $this->password = $_ENV['ODOO_DB_PASSWORD'] ?? '';
        $this->database = $_ENV['ODOO_DB_NAME'] ?? 'odoo';
    }

    private function connect() {
        $connString = "host={$this->host} port={$this->port} user={$this->user} password={$this->password} dbname={$this->database}";

        try {
            $this->conn = pg_connect($connString);
            if (!$this->conn) {
                throw new Exception("Failed to connect to Odoo database");
            }
            echo "✓ Connected to Odoo database\n";
        } catch (Exception $e) {
            echo "✗ Connection error: " . $e->getMessage() . "\n";
            $this->conn = null;
        }
    }

    public function query($sql, $params = []) {
        if (!$this->conn) {
            return ['success' => false, 'error' => 'No database connection'];
        }

        try {
            if (!empty($params)) {
                $result = pg_query_params($this->conn, $sql, $params);
            } else {
                $result = pg_query($this->conn, $sql);
            }

            if ($result === false) {
                throw new Exception(pg_last_error($this->conn));
            }

            $data = pg_fetch_all($result, PGSQL_ASSOC);
            return [
                'success' => true,
                'data' => $data ?: [],
                'count' => pg_num_rows($result)
            ];
        } catch (Exception $e) {
            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    public function getTables() {
        $sql = "
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        ";
        return $this->query($sql);
    }

    public function getTableSchema($tableName) {
        $sql = "
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = $1
            ORDER BY ordinal_position
        ";
        return $this->query($sql, [$tableName]);
    }

    public function getData($tableName, $limit = 50, $offset = 0) {
        $sql = "SELECT * FROM {$tableName} LIMIT $1 OFFSET $2";
        return $this->query($sql, [$limit, $offset]);
    }

    public function count($tableName) {
        $result = $this->query("SELECT COUNT(*) as count FROM {$tableName}");
        if ($result['success'] && !empty($result['data'])) {
            return $result['data'][0]['count'];
        }
        return null;
    }

    public function close() {
        if ($this->conn) {
            pg_close($this->conn);
            echo "✓ Connection closed\n";
        }
    }

    public function __destruct() {
        $this->close();
    }
}

// Example usage
if (php_sapi_name() === 'cli') {
    $db = new OdooConnection();

    // List tables
    $tables = $db->getTables();
    echo "\nTables:\n";
    print_r($tables);

    // Get first table's schema
    if ($tables['success'] && !empty($tables['data'])) {
        $firstTable = $tables['data'][0]['table_name'];
        $schema = $db->getTableSchema($firstTable);
        echo "\nSchema of {$firstTable}:\n";
        print_r($schema);
    }
}
?>
