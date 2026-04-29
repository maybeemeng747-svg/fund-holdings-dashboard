import AppKit
import Foundation
import Vision

struct OCRObservation: Codable {
    let text: String
    let confidence: Float
    let bbox: [CGFloat]
}

struct OCRResult: Codable {
    let observations: [OCRObservation]
}

func runOCR(at imagePath: String) throws -> OCRResult {
    let imageURL = URL(fileURLWithPath: imagePath)
    guard let image = NSImage(contentsOf: imageURL) else {
        throw NSError(domain: "OCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法读取图片"])
    }

    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw NSError(domain: "OCR", code: 2, userInfo: [NSLocalizedDescriptionKey: "无法转成 CGImage"])
    }

    var observations: [OCRObservation] = []
    let request = VNRecognizeTextRequest { request, error in
        if let error = error {
            NSLog("OCR error: \(error.localizedDescription)")
            return
        }

        let items = (request.results as? [VNRecognizedTextObservation]) ?? []
        for item in items {
            guard let candidate = item.topCandidates(1).first else { continue }
            observations.append(
                OCRObservation(
                    text: candidate.string,
                    confidence: candidate.confidence,
                    bbox: [item.boundingBox.minX, item.boundingBox.minY, item.boundingBox.width, item.boundingBox.height]
                )
            )
        }
    }

    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage)
    try handler.perform([request])

    let sorted = observations.sorted { lhs, rhs in
        if abs(lhs.bbox[1] - rhs.bbox[1]) > 0.02 {
            return lhs.bbox[1] > rhs.bbox[1]
        }
        return lhs.bbox[0] < rhs.bbox[0]
    }
    return OCRResult(observations: sorted)
}

do {
    guard CommandLine.arguments.count >= 2 else {
        throw NSError(domain: "OCR", code: 3, userInfo: [NSLocalizedDescriptionKey: "缺少图片路径"])
    }
    let result = try runOCR(at: CommandLine.arguments[1])
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(result)
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
