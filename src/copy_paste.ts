
import { PixelData } from "./shared"
import { DisplayFormat } from "./display/format"

// dbug-only
// import { packNaja2 } from "./pack"
// import { unpackNaja1, unpackNaja2, textFromNaja, buildNajaMask } from "./unpack"
// import { SourceDocBuilder } from "./source_builder"

//------------------------------------------------------------------------------

type Header = {
  format?: string
  x?: number
  y?: number
  width?: number
  height?: number
  mask?: boolean
  vertical?: boolean
}

//------------------------------------------------------------------------------

export function textFromPixels(pixelData: PixelData, maskData?: PixelData, compress: boolean = false): string {

  // if (compress) {
  //   if (pixelData.format == "hires") {
  //     // NOTE: assumes mask has already been applied to pixels
  //     const byteData = packNaja2(pixelData)
  //     return textFromNaja(byteData)
  //   }
  // }

  let text = ""
  let indent = "                "

  const useHex = true     // TODO: get from settings
  const upperCase = false // TODO: get from settings
  const vertical = false  // TODO: parameter?

  let opcode = pixelData.byteWidth == 1 ? "db " : "hex"
  if (!useHex) {
    opcode = ".byte"
  }

  for (let pass = 0; pass < 2; pass += 1) {
    const image = pass == 0 ? pixelData : maskData
    if (!image) {
      continue
    }

    if (image.byteWidth == 1) {
      for (let i = 0; i < image.bytes.length; i += 1) {
        text += indent + opcode + " "
          + "%" + image.bytes[i].toString(2).padStart(8, "0") + "\n"
      }
    } else {
      let dataBytes = image.bytes

      // NOTE: this doesn't work for LORES or DLORES
      if (vertical) {
        dataBytes = new Uint8Array(dataBytes.length)
        const height = dataBytes.length / image.byteWidth
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < image.byteWidth; x += 1) {
            const value = image.bytes[y * image.byteWidth + x]
            dataBytes[x * height + y] = value
          }
        }
        image.byteWidth = Math.min(height, 8)
      }

      if (useHex) {
        let lineIndex = 0
        for (let i = 0; i < dataBytes.length; i += 1) {
          if (lineIndex == 0) {
            text += indent + opcode + " "
          }
          text += dataBytes[i].toString(16).padStart(2, "0")
          if (++lineIndex == image.byteWidth) {
            text += "\n"
            lineIndex = 0
          }
        }
        if (lineIndex != 0) {
          text += "\n"
        }
      } else {
        let lineIndex = 0
        for (let i = 0; i < dataBytes.length; i += 1) {
          if (lineIndex == 0) {
            text += indent + opcode + " "
          } else {
            text += ","
          }
          text += "$" + dataBytes[i].toString(16).padStart(2, "0")
          if (++lineIndex == image.byteWidth) {
            text += "\n"
            lineIndex = 0
          }
        }
        if (lineIndex != 0) {
          text += "\n"
        }
      }
    }
  }

  if (upperCase) {
    text = text.toUpperCase()
  }

  let header = indent
  header += ";{"
  header += `"format": "${pixelData.format}"`
  header += `,"x":${pixelData.bounds.x},"y":${pixelData.bounds.y}`
  header += `,"width":${pixelData.bounds.width},"height":${pixelData.bounds.height}`
  if (maskData) {
    header += ',"mask": true'
  }
  if (vertical) {
    header += ',"vertical": true'
  }
  header += "}\n"

  text = header + text
  return text
}

