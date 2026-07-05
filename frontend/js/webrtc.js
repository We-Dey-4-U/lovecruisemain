/* ==========================================================
   vConnect WebRTC
   ========================================================== */

let localStream = null;
let peerConnections = {};

const rtcConfig = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302"
      ]
    }
  ]
};

/* ==========================================================
   HOST START
   ========================================================== */

async function startHostStream(roomId) {

  try {

    localStream =
      await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

    const localVideo =
      document.getElementById("host-video");

    if (localVideo) {
      localVideo.srcObject =
        localStream;
    }

    socket.emit(
      "hostStarted",
      { roomId }
    );

  } catch (err) {

    console.error(err);

    showToast(
      "Camera access denied"
    );

  }

}

/* ==========================================================
   VIEWER JOIN
   ========================================================== */

async function joinViewerStream(roomId) {

  socket.emit(
    "viewerJoined",
    {
      roomId,
      userId: CURRENT_USER.id
    }
  );

}

/* ==========================================================
   CREATE PEER
   ========================================================== */

async function createPeerConnection(
  remoteUserId
) {

  const pc =
    new RTCPeerConnection(
      rtcConfig
    );

  peerConnections[
    remoteUserId
  ] = pc;

  pc.onicecandidate =
    event => {

      if (
        event.candidate
      ) {

        socket.emit(
          "iceCandidate",
          {
            targetUserId:
              remoteUserId,

            candidate:
              event.candidate
          }
        );

      }

    };

  return pc;

}