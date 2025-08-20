-- SMS Bot Production Database Schema
USE sms_bot_production;

-- Customers table
CREATE TABLE customers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    phone_hash VARCHAR(64) UNIQUE NOT NULL,
    phone_original VARCHAR(20),
    name VARCHAR(100),
    email VARCHAR(100),
    tier ENUM('casual', 'regular', 'vip') DEFAULT 'casual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_phone_hash (phone_hash),
    INDEX idx_tier (tier)
);

-- Conversations table
CREATE TABLE conversations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT,
    phone_hash VARCHAR(64),
    message TEXT NOT NULL,
    response TEXT NOT NULL,
    confidence_score FLOAT,
    processing_time_ms INT,
    tokens_used INT,
    provider VARCHAR(50),
    cache_hit BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    INDEX idx_customer_created (customer_id, created_at),
    INDEX idx_phone_created (phone_hash, created_at),
    INDEX idx_created_at (created_at)
);

-- Knowledge chunks table
CREATE TABLE knowledge_chunks (
    id VARCHAR(50) PRIMARY KEY,
    content TEXT NOT NULL,
    category VARCHAR(50),
    source VARCHAR(100),
    confidence_score FLOAT DEFAULT 1.0,
    last_used TIMESTAMP NULL,
    use_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_last_used (last_used),
    FULLTEXT idx_content (content)
);

-- System metrics table
CREATE TABLE system_metrics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    metric_type VARCHAR(50),
    metric_data JSON,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type_recorded (metric_type, recorded_at)
);