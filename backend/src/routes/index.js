const router = require("express").Router();

router.use("/auth", require("./auth.routes"));
router.use("/users", require("./user.routes"));
router.use("/chats", require("./chat.routes"));
router.use("/calls", require("./call.routes"));
router.use("/gifts", require("./gift.routes"));
router.use("/payments", require("./payment.routes"));
router.use("/stories", require("./story.routes"));
router.use("/notifications", require("./notification.routes"));
router.use("/live", require("./liveRoom.routes"));
router.use("/admin", require("./admin.routes"));

module.exports = router;