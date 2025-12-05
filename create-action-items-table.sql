-- Action items table for tracking bot promises that need manual fulfillment
CREATE TABLE IF NOT EXISTS action_items (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  customer_name VARCHAR(255),
  type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'normal',
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  completed_by VARCHAR(100),
  notes TEXT
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status);
CREATE INDEX IF NOT EXISTS idx_action_items_phone ON action_items(phone);
CREATE INDEX IF NOT EXISTS idx_action_items_created ON action_items(created_at DESC);
