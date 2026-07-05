const express = require("express");
const router = express.Router();

const HostAcademyController = require("../controllers/hostAcademyController");
const { requireAuth } = require("../middlewares/auth");

/* =========================================================
   DEFENSIVE CHECK
   ---------------------------------------------------------
   The previous crash here was:
     "Route.get() requires a callback function but got a
      [object Undefined]"
   Express's own error message doesn't say WHICH handler was
   undefined, which made this hard to diagnose. This block
   checks each handler explicitly before router.get/.post is
   ever called, and throws a clear, specific error naming the
   exact missing export if HostAcademyController (or auth
   middleware) doesn't shape up the way this file expects.
   Remove this block once you've confirmed startup is stable
   if you want, but it's cheap and worth keeping.
========================================================= */
function assertFn(fn, name) {
  if (typeof fn !== "function") {
    throw new TypeError(
      `[hostAcademy.routes.js] Expected "${name}" to be a function but got ${typeof fn} (${fn}). ` +
      `Check that backend/src/controllers/hostAcademyController.js exports it and that ` +
      `backend/src/middlewares/auth.js exports "requireAuth" as a named export.`
    );
  }
}

assertFn(requireAuth, "requireAuth (from ../middlewares/auth)");
assertFn(HostAcademyController.myDashboard, "HostAcademyController.myDashboard");
assertFn(HostAcademyController.checkin, "HostAcademyController.checkin");
assertFn(HostAcademyController.dashboardFor, "HostAcademyController.dashboardFor");

// ================= HOST ACADEMY =================

// GET /api/host-academy/me — must be registered BEFORE "/:userId"
// so Express doesn't swallow "/me" as a userId param.
router.get("/me", requireAuth, HostAcademyController.myDashboard);

// POST /api/host-academy/checkin
router.post("/checkin", requireAuth, HostAcademyController.checkin);

// GET /api/host-academy/:userId  (public — view another host's badge/progress)
router.get("/:userId", requireAuth, HostAcademyController.dashboardFor);

module.exports = router;