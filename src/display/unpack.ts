import { Rect, PixelData } from "../shared/types"

//------------------------------------------------------------------------------

export function unpackNaja2(inData: Uint8Array | number[], inOffset?: number): PixelData | undefined {
  let exactSize = false
  if (inOffset == undefined) {
    inOffset = 0
    exactSize = true
  }
  let left = inData[inOffset + 0]
  let top = inData[inOffset + 1]
  let width = inData[inOffset + 2]
  let height = inData[inOffset + 3] ?? 0
  inOffset += 4

  if (width < 1 || width > 40 || left + width > 40
      || height < 1 || height > 192 || top + height > 192) {
    return
  }

  const byteWidth = width
  const bounds: Rect = {
    x: left * 7,
    y: top,
    width: width * 7,
    height: height
  }
  const pixels = new PixelData("hires", bounds, byteWidth)

  let x = 0
  let outOffset = 0
  let endOffset = width * height
  let highBit = 0x00

  while (true) {
    if (outOffset == endOffset) {
      x += 1
      outOffset = x
      endOffset = x + width * height
      if (x == width) {
        break
      }
    }

    let byte = inData[inOffset]
    if (byte == undefined) {
      return
    }

    inOffset += 1

    if (byte <= 0x7F) {
      pixels.bytes[outOffset] = byte | highBit
      outOffset += width
      continue
    }

    byte &= 0x7F

    let lowBitClear = (byte & 1) == 0
    byte >>= 1

    if (lowBitClear) {

      // flip
      if (byte == 0) {
        highBit ^= 0x80
        continue
      }

      // skip
      // TODO: allow for transparency
      while (byte > 0) {
        pixels.bytes[outOffset] = 0x00
        outOffset += width
        byte -= 1
      }
      continue
    }

    lowBitClear = (byte & 1) == 0
    byte >>= 1

    if (lowBitClear) {

      // copy 1
      if (byte == 0) {
        pixels.bytes[outOffset] = inData[inOffset] ?? 0
        outOffset += width
        inOffset += 1
        continue
      }

      // repeat 1
      let value = pixels.bytes[outOffset - width]
      while (byte > 0) {
        pixels.bytes[outOffset] = value
        outOffset += width
        byte -= 1
      }
      continue
    }

    lowBitClear = (byte & 1) == 0
    byte >>= 1

    if (lowBitClear) {

      // copy N
      if (byte == 0) {
        let count = inData[inOffset] ?? 0
        inOffset += 1
        while (count > 0) {
          pixels.bytes[outOffset] = inData[inOffset] ?? 0
          outOffset += width
          inOffset += 1
          count -= 1
        }
        continue
      }

      // repeat 2
      let valueA = pixels.bytes[outOffset - width * 2]
      let valueB = pixels.bytes[outOffset - width * 1]
      while (byte > 0) {
        pixels.bytes[outOffset] = valueA
        outOffset += width
        pixels.bytes[outOffset] = valueB
        outOffset += width
        byte -= 1
      }
      continue
    }

    // move
    let srcCount = byte << 1
    let srcX = inData[inOffset] ?? 0
    inOffset += 1
    srcCount |= (srcX & 1)
    srcX >>= 1
    let srcY = inData[inOffset] ?? 0
    inOffset += 1
    let srcOffset = srcY * width + srcX
    while (srcCount > 0) {
      pixels.bytes[outOffset] = pixels.bytes[srcOffset]
      outOffset += width
      srcOffset += width
      srcCount -= 1
    }
  }
  if (exactSize && inOffset != inData.length) {
    // check for chain termination $FF
    if (inData[inOffset] != 0xFF || inOffset + 1 != inData.length) {
      return
    }
  }
  return pixels
}

export function unpackNaja1(inData: Uint8Array | number[], inOffset?: number): PixelData | undefined {
  let exactSize = false
  if (inOffset == undefined) {
    inOffset = 0
    exactSize = true
  }
  let top = inData[inOffset + 0]
  let bottom = inData[inOffset + 1]
  let left = inData[inOffset + 2] ?? 1
  let right = inData[inOffset + 3] ?? 0
  inOffset += 4
  if (top > bottom || left > right || bottom >= 192 || right >= 40) {
    return
  }

  const width = right - left + 1
  const height = bottom - top + 1
  const byteWidth = width
  const bounds: Rect = {
    x: left * 7,
    y: top,
    width: width * 7,
    height: height
  }
  const pixels = new PixelData("hires", bounds, byteWidth)

  let count = 0
  let value = 0
  for (let x = width; --x >= 0; ) {
    for (let y = height; --y >= 0; ) {
      if (count == 0) {
        value = inData[inOffset++]
        if (value == undefined) {
          return
        }

        if (value == 0xFE) {
          count = inData[inOffset++]
          value = inData[inOffset++]
          if (value == undefined) {
            return
          }
        } else {
          count = 1
        }
      }
      pixels.bytes[y * width + x] = value
      count -= 1
    }
  }
  if (exactSize && inOffset != inData.length) {
    return
  }
  return pixels
}

//------------------------------------------------------------------------------

export function textFromNaja(byteData: number []): string {
  let indent = "                "
  let byteWidth = 24

  let text = indent + "DB  "
    + "$" + byteData[0].toString(16).toUpperCase().padStart(2, "0") + ","
    + "$" + byteData[1].toString(16).toUpperCase().padStart(2, "0") + ","
    + "$" + byteData[2].toString(16).toUpperCase().padStart(2, "0") + ","
    + "$" + byteData[3].toString(16).toUpperCase().padStart(2, "0") + "\n"

  let lineIndex = 0
  for (let i = 4; i < byteData.length; i += 1) {
    if (lineIndex == 0) {
      text += indent + "HEX "
    }
    text += byteData[i].toString(16).toUpperCase().padStart(2, "0")
    if (++lineIndex == byteWidth) {
      text += "\n"
      lineIndex = 0
    }
  }
  if (lineIndex != 0) {
    text += "\n"
  }
  text += indent + "DB  $FF\n"
  return text
}

//------------------------------------------------------------------------------

export function buildNajaMask(imageData: PixelData): PixelData {
  const maskData = new PixelData(imageData.format, imageData.bounds, imageData.byteWidth)
  let offset = 0
  for (let y = 0; y < imageData.bounds.height; y += 1) {
    for (let x = 0; x < imageData.byteWidth; x += 1) {
      if (imageData.bytes[offset + x] != 0x00) {
        maskData.bytes[offset + x] = 0x7F
      }
    }
    offset += imageData.byteWidth
  }
  return maskData
}

//------------------------------------------------------------------------------
