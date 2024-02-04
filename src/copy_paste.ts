
import { PixelData } from "./shared"

//------------------------------------------------------------------------------

export function textFromPixels(image: PixelData): string {
  let text = ""
  let indent = "                "
  let byteWidth = Math.floor((image.bounds.x + image.bounds.width + 6) / 7) - Math.floor(image.bounds.x / 7)

  text += indent
  text += `;{"x":${image.bounds.x},"y":${image.bounds.y}`
  text += `,"width":${image.bounds.width},"height":${image.bounds.height}}\n`

  if (byteWidth == 1) {
    for (let i = 0; i < image.dataBytes.length; i += 1) {
      text += indent + "DB  "
        + "%" + image.dataBytes[i].toString(2).padStart(8, "0") + "\n"
    }
  } else {
    let lineIndex = 0
    for (let i = 0; i < image.dataBytes.length; i += 1) {
      if (lineIndex == 0) {
        text += indent + "HEX "
      }
      text += image.dataBytes[i].toString(16).toUpperCase().padStart(2, "0")
      if (++lineIndex == byteWidth) {
        text += "\n"
        lineIndex = 0
      }
    }
    if (lineIndex != 0) {
      text += "\n"
    }
  }

  return text
}

export function imageFromText(clipText: string): PixelData {
  let lines = clipText.split(/\r?\n/)
  let builder = new SourceDocBuilder()
  let doc = builder.buildRawDoc(lines)

  let rawImage = new PixelData()
  let rawData: number[] = []
  rawImage.dataBytes = rawData
  doc.sourceLines.forEach((srcLine) => {
    let opcode = srcLine.opcode.toUpperCase()
    if (srcLine.comment.startsWith(";{")) {
      try {
        rawImage.bounds = JSON.parse(srcLine.comment.slice(1))
      } catch {
      }
    }
    if (opcode == "HEX") {
      let argStr = srcLine.args
      let width = 0
      for (let i = 0; i < argStr.length; i += 2) {
        let hexStr = argStr.substring(i, i + 2)
        let value = parseInt(hexStr, 16)
        rawData.push(value)
        width += 1
      }
      if (rawImage.bounds.width == 0) {
        rawImage.bounds.width = width * 7
      }
    } else if (opcode == "DFB" || opcode == "DC.B" || opcode == "DB") {
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
      if (rawImage.bounds.width == 0) {
        rawImage.bounds.width = width * 7
      }
    }
  })
  if (rawImage.bounds.width == 0) {
    rawImage.bounds.width = rawData.length * 7
  }

  // TODO: decompression hook here

  if (rawImage.bounds.height == 0) {
    let heightGuess = rawData.length / Math.floor(rawImage.bounds.width / 7)
    if (heightGuess == Math.floor(heightGuess)) {
      rawImage.bounds.height = heightGuess
    } else {
      rawImage.bounds.width = rawData.length * 7
      rawImage.bounds.height = 1
    }
  }

  return rawImage
}

//------------------------------------------------------------------------------

// Stub classes for use when full SourceDoc code not available.
// TODO: revisit this once debugger code is integrated

class SourceDocBuilder {
  buildRawDoc(lines: string[]): SourceDoc {
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

//------------------------------------------------------------------------------
