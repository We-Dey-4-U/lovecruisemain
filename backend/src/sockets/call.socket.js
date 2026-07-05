module.exports = (io, socket) => {

    socket.on("callOffer", (payload) => {

        io.to(`user:${payload.calleeId}`)
            .emit("incomingCall", payload);

    });

    socket.on("callAnswer", (payload) => {

        io.to(`user:${payload.callerId}`)
            .emit("callAnswered", payload);

    });

    socket.on("iceCandidate", (payload) => {

        io.to(`user:${payload.targetUserId}`)
            .emit("iceCandidate", payload);

    });

    socket.on("endCall", (payload) => {

        io.to(`user:${payload.targetUserId}`)
            .emit("callEnded", payload);

    });

};