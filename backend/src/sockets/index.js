// backend/src/sockets/index.js

const { Server } = require("socket.io");

const registerChatSocket = require("./chat.socket");
const registerCallSocket = require("./call.socket");
const registerStreamSocket = require("./stream.socket");
const registerGiftSocket = require("./gift.socket");
const registerPresenceSocket = require("./presence.socket");
const registerNotificationSocket = require("./notification.socket");
const registerRadioSocket = require("./radio.socket");
const registerRadioQueueSocket = require("./radioQueue.socket");
const registerRadioMediaSocket = require("./radioMedia.socket");
const attachRedisAdapter = require("./redisAdapter");

console.log("================================");
console.log("RadioQueue import:");
console.log(typeof registerRadioQueueSocket);
console.log(registerRadioQueueSocket);
console.log("RadioMedia import:");
console.log(typeof registerRadioMediaSocket);
console.log(registerRadioMediaSocket);
console.log("================================");

module.exports = function socketSetup(httpServer) {

    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // THIS PASS: attach the Redis adapter immediately after creating
    // the server, BEFORE io.on("connection", ...) is registered below.
    // On this single VPS it changes nothing observable — Socket.IO's
    // default in-memory adapter already handles single-process rooms
    // correctly, and everything downstream (joinRoom, joinRadio, every
    // io.to(...).emit(...) call in stream.socket.js/radio.socket.js/
    // radioMedia.socket.js) is completely unchanged. It only becomes
    // load-bearing once you run more than one API/socket process.
    attachRedisAdapter(io);

    io.on("connection", (socket) => {

        console.log("Socket Connected:", socket.id);

        registerChatSocket(io, socket);
        registerCallSocket(io, socket);
        registerStreamSocket(io, socket);
        registerGiftSocket(io, socket);
        registerPresenceSocket(io, socket);
        registerNotificationSocket(io, socket);
        registerRadioSocket(io, socket);
        registerRadioQueueSocket(io, socket);
        registerRadioMediaSocket(io, socket);

    });

    return io;
};