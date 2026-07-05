const db = require('../config/db');

const CallController = {
  // POST /api/calls  { calleeId, callType }
  async initiate(req, res, next) {
    try {
      const { calleeId, callType } = req.body;
      if (!['voice', 'video'].includes(callType)) {
        return res.status(400).json({ success: false, message: 'callType must be voice or video' });
      }
      const { rows } = await db.query(
        `INSERT INTO calls (caller_id, callee_id, call_type, status) VALUES ($1, $2, $3, 'ringing') RETURNING *`,
        [req.user.id, calleeId, callType]
      );

      const io = req.app.get('io');
      if (io) io.to(`user:${calleeId}`).emit('call:incoming', rows[0]);

      res.status(201).json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/calls/:id  { status: accepted|rejected|ended }
  async updateStatus(req, res, next) {
    try {
      const { status } = req.body;
      const fields = { status };
      if (status === 'accepted') fields.started_at = new Date();
      if (status === 'ended') fields.ended_at = new Date();

      const { rows: existing } = await db.query('SELECT * FROM calls WHERE id = $1', [req.params.id]);
      const call = existing[0];
      if (!call) return res.status(404).json({ success: false, message: 'Call not found' });

      let durationSeconds = call.duration_seconds;
      if (status === 'ended' && call.started_at) {
        durationSeconds = Math.round((Date.now() - new Date(call.started_at).getTime()) / 1000);
      }

      const { rows } = await db.query(
        `UPDATE calls SET status = $1,
                started_at = COALESCE($2, started_at),
                ended_at = COALESCE($3, ended_at),
                duration_seconds = COALESCE($4, duration_seconds)
         WHERE id = $5 RETURNING *`,
        [status, fields.started_at || null, fields.ended_at || null, durationSeconds, req.params.id]
      );

      const io = req.app.get('io');
      const otherUserId = call.caller_id === req.user.id ? call.callee_id : call.caller_id;
      if (io) io.to(`user:${otherUserId}`).emit('call:status', rows[0]);

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      next(err);
    }
  },

  // GET /api/calls/history
  async history(req, res, next) {
    try {
      const { rows } = await db.query(
        `SELECT * FROM calls WHERE caller_id = $1 OR callee_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [req.user.id]
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = CallController;