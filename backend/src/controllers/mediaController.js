// backend/src/controllers/mediaController.js
//
// Runs on the API process. This is how clients find out WHICH media
// node to open their WebRTC signaling socket against.

const roomAssignmentService = require("../services/roomAssignmentService");
const mediaNodeRegistry = require("../services/mediaNodeRegistry");

const MediaController = {
  /**
   * GET /api/media/assign/:roomType/:roomId?region=eu-west
   * roomType: "live" | "radio"
   */
  async assign(req, res, next) {
    try {
      const { roomType, roomId } = req.params;
      const preferredRegion = req.query.region || req.headers["x-client-region"] || null;

      const assignment = await roomAssignmentService.assignNode({
        roomId,
        roomType,
        preferredRegion,
      });

      res.json({
        success: true,
        data: {
          nodeId: assignment.nodeId,
          publicUrl: assignment.publicUrl,
          region: assignment.region,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/media/release/:roomId
   * Called when a live room / broadcast ends, so the assignment
   * doesn't linger until its TTL naturally expires.
   */
  async release(req, res, next) {
    try {
      await roomAssignmentService.releaseAssignment(req.params.roomId);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/media/nodes  (admin only)
   * Cluster visibility for an ops/admin dashboard.
   */
  async listNodes(req, res, next) {
    try {
      const nodes = await mediaNodeRegistry.listActiveNodes();
      res.json({ success: true, data: nodes });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = MediaController;