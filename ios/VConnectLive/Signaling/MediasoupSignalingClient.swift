import Foundation
import SocketIO

/// Talks to the exact same backend your web client (js/live.js) already
/// uses — no server changes required. Event names, payload shapes, and the
/// ack-callback pattern below are copied 1:1 from that file.
///
/// Base socket host = API_BASE_URL with the trailing /api stripped, same
/// rule as computeSocketBaseUrl() in js/api.js.
final class MediasoupSignalingClient {

    struct ProducerInfo {
        let producerId: String
        let socketId: String
        let userId: String?
        let kind: String   // "audio" | "video"
        let isHost: Bool
    }

    enum SignalingError: Error { case timeout, ackError(String), notConnected }

    weak var delegate: MediasoupSignalingClientDelegate?

    private var manager: SocketManager?
    private var socket: SocketIOClient?

    init(socketBaseUrl: String) {
        guard let url = URL(string: socketBaseUrl) else { return }
        manager = SocketManager(socketURL: url, config: [
            .log(false),
            .compress,
            .forceWebsockets(false),          // allow polling→websocket upgrade, same as live.js
            .reconnects(true),
            .reconnectAttempts(5),
            .reconnectWait(1)
        ])
        socket = manager?.defaultSocket
        registerHandlers()
    }

    func connect() { socket?.connect() }

    func disconnect() {
        socket?.disconnect()
        socket?.removeAllHandlers()
    }

    private func registerHandlers() {
        guard let socket else { return }

        socket.on(clientEvent: .connect) { [weak self] _, _ in
            self?.delegate?.signalingDidConnect()
        }
        socket.on(clientEvent: .disconnect) { [weak self] data, _ in
            self?.delegate?.signalingDidDisconnect(reason: (data.first as? String) ?? "unknown")
        }
        socket.on(clientEvent: .error) { [weak self] data, _ in
            self?.delegate?.signalingDidError(message: "\(data.first ?? "unknown")")
        }

        socket.on("routerRtpCapabilities") { [weak self] data, _ in
            guard let obj = data.first as? [String: Any],
                  let rtp = obj["rtpCapabilities"] as? [String: Any] else { return }
            self?.delegate?.signalingDidReceiveRouterRtpCapabilities(rtp)
        }

        socket.on("existingProducers") { [weak self] data, _ in
            guard let arr = data.first as? [[String: Any]] else { return }
            let producers = arr.compactMap { self?.parseProducer($0) }
            self?.delegate?.signalingDidReceiveExistingProducers(producers)
        }

        socket.on("newProducer") { [weak self] data, _ in
            guard let obj = data.first as? [String: Any], let p = self?.parseProducer(obj) else { return }
            self?.delegate?.signalingDidReceiveNewProducer(p)
        }

        socket.on("peerLeft") { [weak self] data, _ in
            guard let obj = data.first as? [String: Any], let socketId = obj["socketId"] as? String else { return }
            self?.delegate?.signalingPeerLeft(socketId: socketId)
        }

        socket.on("hostLeft") { [weak self] _, _ in self?.delegate?.signalingHostLeft() }
        socket.on("liveEnded") { [weak self] _, _ in self?.delegate?.signalingLiveEnded() }
        socket.on("youWereKicked") { [weak self] _, _ in self?.delegate?.signalingYouWereKicked() }
    }

    private func parseProducer(_ o: [String: Any]) -> ProducerInfo {
        ProducerInfo(
            producerId: o["producerId"] as? String ?? "",
            socketId: o["socketId"] as? String ?? "",
            userId: o["userId"] as? String,
            kind: o["kind"] as? String ?? "",
            isHost: o["isHost"] as? Bool ?? false
        )
    }

    func registerUser(_ userId: String) { socket?.emit("registerUser", userId) }

    func joinRoom(roomId: String, userId: String) {
        socket?.emit("joinRoom", ["roomId": roomId, "userId": userId])
    }

    func leaveRoom(roomId: String) { socket?.emit("leaveRoom", ["roomId": roomId]) }
    func leaveMicSeat(roomId: String) { socket?.emit("leaveMicSeat", ["roomId": roomId]) }
    func leaveGuestSeat(roomId: String) { socket?.emit("leaveGuestSeat", ["roomId": roomId]) }

    // MARK: - Ack-based requests (mirrors socket.emit(..., cb) in live.js)

    func createSendTransport(roomId: String) async throws -> [String: Any] {
        try await emitWithAck("createSendTransport", ["roomId": roomId])
    }

    func createRecvTransport(roomId: String) async throws -> [String: Any] {
        try await emitWithAck("createRecvTransport", ["roomId": roomId])
    }

    func connectTransport(transportId: String, dtlsParameters: [String: Any]) async throws -> [String: Any] {
        try await emitWithAck("connectTransport", ["transportId": transportId, "dtlsParameters": dtlsParameters])
    }

    func produce(transportId: String, kind: String, rtpParameters: [String: Any], appData: [String: Any]) async throws -> [String: Any] {
        try await emitWithAck("produce", [
            "transportId": transportId, "kind": kind,
            "rtpParameters": rtpParameters, "appData": appData
        ])
    }

    func consume(transportId: String, producerId: String, rtpCapabilities: [String: Any]) async throws -> [String: Any] {
        try await emitWithAck("consume", [
            "transportId": transportId, "producerId": producerId, "rtpCapabilities": rtpCapabilities
        ], timeout: 10)
    }

    func resumeConsumer(consumerId: String) async throws -> [String: Any] {
        try await emitWithAck("resumeConsumer", ["consumerId": consumerId])
    }

    func requestMicSeat(roomId: String, seatIndex: Int) async throws -> [String: Any] {
        try await emitWithAck("requestMicSeat", ["roomId": roomId, "seatIndex": seatIndex])
    }

    func requestGuestSeat(roomId: String, slot: String) async throws -> [String: Any] {
        try await emitWithAck("requestGuestSeat", ["roomId": roomId, "slot": slot])
    }

    private func emitWithAck(_ event: String, _ payload: [String: Any], timeout: Double = 8) async throws -> [String: Any] {
        guard let socket else { throw SignalingError.notConnected }
        return try await withCheckedThrowingContinuation { continuation in
            socket.emitWithAck(event, payload).timingOut(after: timeout) { response in
                guard let res = response.first as? [String: Any] else {
                    continuation.resume(throwing: SignalingError.timeout)
                    return
                }
                if let err = res["error"] as? String {
                    continuation.resume(throwing: SignalingError.ackError(err))
                } else {
                    continuation.resume(returning: res)
                }
            }
        }
    }
}

protocol MediasoupSignalingClientDelegate: AnyObject {
    func signalingDidConnect()
    func signalingDidDisconnect(reason: String)
    func signalingDidError(message: String)
    func signalingDidReceiveRouterRtpCapabilities(_ rtpCapabilities: [String: Any])
    func signalingDidReceiveExistingProducers(_ producers: [MediasoupSignalingClient.ProducerInfo])
    func signalingDidReceiveNewProducer(_ producer: MediasoupSignalingClient.ProducerInfo)
    func signalingPeerLeft(socketId: String)
    func signalingHostLeft()
    func signalingLiveEnded()
    func signalingYouWereKicked()
}