-- Enterprise Chat Storage Schema
-- Scalable conversation storage for large-scale SMS bot deployments

USE sms_bot_production;

-- Main enterprise conversations table (optimized for performance and scale)
CREATE TABLE IF NOT EXISTS enterprise_conversations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    phone_hash VARCHAR(64) NOT NULL COMMENT 'SHA-256 hash of phone number for privacy',
    phone_original VARCHAR(20) COMMENT 'Original phone number (encrypted in production)',
    message TEXT NOT NULL COMMENT 'Customer message content',
    response TEXT NOT NULL COMMENT 'Bot response content', 
    metadata JSON COMMENT 'Additional conversation metadata',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processing_time_ms INT COMMENT 'Time taken to generate response',
    tokens_used INT COMMENT 'AI tokens consumed',
    provider VARCHAR(50) DEFAULT 'claude' COMMENT 'AI provider used',
    confidence_score FLOAT COMMENT 'Response confidence score',
    archived TINYINT DEFAULT 0 COMMENT 'Whether conversation is archived',
    archived_at TIMESTAMP NULL COMMENT 'When conversation was archived',
    
    -- Performance indexes
    INDEX idx_phone_hash (phone_hash),
    INDEX idx_created_at (created_at),
    INDEX idx_archived (archived),
    INDEX idx_phone_created (phone_hash, created_at),
    INDEX idx_active_recent (archived, created_at),
    
    -- Composite indexes for common queries
    INDEX idx_phone_active (phone_hash, archived),
    INDEX idx_recent_active (created_at, archived)
) ENGINE=InnoDB 
COMMENT='Enterprise-scale conversation storage with archiving support';

-- Conversation analytics table (for performance metrics)
CREATE TABLE IF NOT EXISTS conversation_analytics (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    phone_hash VARCHAR(64) NOT NULL,
    conversation_date DATE NOT NULL,
    message_count INT DEFAULT 0,
    total_tokens INT DEFAULT 0,
    avg_response_time_ms INT DEFAULT 0,
    total_processing_time_ms INT DEFAULT 0,
    first_message_at TIMESTAMP,
    last_message_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_customer_date (phone_hash, conversation_date),
    INDEX idx_conversation_date (conversation_date),
    INDEX idx_phone_hash (phone_hash)
) ENGINE=InnoDB
COMMENT='Daily conversation analytics for performance monitoring';

-- Archive metadata table (tracks archived conversation batches)
CREATE TABLE IF NOT EXISTS archive_metadata (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    archive_date DATE NOT NULL,
    archive_file_path VARCHAR(500),
    conversations_count INT DEFAULT 0,
    size_bytes BIGINT DEFAULT 0,
    compression_type VARCHAR(20) DEFAULT 'gzip',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_archive_date (archive_date)
) ENGINE=InnoDB
COMMENT='Metadata about archived conversation batches';

-- Storage statistics view for monitoring
CREATE OR REPLACE VIEW storage_overview AS
SELECT 
    'active' as storage_type,
    COUNT(*) as conversation_count,
    COUNT(DISTINCT phone_hash) as unique_customers,
    MIN(created_at) as earliest_conversation,
    MAX(created_at) as latest_conversation,
    AVG(LENGTH(message)) as avg_message_length,
    AVG(LENGTH(response)) as avg_response_length,
    SUM(processing_time_ms) as total_processing_time,
    AVG(processing_time_ms) as avg_processing_time
FROM enterprise_conversations 
WHERE archived = 0

UNION ALL

SELECT 
    'archived' as storage_type,
    COUNT(*) as conversation_count,
    COUNT(DISTINCT phone_hash) as unique_customers,
    MIN(created_at) as earliest_conversation,
    MAX(created_at) as latest_conversation,
    AVG(LENGTH(message)) as avg_message_length,
    AVG(LENGTH(response)) as avg_response_length,
    SUM(processing_time_ms) as total_processing_time,
    AVG(processing_time_ms) as avg_processing_time
FROM enterprise_conversations 
WHERE archived = 1;

-- Performance monitoring view
CREATE OR REPLACE VIEW conversation_performance AS
SELECT 
    DATE(created_at) as conversation_date,
    COUNT(*) as daily_conversations,
    COUNT(DISTINCT phone_hash) as daily_unique_customers,
    AVG(processing_time_ms) as avg_response_time,
    MIN(processing_time_ms) as min_response_time,
    MAX(processing_time_ms) as max_response_time,
    SUM(tokens_used) as daily_tokens,
    AVG(confidence_score) as avg_confidence,
    COUNT(CASE WHEN provider = 'claude' THEN 1 END) as claude_responses,
    COUNT(CASE WHEN provider = 'intent_router' THEN 1 END) as intent_responses,
    COUNT(CASE WHEN provider = 'cache' THEN 1 END) as cached_responses
