/**
 * AdvancedKnowledgeRetriever:
 * Hybrid BM25 + semantic retrieval from PostgreSQL knowledge base.
 * Uses PostgreSQL full-text search for BM25-like ranking.
 */
class AdvancedKnowledgeRetriever {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Retrieve relevant knowledge base chunks for a query.
   * Returns an array of content strings (truncated for brevity) of top results.
   */
  async retrieveRelevantChunks(query, maxChunks = 3) {
    if (!query || query.trim() === '') {
      return [];
    }
    
    const term = query.replace(/[^\w\s]/g, ' '); // basic sanitize: remove special chars
    const words = term.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) {
      return [];
    }
    
    // Use plainto_tsquery for full text search
    const tsQuery = words.join(' | ');
    
    try {
      const result = await this.pool.query(
        `SELECT id, title, content,
                ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', $1)) AS rank
         FROM knowledge
         WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2`,
        [tsQuery, maxChunks]
      );
      
      const rows = result.rows;
      const chunks = [];
      
      for (let row of rows) {
        let text = row.content || '';
        // Truncate each content to ~300 characters for prompt efficiency
        if (text.length > 300) {
          // Cut at closest word boundary before 300 chars
          let cutPos = text.lastIndexOf(' ', 300);
          if (cutPos === -1) cutPos = 300;
          text = text.substring(0, cutPos) + '...';
        }
        chunks.push(text);
      }
      
      return chunks;
    } catch (err) {
      console.error("Knowledge retrieval error:", err);
      return [];
    }
  }

  /**
   * Get all knowledge entries (for admin dashboard)
   */
  async getAllKnowledge() {
    try {
      const result = await this.pool.query(
        'SELECT id, title, content, source, created_at FROM knowledge ORDER BY created_at DESC'
      );
      return result.rows;
    } catch (err) {
      console.error("Error getting all knowledge:", err);
      return [];
    }
  }

  /**
   * Add new knowledge entry
   */
  async addKnowledge(title, content, source = 'manual') {
    try {
      const result = await this.pool.query(
        'INSERT INTO knowledge(title, content, source) VALUES($1, $2, $3) RETURNING id, created_at',
        [title, content, source]
      );
      return result.rows[0];
    } catch (err) {
      console.error("Error adding knowledge:", err);
      throw err;
    }
  }

  /**
   * Update knowledge entry
   */
  async updateKnowledge(id, updates) {
    try {
      const { title, content } = updates;
      const result = await this.pool.query(
        'UPDATE knowledge SET title=$1, content=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING id, updated_at',
        [title, content, id]
      );
      return result.rows[0];
    } catch (err) {
      console.error("Error updating knowledge:", err);
      throw err;
    }
  }

  /**
   * Delete knowledge entry
   */
  async deleteKnowledge(id) {
    try {
      const result = await this.pool.query(
        'DELETE FROM knowledge WHERE id=$1 RETURNING id, title',
        [id]
      );
      return result.rows[0];
    } catch (err) {
      console.error("Error deleting knowledge:", err);
      throw err;
    }
  }
}

module.exports = AdvancedKnowledgeRetriever;