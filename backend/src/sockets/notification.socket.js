module.exports = (io, socket) => {

    socket.on("sendNotification", (payload) => {

        io.to(`user:${payload.userId}`)
            .emit("notification", payload);

    });

};