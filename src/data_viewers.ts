
import { Isa6502 } from "./isa6502"
import { ScreenDisplay, formatMap } from "./display/display"
import { HiresInterleave } from "./display/tables"

// TODO: open viewer with a common interface from a name string? Get rid of exports?

//------------------------------------------------------------------------------

export class ViewApplesoft {

  static readonly tokens: string[] = [
    "END",   "FOR",    "NEXT",    "DATA",   "INPUT",   "DEL",    "DIM",     "READ",
    "GR",    "TEXT",   "PR#",     "IN#",    "CALL",    "PLOT",   "HLIN",    "VLIN",
    "HGR2",  "HGR",    "HCOLOR=", "HPLOT",  "DRAW",    "XDRAW",  "HTAB",    "HOME",
    "ROT=",  "SCALE=", "SHLOAD",  "TRACE",  "NOTRACE", "NORMAL", "INVERSE", "FLASH",
    "COLOR=","POP",    "VTAB",    "HIMEM:", "LOMEM:",  "ONERR",  "RESUME",  "RECALL",
    "STORE", "SPEED=", "LET",     "GOTO",   "RUN",     "IF",     "RESTORE", "&",
    "GOSUB", "RETURN", "REM",     "STOP",   "ON",      "WAIT",   "LOAD",    "SAVE",
    "DEF",   "POKE",   "PRINT",   "CONT",   "LIST",    "CLEAR",  "GET",     "NEW",
    "TAB(",  "TO",     "FN",      "SPC(",   "THEN",    "AT",     "NOT",     "STEP",
    "+",     "-",      "*",       "/",      "^",       "AND",    "OR",      ">",
    "=",     "<",      "SGN",     "INT",    "ABS",     "USR",    "FRE",     "SCRN(",
    "PDL",   "POS",    "SQR",     "RND",    "LOG",     "EXP",    "COS",     "SIN",
    "TAN",   "ATN",    "PEEK",    "LEN",    "STR$",    "VAL",    "ASC",     "CHR$",
    "LEFT$", "RIGHT$", "MID$",    "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR",
    "ERROR", "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR",
    "ERROR", "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR"
  ]

  static asText(data: Uint8Array, asHtml: boolean): string {
    let offset = 0
    let out = ""

    while (offset < data.length) {
      let nextAddress = data[offset + 0] + (data[offset + 1] << 8)
      offset += 2
      // NOTE: this allows basic code to hide code/data at the end of the file
      if (nextAddress == 0) {
        let extra = data.length - offset
        if (extra > 1) {
          out += asHtml ? "<br>" : "\n"
          out += ViewBinaryDisasm.asText(data, 0x801, offset, asHtml)
        }
        break
      }

      let lineNumber = data[offset + 0] + (data[offset + 1] << 8)
      offset += 2
      if (offset >= data.length) {
        break
      }

      const lineNumStr = lineNumber.toString() + " "
      if (asHtml) {
        out += `<span class="as-linenum">${lineNumStr}</span>`
      } else {
        out += lineNumStr
      }

      let inString = false
      let inComment = false
      while (true) {
        let byte = data[offset]
        offset += 1
        if (byte == 0) {
          break
        }
        if (byte & 0x80) {
          let s = this.tokens[byte & 0x7f]
          if (asHtml) {
            if (s == "&") {
              s = "&amp;"
            } else if (s == "<") {
              s = "&lt;"
            } else if (s == ">") {
              s = "&gt;"
            }
          }
          if (s == "REM") {
            if (asHtml) {
              out += '<span class="as-comment">'
            }
            out += " REM "
            inComment = true
          } else if (s.length > 1 && asHtml) {
            out += `<span class="as-token"> ${s} </span>`
          } else {
            out += ` ${s} `
          }
        } else {
          let s = String.fromCharCode(byte)
          if (s == ":") {
            if (asHtml) {
              s = `<span class="as-colon">:</span>`
            } else {
              s = ":"
            }
          } else if (s == '"') {
            if (inString) {
              if (asHtml) {
                s = '"</span>'
              }
              inString = false
            } else {
              inString = true
              if (asHtml) {
                s = '<span class="as-string">"'
              }
            }
          } else if (asHtml) {
            if (s == "&") {
              s = "&amp;"
            } else if (s == "<") {
              s = "&lt;"
            } else if (s == ">") {
              s = "&gt;"
            }
          }
          out += s
        }
      }
      if (inComment && asHtml) {
        out += "</span>"
      }
      out += asHtml ? "<br>" : "\n"
    }

    return out
  }
}

//------------------------------------------------------------------------------

