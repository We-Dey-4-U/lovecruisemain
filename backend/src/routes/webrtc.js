router.get(
  "/webrtc/config",
  requireAuth,
  (req,res)=>{
     res.json(
       require("../config/webrtc")
     );
  }
);

router.get(
  "/:id/top-gifters",
  requireAuth,
  liveRoomController.topGifters
);