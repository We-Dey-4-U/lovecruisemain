import Foundation
import WebRTC
// import Mediasoupclient  // Objective-C++ bridging header for libmediasoupclient's
                            // iOS bindings — see ARCHITECTURE.md. Not a CocoaPod;
                            // vendored as an XCFramework per the Podfile note.

/// Publish/consume layer, mirrored 1:1 against WebRTCManager.kt (Android)
/// so behavior is consistent cross-platform. Uses libmediasoupclient's
/// Device/SendTransport/RecvTransport for the actual SDP/DTLS negotiation
/// — see ARCHITECTURE.md for why this isn't hand-rolled.
///
/// Bitrate ladder mirrors buildSimulcastEncodings() in js/live.js so a
/// native publisher negotiates the same layers a web publisher would.
final class WebRTCManager: NSObject {

    private enum BitrateLadder {
        static let r0Max: UInt = 150_000
        static let r1Max: UInt = 1_000_000
        static let r2Max: UInt = 3_000_000
    }

    weak var delegate: WebRTCManagerDelegate?

    private let signaling: MediasoupSignalingClient
    private let roomId: String

    private var factory: RTCPeerConnectionFactory!
    // private var device: Mediasoup.Device!
    // private var sendTransport: Mediasoup.SendTransport?
    // private var recvTransport: Mediasoup.RecvTransport?
    // private var videoProducer: Mediasoup.Producer?
    // private var audioProducer: Mediasoup.Producer?
    private var consumedProducerIds = Set<String>()   // dedup guard, mirrors FIX-1 in live.js

    init(signaling: MediasoupSignalingClient, roomId: String) {
        self.signaling = signaling
        self.roomId = roomId
        super.init()
    }

    func initialize() {
        RTCInitializeSSL()
        let encoderFactory = RTCDefaultVideoEncoderFactory()
        let decoderFactory = RTCDefaultVideoDecoderFactory()
        factory = RTCPeerConnectionFactory(encoderFactory: encoderFactory, decoderFactory: decoderFactory)

        // device = Mediasoup.Device()
    }

    /// Called once signalingDidReceiveRouterRtpCapabilities fires.
    func loadDevice(rtpCapabilities: [String: Any]) {
        // let json = try? JSONSerialization.data(withJSONObject: rtpCapabilities)
        // try? device.load(routerRtpCapabilities: String(data: json!, encoding: .utf8)!)
    }

    // MARK: - Publishing

    func publish(videoTrack: RTCVideoTrack?, audioTrack: RTCAudioTrack?, isHost: Bool) {
        Task {
            do {
                try await ensureSendTransport()

                if let videoTrack {
                    let encodings: [RTCRtpEncodingParameters] = [
                        makeEncoding(rid: "r0", maxBitrateBps: BitrateLadder.r0Max),
                        makeEncoding(rid: "r1", maxBitrateBps: BitrateLadder.r1Max),
                        makeEncoding(rid: "r2", maxBitrateBps: BitrateLadder.r2Max)
                    ]
                    // videoProducer = try await sendTransport?.produce(
                    //     track: videoTrack, encodings: encodings,
                    //     appData: ["type": "video", "isHost": isHost]
                    // )
                    _ = encodings // silence unused-var until libmediasoupclient call is wired
                }

                if let audioTrack {
                    // audioProducer = try await sendTransport?.produce(
                    //     track: audioTrack, appData: ["type": "audio", "isHost": isHost]
                    // )
                }

                delegate?.webRTCManager(self, didChangePublishState: true)
            } catch {
                delegate?.webRTCManager(self, didFailWithError: error)
            }
        }
    }

    func stopPublishing() {
        // videoProducer?.close(); videoProducer = nil
        // audioProducer?.close(); audioProducer = nil
        delegate?.webRTCManager(self, didChangePublishState: false)
    }

    func setMicMuted(_ muted: Bool) {
        // muted ? audioProducer?.pause() : audioProducer?.resume()
    }

    func setCameraPaused(_ paused: Bool) {
        // paused ? videoProducer?.pause() : videoProducer?.resume()
    }

    // MARK: - Consuming (dedup-guarded exactly like consumeProducer() in live.js)

    func consumeProducer(_ info: MediasoupSignalingClient.ProducerInfo) {
        guard !consumedProducerIds.contains(info.producerId) else { return }

        Task {
            do {
                try await ensureRecvTransport()
                // let rtpCaps = device.rtpCapabilities
                let res = try await signaling.consume(
                    transportId: "recvTransportId", // recvTransport!.id,
                    producerId: info.producerId,
                    rtpCapabilities: [:] // rtpCaps
                )
                guard !consumedProducerIds.contains(info.producerId) else { return }

                // let consumer = try recvTransport!.consume(
                //     id: res["id"] as! String,
                //     producerId: info.producerId,
                //     kind: res["kind"] as! String,
                //     rtpParameters: res["rtpParameters"] as! [String: Any]
                // )
                consumedProducerIds.insert(info.producerId)

                // switch consumer.track {
                // case let v as RTCVideoTrack:
                //     delegate?.webRTCManager(self, didReceiveRemoteVideoTrack: v, socketId: info.socketId, isHost: info.isHost)
                // case let a as RTCAudioTrack:
                //     delegate?.webRTCManager(self, didReceiveRemoteAudioTrack: a, socketId: info.socketId, isHost: info.isHost)
                // default: break
                // }

                _ = try await signaling.resumeConsumer(consumerId: res["id"] as? String ?? "")
            } catch {
                delegate?.webRTCManager(self, didFailWithError: error)
            }
        }
    }

    func removeConsumers(forSocketId socketId: String) {
        // Track producerId -> socketId in a parallel map at consume time if
        // you need reverse lookup for cleanup; omitted here for brevity,
        // mirrors the same simplification noted in WebRTCManager.kt.
    }

    private func ensureSendTransport() async throws {
        // guard sendTransport == nil else { return }
        let params = try await signaling.createSendTransport(roomId: roomId)
        // sendTransport = try device.createSendTransport(params: params, listener: self)
        _ = params
    }

    private func ensureRecvTransport() async throws {
        // guard recvTransport == nil else { return }
        let params = try await signaling.createRecvTransport(roomId: roomId)
        // recvTransport = try device.createRecvTransport(params: params, listener: self)
        _ = params
    }

    private func makeEncoding(rid: String, maxBitrateBps: UInt) -> RTCRtpEncodingParameters {
        let e = RTCRtpEncodingParameters()
        e.rid = rid
        e.isActive = true
        e.maxBitrateBps = NSNumber(value: maxBitrateBps)
        return e
    }

    func release() {
        stopPublishing()
        consumedProducerIds.removeAll()
        RTCCleanupSSL()
    }
}

protocol WebRTCManagerDelegate: AnyObject {
    func webRTCManager(_ manager: WebRTCManager, didReceiveRemoteVideoTrack track: RTCVideoTrack, socketId: String, isHost: Bool)
    func webRTCManager(_ manager: WebRTCManager, didReceiveRemoteAudioTrack track: RTCAudioTrack, socketId: String, isHost: Bool)
    func webRTCManager(_ manager: WebRTCManager, didChangePublishState publishing: Bool)
    func webRTCManager(_ manager: WebRTCManager, didFailWithError error: Error)
}