export class ViewMerlin {
  static asText(data: Uint8Array, asHtml: boolean): string {
    const tabStops = [9, 15, 26]
    let offset = 0
    let out = ""
    let line = ""
    let columnIndex = 0
    while (offset < data.length) {
      const byte = data[offset++]
      if (byte == 0x8d) {
        line += asHtml ? "<br>" : "\n"
        out += line
        line = ""
        columnIndex = 0
        continue
      }
      if (byte == 0xa0) {
        columnIndex += 1
        // if ';', force to last column
        if (data[offset] == 0xbb) {
          columnIndex = 3
        }
        if (columnIndex < 4) {
          line = line.padEnd(tabStops[columnIndex - 1], " ")
        } else {
          line += " "
        }
        continue
      }
      let c = String.fromCharCode(byte & 0x7f)
      if (asHtml) {
        if (c == "&") {
          c = "&amp;"
        } else if (c == "<") {
          c = "&lt;"
        } else if (c == ">") {
          c = "&gt;"
        }
      }
      line += c
    }
    if (line != "") {
      out += line
    }
    return out
  }
}

//------------------------------------------------------------------------------

export class ViewLisa2 {

  public static asText(data: Uint8Array, asHtml: boolean): string {
    const lisa2 = new ViewLisa2(data, asHtml)
    return lisa2.convertText()
  }

  // from LISA P1.L
  static readonly tokens: string[] = [
    "BGE", "BLT", "BMI", "BCC", "BCS", "BPL", "BNE", "BEQ",   // 0x80
    "BVS", "BVC", "BSB", "BNM", "BM1", "BNZ", "BIZ", "BIM",
    "BIP", "BIC", "BNC", "BRA", "BTR", "BFL", "BRK", "BKS",   // 0x90
    "CLV", "CLC", "CLD", "CLI", "DEX", "DEY", "INX", "INY",
    "NOP", "PHA", "PLA", "PHP", "PLP", "RTS", "RTI", "RSB",   // 0xA0
    "RTN", "SEC", "SEI", "SED", "TAX", "TAY", "TSX", "TXA",
    "TXS", "TYA", "ADD", "CPR", "DCR", "INR", "SUB", "LDD",   // 0xB0
    "POP", "PPD", "STD", "STP", "LDR", "STO", "SET", "???",
    "ADC", "AND", "ORA", "BIT", "CMP", "CPX", "CPY", "DEC",   // 0xC0
    "EOR", "INC", "JMP", "JSR", "???", "LDA", "LDX", "LDY",
    "STA", "STX", "STY", "XOR", "LSR", "ROR", "ROL", "ASL",   // 0xD0
    "ADR", "EQU", "ORG", "OBJ", "EPZ", "STR", "DCM", "ASC",
    "ICL", "END", "LST", "NLS", "HEX", "BYT", "HBY", "PAU",   // 0xE0
    "DFS", "DCI", "FLT", "PAG", "INV", "BLK", "DBY", "TTL",
    "SBC", "???", "LET", ".IF", ".EL", ".FI", "=  ", "PHS",   // 0xF0
    "DPH", ".DA", "GEN", "NOG", "USR", "ENZ", "???", "???",
  ]

  private data: Uint8Array
  private asHtml: boolean
  private line: string = ""
  private offset: number = 0
  private endOffset: number = 0

  private constructor(data: Uint8Array, asHtml: boolean) {
    this.data = data
    this.asHtml = asHtml
  }

  private convertText(): string {
    // const tabStops = [9, 13, 29]
    let out = ""
    this.offset = 0

    // TODO: use these to check if file really is LISA

    // let version = data[offset] + (data[offset + 1] << 8)
    // offset += 2

    // let length = data[offset] + (data[offset + 1] << 8)
    // offset += 2

    while (this.offset < this.data.length) {
      const lineLength = this.data[this.offset]
      this.offset += 1

      if (lineLength == 0 || lineLength == 0xff) {
        break
      }

      if (this.offset + lineLength > this.data.length) {
        // TODO: report overflow error
        break
      }

      this.endOffset = this.offset + lineLength
      this.convertLine()
      this.offset = this.endOffset

      out += this.line.trimEnd()
      out += this.asHtml ? "<br>" : "\n"
    }
    return out
  }