FROM enterprise_conversations 
WHERE archived = 0
GROUP BY DATE(created_at)
ORDER BY conversation_date DESC
LIMIT 30;

-- Customer activity summary view
CREATE OR REPLACE VIEW customer_activity AS
SELECT 
    phone_hash,
    COUNT(*) as total_messages,
    MIN(created_at) as first_contact,
    MAX(created_at) as last_contact,
    AVG(processing_time_ms) as avg_response_time,
    SUM(tokens_used) as total_tokens,
    AVG(confidence_score) as avg_confidence,
    COUNT(DISTINCT DATE(created_at)) as active_days,
    CASE 
        WHEN COUNT(*) >= 20 THEN 'VIP'
        WHEN COUNT(*) >= 10 THEN 'Regular' 
        WHEN COUNT(*) >= 5 THEN 'Engaged'
        ELSE 'Casual'
    END as customer_tier
FROM enterprise_conversations 
WHERE archived = 0
GROUP BY phone_hash
ORDER BY last_contact DESC;

-- Indexes for performance optimization  
CREATE INDEX idx_conversation_performance 
ON enterprise_conversations (created_at, archived, processing_time_ms);

CREATE INDEX idx_customer_analysis 
ON enterprise_conversations (phone_hash, created_at, archived);

-- Storage cleanup procedure (run periodically)
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS CleanupOldConversations(IN days_to_keep INT)
BEGIN
    DECLARE archive_count INT DEFAULT 0;
    
    -- Count conversations to be archived
    SELECT COUNT(*) INTO archive_count 
    FROM enterprise_conversations 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY) 
    AND archived = 0;
    
    -- Archive old conversations
    UPDATE enterprise_conversations 
    SET archived = 1, archived_at = NOW()
    WHERE created_at < DATE_SUB(NOW(), INTERVAL days_to_keep DAY) 
    AND archived = 0;
    
    -- Log the archival
    INSERT INTO archive_metadata (archive_date, conversations_count, created_at)
    VALUES (CURDATE(), archive_count, NOW());
    
    SELECT CONCAT('Archived ', archive_count, ' conversations older than ', days_to_keep, ' days') as result;
END//
DELIMITER ;

-- Performance analysis procedure
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS GetPerformanceReport(IN days_back INT)
BEGIN
    -- Overall statistics
    SELECT 
        'Performance Summary' as report_section,
        COUNT(*) as total_conversations,
        COUNT(DISTINCT phone_hash) as unique_customers,
        AVG(processing_time_ms) as avg_response_time,
        SUM(tokens_used) as total_tokens,
        AVG(confidence_score) as avg_confidence
    FROM enterprise_conversations 
    WHERE created_at > DATE_SUB(NOW(), INTERVAL days_back DAY)
    AND archived = 0;
    
    -- Daily breakdown
    SELECT 
        'Daily Breakdown' as report_section,
        DATE(created_at) as date,
        COUNT(*) as conversations,
        COUNT(DISTINCT phone_hash) as unique_customers,
        AVG(processing_time_ms) as avg_response_time
    FROM enterprise_conversations 
    WHERE created_at > DATE_SUB(NOW(), INTERVAL days_back DAY)
    AND archived = 0
    GROUP BY DATE(created_at)
    ORDER BY date DESC;
    
    -- Top customers
    SELECT 
        'Top Customers' as report_section,
        phone_hash,
        COUNT(*) as message_count,
        AVG(processing_time_ms) as avg_response_time,
        MAX(created_at) as last_contact
    FROM enterprise_conversations 
    WHERE created_at > DATE_SUB(NOW(), INTERVAL days_back DAY)
    AND archived = 0
    GROUP BY phone_hash
    ORDER BY message_count DESC
    LIMIT 10;
END//
DELIMITER ;

-- Create initial admin user notification
INSERT INTO system_metrics (metric_name, metric_value, metadata, created_at)
VALUES (
    'enterprise_storage_initialized', 
    1, 
    JSON_OBJECT(
        'version', '1.0',
        'tables_created', 3,
        'views_created', 3,
        'procedures_created', 2
    ),
    NOW()
) ON DUPLICATE KEY UPDATE 
    metric_value = VALUES(metric_value),
    metadata = VALUES(metadata),
    updated_at = NOW();

-- Success message
SELECT 'Enterprise Chat Storage Schema deployed successfully!' as status,
       'Tables: enterprise_conversations, conversation_analytics, archive_metadata' as tables_created,
       'Views: storage_overview, conversation_performance, customer_activity' as views_created,
       'Procedures: CleanupOldConversations, GetPerformanceReport' as procedures_created;