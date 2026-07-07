/* ============================================================
   backend/src/middlewares/optionalAuth.js
   ------------------------------------------------------------
   Unlike requireAuth, this middleware NEVER blocks the request.
   - If a valid access token is present  -> req.user is populated
   - If no token / invalid / expired     -> req.user stays undefined,
                                             request continues as guest

   Use this on routes that should work for guests too (public feed,
   viewing a single post) but still want to know who's logged in
   when a token IS present (so is_liked / is_following etc. are correct).

   ⚠️ IMPORTANT: This assumes your requireAuth middleware verifies a
   JWT signed with one of the env vars below and puts the user id at
   decoded.id (or decoded.userId). If your requireAuth.js uses a
   different secret name or payload shape, update the two lines
   marked below to match it exactly — otherwise this middleware and
   requireAuth will disagree about who's logged in.
============================================================ */

const jwt = require("jsonwebtoken");

const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ||
  process.env.JWT_SECRET ||
  process.env.ACCESS_TOKEN_SECRET; // 👈 match whatever requireAuth.js actually uses

function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token || !ACCESS_SECRET) {
      return next(); // guest — just continue
    }

    const decoded = jwt.verify(token, ACCESS_SECRET);
    req.user = { id: decoded.id || decoded.userId, ...decoded }; // 👈 match requireAuth.js payload shape

    return next();
  } catch (err) {
    // Invalid/expired token — don't fail the request, just treat as guest
    req.user = undefined;
    return next();
  }
}

module.exports = { optionalAuth };