  private convertLine() {

    this.line = ""

    let c = " "
    let byte = this.data[this.offset]

    if (byte < 0x80) {

      this.addByte(byte)
      c = String.fromCharCode(byte)

      // comment line
      if (c == "*" || c == ";") {
        this.flushLine()
        return
      }

      // label
      if (c != " ") {
        while (this.offset < this.endOffset) {
          byte = this.data[this.offset]
          if (byte == 0x0d || byte >= 0x80) {
            break
          }
          this.addByte(byte)
        }
      }
    }

    if (this.line.length < 9) {
      this.line = this.line.padEnd(9, " ")
    } else {
      this.line += " "
    }

    // next byte is token
    byte = this.data[this.offset]
    if (byte >= 0x80) {
      this.offset += 1
      this.line += ViewLisa2.tokens[byte & 0x7f]
      this.line += " "
      // addressing mode
      byte = this.data[this.offset]
      if (byte <= 0x20) {
        this.offset += 1
        while (this.offset < this.endOffset) {
          byte = this.data[this.offset]
          if (byte == 0x0d || byte >= 0x80) {
            break
          }
          this.addByte(byte)
        }
      }
    } else {
      // TODO: report missing token
    }

    byte = this.data[this.offset]
    if (byte == 0x0d) {
      return
    }
    if (byte == 0xBB) {   // ';' | 0X80
      if (this.line.length < 29) {
        this.line = this.line.padEnd(29, " ")
      } else {
        this.line += " "
      }
      this.line += ";"
      this.offset += 1
    }

    this.flushLine()
  }

  private flushLine() {
    while (this.offset < this.endOffset) {
      const byte = this.data[this.offset]
      if (byte == 0x0d || byte >= 0x80) {
        break
      }
      this.addByte(byte)
    }
  }

  private addByte(byte: number) {
    let c = String.fromCharCode(byte)
    if (this.asHtml) {
      if (c == "&") {
        c = "&amp;"
      } else if (c == "<") {
        c = "&lt;"
      } else if (c == ">") {
        c = "&gt;"
      }
    }
    this.line += c
    this.offset += 1
  }
}

//------------------------------------------------------------------------------

export class ViewInteger {

  static readonly tokens: string[] = [
    "HIMEM:", "EOL",    "_",       ":",      "LOAD",  "SAVE",  "CON",    "RUN",
    "RUN",    "DEL",    ", ",      "NEW",    "CLR",   "AUTO",  ",",      "MAN",
    "HIMEM:", "LOMEM:", "+",       "-",      "*",     "/",     "=",      "#",
    ">=",     ">",      "<=",      "<>",     "<",     "AND",   "OR",     "MOD",
    "^",      "+",      "(",       ",",      "THEN",  "THEN",  ",",      ",",
    "\"",     "\"",     "(",       "!",      "!",     "(",     "PEEK",   "RND",
    "SGN",    "ABS",    "PDL",     "RNDX",   "(",     "+",     "-",      "NOT",
    "(",      "=",      "#",       "LEN(",   "ASC(",  "SCRN(", ",",      "(",
    "$",      "$",      "(",       ",",      ",",     ";",     ";",      ";",
    ",",      ",",      ",",       "TEXT",   "GR",    "CALL",  "DIM",    "DIM",
    "TAB",    "END",    "INPUT",   "INPUT",  "INPUT", "FOR",   "=",      "TO",
    "STEP",   "NEXT",   ",",       "RETURN", "GOSUB", "REM",   "LET",    "GOTO",
    "IF",     "PRINT",  "PRINT",   "PRINT",  "POKE",  ",",     "COLOR=", "PLOT",
    ",",      "HLIN",   ",",       "AT",     "VLIN",  ",",     "AT",     "VTAB",
    "=",      "=",      ")",       ")",      "LIST",  ",",     "LIST",   "POP",
    "NODSP",  "NODSP",  "NOTRACE", "DSP",    "DSP",   "TRACE", "PR#",    "IN#"
  ]

