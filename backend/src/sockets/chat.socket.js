module.exports = (io, socket) => {

    socket.on("joinConversation", (conversationId) => {
        socket.join(`conversation:${conversationId}`);
    });

    socket.on("leaveConversation", (conversationId) => {
        socket.leave(`conversation:${conversationId}`);
    });

    socket.on("typing", ({ conversationId, userId }) => {

        socket.to(`conversation:${conversationId}`).emit(
            "userTyping",
            { userId }
        );

    });

    socket.on("stopTyping", ({ conversationId, userId }) => {

        socket.to(`conversation:${conversationId}`).emit(
            "userStoppedTyping",
            { userId }
        );

    });

    socket.on("newMessage", (message) => {

        io.to(`conversation:${message.conversation_id}`)
            .emit("messageReceived", message);

    });

};