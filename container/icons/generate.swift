// Rebuild with: swift container/icons/generate.swift
import AppKit

let side = 1024
let bitmap = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
    bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
let context = NSGraphicsContext(cgContext: bitmap, flipped: false)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
let bounds = NSRect(x: 0, y: 0, width: side, height: side)
let top = NSColor(srgbRed: 0.29, green: 0.25, blue: 0.68, alpha: 1)
let bottom = NSColor(srgbRed: 0.10, green: 0.08, blue: 0.28, alpha: 1)
NSGradient(starting: bottom, ending: top)!.draw(in: bounds, angle: 90)
let configuration = NSImage.SymbolConfiguration(pointSize: 560, weight: .medium)
    .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
guard let symbol = NSImage(systemSymbolName: "square.stack.3d.up.fill", accessibilityDescription: nil)?
    .withSymbolConfiguration(configuration) else { fatalError("SF Symbol unavailable") }
let scale = min(650 / symbol.size.width, 650 / symbol.size.height)
let size = NSSize(width: symbol.size.width * scale, height: symbol.size.height * scale)
symbol.draw(in: NSRect(x: (1024 - size.width) / 2, y: (1024 - size.height) / 2,
    width: size.width, height: size.height), from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
let output = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .deletingLastPathComponent().appendingPathComponent("assets/app-icon.png")
try NSBitmapImageRep(cgImage: bitmap.makeImage()!).representation(using: .png, properties: [:])!.write(to: output)
print(output.path)