  static asText(data: Uint8Array, asHtml: boolean): string {
    let offset = 0
    let out = ""

    while (offset < data.length) {

      let lineLength = data[offset]
      offset += 1

      let lineNumber = data[offset + 0] + (data[offset + 1] << 8)
      offset += 2

      const lineNumStr = lineNumber.toString().padStart(5, " ")
      if (asHtml) {
        out += `<span class="as-linenum">${lineNumStr}</span>`
      } else {
        out += lineNumStr
      }

      let wasToken = true
      while (true) {
        let byte = data[offset]
        if (byte == 0x01) {
          offset += 1
          out += asHtml ? "<br>" : "\n"
          break
        }

        let isToken = (byte < 0x80) && (this.tokens[byte].length > 1)
        if (wasToken && !isToken) {
          out += " "
        }
        wasToken = isToken

        if (byte == 0x28) {  // opening quote token
          if (asHtml) {
            out += '<span class="as-string">"'
          }
          offset += 1
          while (offset < data.length) {
            byte = data[offset]
            offset += 1
            if (byte == 0x29) {  // closing quote token
              break
            }
            // TODO: filter out control characters?
            out += String.fromCharCode(byte & 0x7f)
          }
          if (asHtml) {
            out += '"</span>'
          }
        } else if (byte == 0x5d) {  // REM token
          offset += 1
          if (asHtml) {
            out += '<span class="as-comment">'
          }
          out += ' REM '
          while (offset < data.length) {
            byte = data[offset]
            if (byte == 0x01) {  // end of line token
              break
            }
            offset += 1
            let c = String.fromCharCode(byte & 0x7f)
            if (asHtml) {
              if (c == "&") {
                c = "&amp;"
              } else if (c == "<") {
                c = "&lt;"
              } else if (c == ">") {
                c = "&gt;"
              }
            }
            out += c
          }
          if (asHtml) {
            out += '</span>'
          }
        } else if (byte >= 0xb0 && byte <= 0xb9) {
          offset += 1
          let value = data[offset + 0] + (data[offset + 1] << 8)
          offset += 2
          out += value.toString()
        } else if (byte >= 0xc1 && byte <= 0xda) {
          offset += 1
          out += String.fromCharCode(byte & 0x7f)
          while (offset < data.length) {
            byte = data[offset]
            if ((byte >= 0xc1 && byte <= 0xda) || (byte >= 0xb0 && byte <= 0xb9)) {
              offset += 1
              out += String.fromCharCode(byte & 0x7f)
            } else {
              break
            }
          }
        } else if (byte < 0x80) {
          offset += 1
          if (byte == 0x03) {
            if (asHtml) {
              out += '<span class="as-colon">:</span>'
            } else {
              out += ':'
            }
          } else {
            let token = this.tokens[byte]
            if (token.length > 1) {
              out += " "
            }
            if (asHtml) {
              if (token == ">= ") {
                token = "&gt;= "
              } else if (token == ">") {
                token = "&gt;"
              } else if (token == "<= ") {
                token = "&lt;= "
              } else if (token == "<> ") {
                token = "&lt;&gt; "
              } else if (token == "<") {
                token = "&lt;"
              }
              out += `<span class="as-token">${token}</span>`
            } else {
              out += token
            }
          }
        } else {
          console.log("Unkown token 0x" + byte.toString(16))
          offset += 1
          out += String.fromCharCode(byte & 0x7f)
        }
      }
    }

    return out
  }
}

//------------------------------------------------------------------------------

export class ViewText {
  static asText(data: Uint8Array, padSource: boolean, asHtml: boolean): string {
    const tabStops = [16, 20, 40]
    let out = ""
    let line = ""

    for (let i = 0; i < data.length; i += 1) {
      if ((data[i] & 0x7f) == 0x0d) {
        if (padSource) {
          let paddedLine = ""
          if (line != "") {
            if (line[0] == "*") {
              paddedLine = line
            } else {
              let columnIndex = 0
              while (line != "") {
                if (line[0] == ";") {
                  paddedLine = paddedLine.padEnd(tabStops[2], " ")
                  paddedLine += line
                  break
                }
                let pos = line.indexOf(" ")
                if (pos == -1) {
                  paddedLine += line
                  break
                }
                if (pos > 0) {
                  paddedLine += line.substring(0, pos)
                }
                line = line.substring(pos + 1)
                if (paddedLine.length < tabStops[columnIndex] - 1) {
                  paddedLine = paddedLine.padEnd(tabStops[columnIndex] - 1, " ")
                }
                paddedLine += " "
                columnIndex += 1
                if (columnIndex == tabStops.length) {
                  paddedLine += line
                  break
                }
              }
            }
            line = paddedLine
          }
        }
        out += line
        line = ""
        out += asHtml ? "<br>" : "\n"
      } else {
        let char = String.fromCharCode(data[i] & 0x7f)
        if (asHtml) {
          if (char == "&") {
            char = "&amp;"
          } else if (char == "<") {
            char = "&lt;"
          } else if (char == ">") {
            char = "&gt;"
          }
        }
        line += char
      }
    }
    if (line != "") {
      out += line
      out += asHtml ? "<br>" : "\n"
    }
    return out
  }
}

//------------------------------------------------------------------------------

