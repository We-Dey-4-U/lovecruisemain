const db = require('../config/db');

const ChatController = {
  // POST /api/chats  { recipientId }  -> get or create a 1:1 conversation
  async getOrCreateConversation(req, res, next) {
    try {
      const { recipientId } = req.body;
      const { rows: existing } = await db.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
         JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
         WHERE c.is_group = FALSE LIMIT 1`,
        [req.user.id, recipientId]
      );
      if (existing[0]) {
        return res.json({ success: true, data: { id: existing[0].id } });
      }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO conversations (is_group, created_by) VALUES (FALSE, $1) RETURNING *`,
          [req.user.id]
        );
        const conv = rows[0];
        await client.query(
          `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
          [conv.id, req.user.id, recipientId]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, data: conv });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      next(err);
    }
  },

  // GET /api/chats  -> list conversations for current user
  async listConversations(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT c.id, c.is_group, c.title,
                (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
                (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message_at
         FROM conversations c
         JOIN conversation_participants p ON p.conversation_id = c.id
         WHERE p.user_id = $1
         ORDER BY last_message_at DESC NULLS LAST`,
        [req.user.id]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/chats/:id/messages
  async getMessages(req, res, next) {
    try {
      const { rows: participant } = await db.query(
        `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!participant[0]) return res.status(403).json({ success: false, message: 'Not a participant' });

      const { rows } = await db.query(
        `SELECT * FROM messages WHERE conversation_id = $1 AND is_deleted = FALSE
         ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
        [req.params.id, Number(req.query.limit) || 100, Number(req.query.offset) || 0]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },

  // POST /api/chats/:id/messages  { body }
  async sendMessage(req, res, next) {
    try {
      const { body } = req.body;
      const { rows: participant } = await db.query(
        `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!participant[0]) return res.status(403).json({ success: false, message: 'Not a participant' });

      const { rows } = await db.query(
        `INSERT INTO messages (conversation_id, sender_id, body, message_type)
         VALUES ($1, $2, $3, 'text') RETURNING *`,
        [req.params.id, req.user.id, body]
      );

      const io = req.app.get('io');
      if (io) io.to(`conversation:${req.params.id}`).emit('message:new', rows[0]);

      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = ChatController;