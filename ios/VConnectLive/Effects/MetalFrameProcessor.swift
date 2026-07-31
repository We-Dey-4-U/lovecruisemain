import CoreMedia
import Metal
import CoreImage

/// Integration seam for GPU post-processing + the AI effects SDK, iOS side.
/// Mirrors GLFrameProcessor.kt on Android — same contract, same honest
/// phase-4 status. See ARCHITECTURE.md.
///
/// Real implementation path:
///   1. Wrap each CMSampleBuffer's CVPixelBuffer as a CIImage.
///   2. Run a CIFilter chain (sharpen: CISharpenLuminance, contrast/
///      saturation: CIColorControls, gamma: CIGammaAdjust, HDR tonemap:
///      custom CIKernel or CIToneCurve) — or a hand-written Metal compute
///      pipeline if you need more control/perf than CoreImage's default
///      GPU scheduling gives you.
///   3. If you've licensed a beauty SDK (Banuba/Agora/ZEGO/BytePlus),
///      check its iOS integration guide for whether it wants the
///      CVPixelBuffer directly or a Metal texture — most iOS beauty SDKs
///      plug in at this exact stage.
///   4. Render into a CVPixelBuffer backed by your VideoToolbox
///      (VTCompressionSession) encoder's input pool for a zero-copy path.
final class MetalFrameProcessor: CameraController.FrameProcessor {

    struct Params {
        var sharpness: Float = 0.45
        var contrast: Float = 1.06
        var saturation: Float = 1.08
        var gamma: Float = 1.0
        var beautySmoothing: Float = 0.0   // 0 until an SDK/kernel is wired
        var hdrToneMapEnabled: Bool = true
    }

    var params = Params()

    private let device: MTLDevice?
    private let ciContext: CIContext?

    init() {
        device = MTLCreateSystemDefaultDevice()
        ciContext = device.map { CIContext(mtlDevice: $0) }
    }

    func process(_ sampleBuffer: CMSampleBuffer) {
        // TODO(phase 4): CIFilter/Metal chain per ARCHITECTURE.md phase 4.
        // For now this is an intentional pass-through so the pipeline is
        // functionally correct end-to-end (camera → encoder → mediasoup)
        // while visual tuning happens against real hardware.
    }
}