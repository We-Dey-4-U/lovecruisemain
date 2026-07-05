const { Server } = require("socket.io");

const registerChatSocket = require("./chat.socket");
const registerCallSocket = require("./call.socket");
const registerStreamSocket = require("./stream.socket");
const registerGiftSocket = require("./gift.socket");
const registerPresenceSocket = require("./presence.socket");
const registerNotificationSocket = require("./notification.socket");

module.exports = (httpServer) => {
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on("connection", (socket) => {

        registerChatSocket(io, socket);
        registerCallSocket(io, socket);
        registerStreamSocket(io, socket);
        registerGiftSocket(io, socket);
        registerPresenceSocket(io, socket);
        registerNotificationSocket(io, socket);

    });

    return io;
};