export class ViewBinaryHex {
  static asText(data: Uint8Array, address: number, asHtml: boolean): string {
    let out = ""
    let line = ""

    let offset = 0
    let startOffset = 0
    while (offset < data.length) {
      if (line == "") {
        const addrStr = (address + offset).toString(16).toUpperCase().padStart(4, "0")
        if (asHtml) {
          line = `<span class="bin-addr">${addrStr}:</span>`
        } else {
          line = addrStr
        }
      }
      line += " " + data[offset].toString(16).toUpperCase().padStart(2, "0")
      offset += 1
      if ((offset & 0xf) == 0) {
        if (line != "") {
          //*** pad partial line ***
          let asciiStr = ""
          for (let i = startOffset; i < offset; i += 1) {
            let byte = data[i]

            // *** this logic is wrong ***
            if (byte >= 0x00 && byte <= 0x1f) {
              byte ^= 0x40
            } else if (byte >= 0xc0 && byte <= 0xdf) {
              byte ^= 0xa0
            } else if (byte >= 0xe0 && byte <= 0xff) {
              byte ^= 0xc0
            }
            byte &= 0x7f
            // *** this logic is wrong ***

            if (byte >= 0x20) {
              let char = String.fromCharCode(byte)
              if (asHtml) {
                if (char == "&") {
                  char = "&amp;"
                } else if (char == "<") {
                  char = "&lt;"
                } else if (char == ">") {
                  char = "&gt;"
                }
              }
              asciiStr += char
            } else {
              asciiStr += "."
            }
          }
          startOffset = offset
          out += `${line}    ${asciiStr}`
          out += asHtml ? "<br>" : "\n"
          line = ""
        }
      }
    }
    if (line != "") {
      out += line
      out += asHtml ? "<br>" : "\n"
    }
    return out
  }
}


export class ViewBinaryDisasm {
  static asText(data: Uint8Array, address: number, startOffset: number, asHtml: boolean): string {
    let out = ""
    let offset = startOffset

    while (offset < data.length) {
      const addrStr = (address + offset).toString(16).toUpperCase().padStart(4, "0") + ":"
      if (asHtml) {
        out += `<span class="bin-addr">${addrStr}</span>`
      } else {
        out += addrStr
      }
      const opByte = data[offset]
      let opLength = Isa6502.ops[opByte].bc
      let opcode: string
      let opArgs: string

      if (offset + opLength <= data.length) {
        opcode = Isa6502.ops[opByte].op.toUpperCase()
        opArgs = Isa6502.DisassembleArgs(data, offset, address + offset).toUpperCase()
      } else {
        opLength = 1
        opcode = "???"
        opArgs = ""
      }

      out += " "
      for (let i = 0; i < 3; i += 1) {
        if (i < opLength) {
          let value = data[offset + i]
          out += " "
          out += value.toString(16).padStart(2, "0").toUpperCase()
        } else {
          out += "   "
        }
      }

      out += `    ${opcode}   ${opArgs}`
      out += asHtml ? "<br>" : "\n"
      offset += opLength
    }
    return out
  }
}


export class ViewBinaryGraphics {
  static asCanvas(data: Uint8Array, typeName: string): HTMLCanvasElement {
    const canvas = <HTMLCanvasElement>document.createElement("canvas")
    const display = new ScreenDisplay(typeName, canvas)
    const displayFormat = formatMap.get(typeName)
    if (displayFormat) {
      const displayData = displayFormat.deinterleaveFrame(data)
      display.setFrameMemory(displayData)
    }
    return canvas
  }
}


export class ViewBinaryNajaPackedHires {

  static asCanvas(packedData: Uint8Array): HTMLCanvasElement | undefined {
    let hiresData = ViewBinaryNajaPackedHires.asHiresData(packedData)
    if (hiresData) {
      return ViewBinaryGraphics.asCanvas(hiresData, "hires")
    }
  }

  static asHiresData(packedData: Uint8Array): Uint8Array | undefined {
    if (packedData.length < 4) {
      return
    }
    let top = packedData[0]
    let bottom = packedData[1]
    let left = packedData[2]
    let right = packedData[3]
    if (top > bottom || left > right) {
      return
    }

    let hiresData = new Uint8Array(0x2000)
    hiresData.fill(0)

    let x = right
    let count = 0
    let value = 0
    let offset = 4
    while (x >= left) {
      let y = bottom
      while (y >= top) {
        if (count == 0) {
          if (offset == packedData.length) {
            return
          }
          value = packedData[offset]
          offset += 1
          if (value == 0xFE) {
            if (offset + 2 > packedData.length) {
              return
            }
            count = packedData[offset + 0]
            value = packedData[offset + 1]
            offset += 2
          } else {
            count = 1
          }
        }
        hiresData[HiresInterleave[y] + x] = value
        count -= 1
        y -= 1
      }
      x -= 1
    }

    return hiresData
  }
}

//------------------------------------------------------------------------------
