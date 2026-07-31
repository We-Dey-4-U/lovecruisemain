import AVFoundation
import UIKit

/// Owns AVCaptureSession lifecycle and exposes the professional controls
/// the spec asks for (exposure, WB, zoom, FPS, HDR). Frames are delivered
/// via AVCaptureVideoDataOutput to `frameProcessor` for GPU post-processing
/// (beauty/sharpen/HDR tonemap) before being handed to the encoder —
/// see Effects/MetalFrameProcessor.swift for that seam.
final class CameraController: NSObject {

    enum Quality { case p720, p1080, p1440, uhd4K }

    struct CaptureConfig {
        var quality: Quality = .p1080
        var fps: Int32 = 30                 // 30 or 60
        var hdrEnabled: Bool = true
        var position: AVCaptureDevice.Position = .front
    }

    /// Implement to run beauty/sharpen/HDR-tonemap/denoise before encode.
    protocol FrameProcessor: AnyObject {
        func process(_ sampleBuffer: CMSampleBuffer)
    }

    weak var frameProcessor: FrameProcessor?

    private let session = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private var currentDevice: AVCaptureDevice?
    private let sessionQueue = DispatchQueue(label: "com.vconnect.camera.session")
    private let dataOutputQueue = DispatchQueue(label: "com.vconnect.camera.output")

    func start(config: CaptureConfig, onReady: @escaping (AVCaptureSession) -> Void, onError: @escaping (Error) -> Void) {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            do {
                try self.configureSession(config: config)
                self.session.startRunning()
                DispatchQueue.main.async { onReady(self.session) }
            } catch {
                DispatchQueue.main.async { onError(error) }
            }
        }
    }

    private func configureSession(config: CaptureConfig) throws {
        session.beginConfiguration()
        session.sessionPreset = presetFor(config.quality)

        session.inputs.forEach { session.removeInput($0) }
        session.outputs.forEach { session.removeOutput($0) }

        guard let device = bestDevice(for: config.position) else {
            throw NSError(domain: "CameraController", code: 1, userInfo: [NSLocalizedDescriptionKey: "No camera device found"])
        }
        currentDevice = device

        try configureDevice(device, config: config)

        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "CameraController", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot add camera input"])
        }
        session.addInput(input)

        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: dataOutputQueue)
        guard session.canAddOutput(videoOutput) else {
            throw NSError(domain: "CameraController", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot add video output"])
        }
        session.addOutput(videoOutput)

        // Also add an audio input here (AVCaptureDeviceInput for .audio)
        // and route to your WebRTC audio track / encoder as needed.

        session.commitConfiguration()
    }

    /// Picks the best physical/virtual device: triple/dual-wide camera
    /// where available (better low-light + HDR headroom), falling back to
    /// wide-angle. Matches the spec's "leverage device capability" intent
    /// without hardcoding a single model's sensor.
    private func bestDevice(for position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInTripleCamera, .builtInDualWideCamera, .builtInWideAngleCamera],
            mediaType: .video,
            position: position
        )
        return discovery.devices.first
    }

    private func configureDevice(_ device: AVCaptureDevice, config: CaptureConfig) throws {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }

        // Continuous AF / AE / AWB — spec requirement.
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
        if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }

        // HDR — spec requirement, where the sensor supports it.
        if device.activeFormat.isVideoHDRSupported {
            device.automaticallyAdjustsVideoHDREnabled = false
            device.isVideoHDREnabled = config.hdrEnabled
        }

        // FPS pin (30/60 per spec), validated against the active format's
        // supported ranges rather than assumed.
        let desiredFPS = Double(config.fps)
        if let match = device.activeFormat.videoSupportedFrameRateRanges.first(where: {
            desiredFPS >= $0.minFrameRate && desiredFPS <= $0.maxFrameRate
        }) {
            device.activeVideoMinFrameDuration = CMTimeMake(value: 1, timescale: config.fps)
            device.activeVideoMaxFrameDuration = CMTimeMake(value: 1, timescale: config.fps)
            _ = match
        }

        // Cinematic/optical stabilization where available.
        if let connection = videoOutput.connection(with: .video), connection.isVideoStabilizationSupported {
            connection.preferredVideoStabilizationMode = .cinematicExtended
        }
    }

    private func presetFor(_ quality: Quality) -> AVCaptureSession.Preset {
        switch quality {
        case .p720: return .hd1280x720
        case .p1080: return .hd1920x1080
        case .p1440: return .inputPriority // set active format manually for 1440p if device supports it
        case .uhd4K: return .hd4K3840x2160
        }
    }

    // MARK: - Professional controls (spec requirement)

    func setZoom(_ factor: CGFloat) {
        guard let device = currentDevice else { return }
        try? device.lockForConfiguration()
        device.videoZoomFactor = max(1.0, min(factor, device.activeFormat.videoMaxZoomFactor))
        device.unlockForConfiguration()
    }

    func setExposureBias(_ bias: Float) {
        guard let device = currentDevice else { return }
        try? device.lockForConfiguration()
        let clamped = max(device.minExposureTargetBias, min(bias, device.maxExposureTargetBias))
        device.setExposureTargetBias(clamped, completionHandler: nil)
        device.unlockForConfiguration()
    }

    func focus(at point: CGPoint) {
        guard let device = currentDevice, device.isFocusPointOfInterestSupported else { return }
        try? device.lockForConfiguration()
        device.focusPointOfInterest = point
        device.focusMode = .autoFocus
        if device.isExposurePointOfInterestSupported {
            device.exposurePointOfInterest = point
            device.exposureMode = .autoExpose
        }
        device.unlockForConfiguration()
    }

    func switchCamera(config: CaptureConfig, onReady: @escaping (AVCaptureSession) -> Void, onError: @escaping (Error) -> Void) {
        var newConfig = config
        newConfig.position = config.position == .front ? .back : .front
        start(config: newConfig, onReady: onReady, onError: onError)
    }

    func stop() {
        sessionQueue.async { [weak self] in self?.session.stopRunning() }
    }
}

extension CameraController: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frameProcessor?.process(sampleBuffer)
    }
}