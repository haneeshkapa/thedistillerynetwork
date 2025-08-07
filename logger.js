const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, 'logs');
        this.logFile = path.join(this.logDir, 'app.log');
        this.maxLogSize = 10 * 1024 * 1024; // 10MB
        this.maxLogFiles = 5;
        
        // Ensure logs directory exists
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        
        console.log('📋 Logger initialized - logs stored in:', this.logDir);
    }
    
    // Format log entry with timestamp and level
    formatMessage(level, message, extra = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            ...(extra && { extra })
        };
        return JSON.stringify(logEntry) + '\n';
    }
    
    // Write log entry to file
    writeToFile(formattedMessage) {
        try {
            // Check if log rotation is needed
            this.rotateLogsIfNeeded();
            
            // Append to current log file
            fs.appendFileSync(this.logFile, formattedMessage);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }
    
    // Rotate logs when they get too large
    rotateLogsIfNeeded() {
        try {
            if (!fs.existsSync(this.logFile)) return;
            
            const stats = fs.statSync(this.logFile);
            if (stats.size > this.maxLogSize) {
                // Move current log to backup
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupFile = path.join(this.logDir, `app-${timestamp}.log`);
                fs.renameSync(this.logFile, backupFile);
                
                // Clean up old backups
                this.cleanupOldLogs();
                
                console.log('📋 Log rotated:', backupFile);
            }
        } catch (error) {
            console.error('Failed to rotate logs:', error);
        }
    }
    
    // Remove old log files to prevent disk space issues
    cleanupOldLogs() {
        try {
            const files = fs.readdirSync(this.logDir)
                .filter(file => file.startsWith('app-') && file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(this.logDir, file),
                    mtime: fs.statSync(path.join(this.logDir, file)).mtime
                }))
                .sort((a, b) => b.mtime - a.mtime);
            
            // Remove files beyond maxLogFiles
            for (let i = this.maxLogFiles; i < files.length; i++) {
                fs.unlinkSync(files[i].path);
                console.log('📋 Cleaned up old log:', files[i].name);
            }
        } catch (error) {
            console.error('Failed to cleanup old logs:', error);
        }
    }
    
    // Log levels
    info(message, extra = null) {
        const formatted = this.formatMessage('info', message, extra);
        console.log(`ℹ️  ${message}`);
        this.writeToFile(formatted);
    }
    
    warn(message, extra = null) {
        const formatted = this.formatMessage('warn', message, extra);
        console.warn(`⚠️  ${message}`);
        this.writeToFile(formatted);
    }
    
    error(message, extra = null) {
        const formatted = this.formatMessage('error', message, extra);
        console.error(`❌ ${message}`);
        this.writeToFile(formatted);
    }
    
    success(message, extra = null) {
        const formatted = this.formatMessage('success', message, extra);
        console.log(`✅ ${message}`);
        this.writeToFile(formatted);
    }
    
    debug(message, extra = null) {
        const formatted = this.formatMessage('debug', message, extra);
        if (process.env.NODE_ENV === 'development') {
            console.log(`🐛 ${message}`);
        }
        this.writeToFile(formatted);
    }
    
    // HTTP request logging
    request(req, res, responseTime = null) {
        const extra = {
            method: req.method,
            url: req.url,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent'),
            statusCode: res.statusCode,
            ...(responseTime && { responseTime: `${responseTime}ms` })
        };
        
        const message = `${req.method} ${req.url} - ${res.statusCode}`;
        
        if (res.statusCode >= 400) {
            this.error(`HTTP Error: ${message}`, extra);
        } else {
            this.info(`HTTP: ${message}`, extra);
        }
    }
    
    // Get recent log entries for dashboard
    getRecentLogs(limit = 100) {
        try {
            if (!fs.existsSync(this.logFile)) {
                return [];
            }
            
            const content = fs.readFileSync(this.logFile, 'utf8');
            const lines = content.trim().split('\n').filter(line => line);
            
            // Get last N lines and parse them
            const recentLines = lines.slice(-limit);
            const logs = recentLines
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        return null;
                    }
                })
                .filter(log => log)
                .reverse(); // Most recent first
            
            return logs;
        } catch (error) {
            console.error('Failed to read logs:', error);
            return [];
        }
    }
    
    // Get log statistics
    getStats() {
        try {
            const logs = this.getRecentLogs(1000); // Last 1000 entries
            const now = new Date();
            const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            
            const recentLogs = logs.filter(log => new Date(log.timestamp) > oneHourAgo);
            const dailyLogs = logs.filter(log => new Date(log.timestamp) > oneDayAgo);
            
            const stats = {
                total: logs.length,
                lastHour: recentLogs.length,
                lastDay: dailyLogs.length,
                byLevel: {
                    error: logs.filter(log => log.level === 'ERROR').length,
                    warn: logs.filter(log => log.level === 'WARN').length,
                    info: logs.filter(log => log.level === 'INFO').length,
                    success: logs.filter(log => log.level === 'SUCCESS').length,
                    debug: logs.filter(log => log.level === 'DEBUG').length
                },
                lastError: logs.find(log => log.level === 'ERROR'),
                diskUsage: this.getLogsDiskUsage()
            };
            
            return stats;
        } catch (error) {
            console.error('Failed to get log stats:', error);
            return null;
        }
    }
    
    // Get disk usage of logs
    getLogsDiskUsage() {
        try {
            const files = fs.readdirSync(this.logDir);
            let totalSize = 0;
            
            files.forEach(file => {
                const filePath = path.join(this.logDir, file);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
            });
            
            return {
                bytes: totalSize,
                human: this.formatBytes(totalSize),
                fileCount: files.length
            };
        } catch (error) {
            return { bytes: 0, human: '0 B', fileCount: 0 };
        }
    }
    
    // Format bytes to human readable
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    
    // Clear all logs
    clearLogs() {
        try {
            const files = fs.readdirSync(this.logDir);
            files.forEach(file => {
                if (file.endsWith('.log')) {
                    fs.unlinkSync(path.join(this.logDir, file));
                }
            });
            this.info('All logs cleared by admin');
            return true;
        } catch (error) {
            this.error('Failed to clear logs', { error: error.message });
            return false;
        }
    }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;