export function imageFromText(clipText: string, screenFormat: DisplayFormat): { pixelData?: PixelData, maskData?: PixelData } {

  const lines = clipText.split(/\r?\n/)
  const doc = SourceDocBuilder.buildRawDoc(lines)

  let pixelData: PixelData | undefined
  let maskData: PixelData | undefined
  let rawData: number[] = []
  let header: any
  let widthGuess = 0

  for (let srcLine of doc.sourceLines) {
    let opcode = srcLine.opcode.toLowerCase()
    if (srcLine.comment.startsWith(";{")) {
      try {
        header = JSON.parse(srcLine.comment.slice(1))
        if (header?.format !== undefined) {
          if (header.format != screenFormat.name) {
            if (header.format.startsWith("lores")) {
              if (screenFormat.name.startsWith("dlores")) {
                // allow this conversion
              } else {
                return {}
              }
            } else if (header.format.startsWith("dlores")) {
              if (screenFormat.name.startsWith("lores")) {
                // allow this conversion
              } else {
                return {}
              }
            } else {
              return {}
            }
          }
        }
      } catch {
      }
    }
    if (opcode == "hex") {
      let argStr = srcLine.args
      let width = 0
      for (let i = 0; i < argStr.length; i += 2) {
        let hexStr = argStr.substring(i, i + 2)
        let value = parseInt(hexStr, 16)
        rawData.push(value)
        width += 1
      }
      if (widthGuess == 0) {
        widthGuess = screenFormat.calcPixelWidth(width)
      }
    } else if (opcode == "dfb" || opcode == "dc.b" || opcode == "db" || opcode == ".byte") {
      let argStr = srcLine.args
      let hexStr: string
      let width = 0
      while (argStr.length > 0) {
        let i = argStr.indexOf(",")
        if (i != -1) {
          hexStr = argStr.substring(0, i)
          argStr = argStr.substring(i + 1)
        } else {
          hexStr = argStr
          argStr = ""
        }

        let base = 10
        if (hexStr[0] == "$") {
          hexStr = hexStr.substring(1)
          base = 16
        } else if (hexStr[0] == "%") {
          hexStr = hexStr.substring(1)
          base = 2
        }
        let value = parseInt(hexStr, base)
        rawData.push(value)
        width += 1
      }
      if (widthGuess == 0) {
        widthGuess = screenFormat.calcPixelWidth(width)
      }
    }
  }

  const hasMask = header?.mask ?? false
  const formatName = header?.format ?? screenFormat.name

  // if (formatName == "hires") {
  //   if (!hasMask) {
  //     let najaImage = unpackNaja1(rawData)
  //     if (!najaImage) {
  //       najaImage = unpackNaja2(rawData)
  //     }
  //     if (najaImage) {
  //       const maskImage = buildNajaMask(najaImage)
  //       return { pixelData: najaImage, maskData: maskImage }
  //     }
  //   }
  // }

  if (widthGuess == 0) {
    widthGuess = screenFormat.calcPixelWidth(rawData.length)
  }

  let bounds = {
    x: header?.x ?? 0,
    y: header?.y ?? 0,
    width: header?.width ?? widthGuess,
    height: header?.height ?? 0
  }

  if (bounds.height == 0) {
    const byteWidthGuess = screenFormat.calcByteWidth(bounds.x, bounds.width)
    const heightGuess = rawData.length / byteWidthGuess
    if (heightGuess == Math.floor(heightGuess)) {
      bounds.height = heightGuess
    } else {
      bounds.width = screenFormat.calcPixelWidth(rawData.length)
      bounds.height = 1
    }
  }

  const byteWidth = screenFormat.calcByteWidth(bounds.x, bounds.width)
  const halfSize = Math.floor(rawData.length / 2)
  const rawPixels = hasMask ? rawData.slice(0, halfSize) : rawData
  pixelData = new PixelData(formatName, bounds, byteWidth, new Uint8Array(rawPixels))

  if (hasMask) {
    const rawMask = rawData.slice(halfSize)
    maskData = new PixelData(formatName, bounds, byteWidth, new Uint8Array(rawMask))
  }

  return { pixelData, maskData }
}

//------------------------------------------------------------------------------

// if (false) {  // !dbug-only

// Stub classes for use when full SourceDoc code not available.
// TODO: revisit this once debugger code is integrated

class SourceDocBuilder {
  public static buildRawDoc(lines: string[]): SourceDoc {
    return new SourceDoc(lines)
  }
}

class SourceDoc {
  public sourceLines: SourceLine[] = []
  private isRawText = true

  constructor(lines: string[]) {
    for (let line of lines) {
      this.sourceLines.push(this.parseLine(line))
    }
  }

  private parseLine(inStr: string): SourceLine {

    // replace tabs with 4 spaces
    let lineStr = ""
    let startColumn = this.isRawText ? 0 : 23
    for (let i = startColumn; i < inStr.length; ++i) {
      if (inStr[i] == '\t') {
        let tabSize = 4 - (lineStr.length & 3)
        lineStr = lineStr.padEnd(lineStr.length + tabSize)
      } else {
        lineStr += inStr[i]
      }
    }

    let outLine = new SourceLine()
    // outLine.objData = this.builder.currentDoc.objData
    // outLine.objLength = 0
    // outLine.objOffset = outLine.objData.length

    // look for line start comment

    if (lineStr[0] == "*" || lineStr[0] == ";") {
      outLine.comment = lineStr
    } else {
      // look for label

      let labelLength = lineStr.length
      for (let i = 0; i < lineStr.length; ++i) {
        if (lineStr[i] == " " || lineStr[i] == ";") {
          labelLength = i
          break
        }
      }

      let commentColumn = lineStr.indexOf(" ;")
      if (commentColumn != -1) {
        commentColumn += 1
      }

      if (labelLength != 0) {
        outLine.label = lineStr.substring(0, labelLength)
        lineStr = lineStr.substring(labelLength)
      }

      // after label, no longer care about leading/trailing spaces
      lineStr = lineStr.trim()

      // look for opcode mnemonic

      if (lineStr != "" && lineStr[0] != ";") {
        let opLength = lineStr.length
        for (let i = 0; i < lineStr.length; ++i) {
          if (lineStr[i] == " " || lineStr[i] == ";") {
            opLength = i
            break
          }
        }

        if (opLength != 0) {
          outLine.opcode = lineStr.substring(0, opLength)
          lineStr = lineStr.substring(opLength)
        }

        lineStr = lineStr.trim()
      }

      // look for arguments

      if (lineStr != "" && lineStr[0] != ";") {
        let argLength = lineStr.length
        for (let i = 0; i < lineStr.length; ++i) {
          if (lineStr[i] == " ") {
            if (i + 1 < lineStr.length && lineStr[i + 1] == ";") {
              argLength = i
              break
            }
          }
        }

        if (argLength != 0) {
          outLine.args = lineStr.substring(0, argLength).trim()
          lineStr = lineStr.substring(argLength)
        }

        lineStr = lineStr.trim()
      }

      // look for comment

      if (lineStr != "" && lineStr[0] == ";") {
        outLine.comment = lineStr
        if (commentColumn != -1) {
          outLine.commentColumn = commentColumn
        }
        lineStr = ""
      }
    }

    return outLine
  }
}

class SourceLine {
  public label: string = ""
  public opcode: string = ""
  public args: string = ""
  public comment: string = ""
  commentColumn?: number
}

// } // !dbug-only

//------------------------------------------------------------------------------
