import { PixelData } from "../shared/types"

//------------------------------------------------------------------------------

export enum CompType {
  Raw  = 0,
  Skip = 1,
  Flip = 2,
  Copy1 = 3,
  Copy = 4,
  Rep1 = 5,
  Rep2 = 6,
  Move = 7,
  Count = 8
}

export type CompressEntry = {
  type: string
  count: number
  data?: number []
  srcColumn?: number    // move-only
  srcLine?: number      // move-only
}

//------------------------------------------------------------------------------

enum MatchType {
  None      = 0,
  Rep1Back  = 1,
  Rep1Cur   = 2,
  Rep1Next  = 3,
  Rep2Back  = 4,
  Rep2Split = 5,
  Rep2Next  = 6,
  Move      = 7,
  Count     = 8
}

export class Naja2Compressor {

  private readonly maxSkipCount = 63
  private readonly minMoveCount = 4
  private readonly maxMoveCount = 31
  private readonly minRep1Count = 2
  private readonly maxRep1Count = 31
  // private readonly minRep2Count = 1
  private readonly maxRep2Count = 15

  private imageData: Uint8Array = new Uint8Array()
  private leftColumn: number = 0
  private columnWidth: number = 0
  private topLine: number = 0
  private lineHeight: number = 0

  entries: CompressEntry[] = []
  private rawBytes: number[] = []
  private highBit: number = 0

  private setImageData(pixelData: PixelData) {
    let byteX = Math.floor(pixelData.bounds.x / 7)
    let byteWidth = Math.ceil((pixelData.bounds.x + pixelData.bounds.width) / 7) - byteX
    this.imageData = new Uint8Array(byteWidth * pixelData.bounds.height)

    // convert from row-order to column-order
    for (let y = 0; y < pixelData.bounds.height; y += 1) {
      for (let x = 0; x < byteWidth; x += 1) {
        this.imageData[x * pixelData.bounds.height + y] = pixelData.bytes[y * byteWidth + x]
      }
    }

    this.leftColumn = byteX
    this.columnWidth = byteWidth
    this.topLine = pixelData.bounds.y
    this.lineHeight = pixelData.bounds.height
  }

  compress(pixelData: PixelData): number[] {
    this.setImageData(pixelData)

    this.entries = []
    this.rawBytes = []
    this.highBit = 0x00

    let values = new Array(MatchType.Count)
    let counts = new Array(MatchType.Count)

    for (let curColumn = 0; curColumn < this.columnWidth; curColumn += 1) {

      this.entries.push({ type: "column", count: curColumn + this.leftColumn })

      let curColumnOffset = curColumn * this.lineHeight
      let curLine = 0
      while (curLine < this.lineHeight) {

        let rawByte = this.imageData[curColumnOffset + curLine]

        // handle skip values
        // TODO: incorporate mask to tell if values truly transparent

        if (rawByte == 0) {
          this.flushRawBytes()

          let skipCount = 1
          while (curLine + skipCount != this.lineHeight) {
            let nextByte = this.imageData[curColumnOffset + curLine + skipCount]
            if (nextByte != 0) {
              break
            }
            skipCount += 1
          }
          this.entries.push({ type: "skip", count: skipCount })
          curLine += skipCount

          continue
        }

        counts[MatchType.Rep1Back] = this.countRep1(curColumn, curLine - 1)
        values[MatchType.Rep1Back] = counts[MatchType.Rep1Back] > 1 ? 1 / counts[MatchType.Rep1Back] : 0

        counts[MatchType.Rep1Cur] = this.countRep1(curColumn, curLine)
        values[MatchType.Rep1Cur] = counts[MatchType.Rep1Cur] > 2 ? (1 + 1) / (1 + counts[MatchType.Rep1Cur]) : 0

        counts[MatchType.Rep1Next] = this.countRep1(curColumn, curLine + 1)
        values[MatchType.Rep1Next] = counts[MatchType.Rep1Next] > 3 ? (2 + 1) / (2 + counts[MatchType.Rep1Next]) : 0

        counts[MatchType.Rep2Back] = this.countRep2(curColumn, curLine - 2)
        values[MatchType.Rep2Back] = counts[MatchType.Rep2Back] > 0 ? 1 / (counts[MatchType.Rep2Back] * 2) : 0

        counts[MatchType.Rep2Split] = this.countRep2(curColumn, curLine - 1)
        values[MatchType.Rep2Split] = counts[MatchType.Rep2Split] > 1 ? (1 + 1) / (1 + counts[MatchType.Rep2Split] * 2) : 0

        counts[MatchType.Rep2Next] = this.countRep2(curColumn, curLine)
        values[MatchType.Rep2Next] = counts[MatchType.Rep2Next] > 1 ? (2 + 1) / (2 + counts[MatchType.Rep2Next] * 2) : 0

        // count how many lines could be copied from elsewhere
        //  (stop when a transparent byte or the endLine is hit)

        let dstMoveCount = 1
        while (curLine + dstMoveCount != this.lineHeight) {
          let nextByte = this.imageData[curColumnOffset + curLine + dstMoveCount]
          if (nextByte == 0) {
            break
          }
          dstMoveCount += 1
        }
        if (dstMoveCount > this.maxMoveCount) {
          dstMoveCount = this.maxMoveCount
        }

        // search for move matches

        let bestMoveColumn = -1
        let bestMoveLine = -1
        let bestMoveCount = 0
        if (dstMoveCount >= this.minMoveCount) {
          for (let srcColumn = 0; srcColumn <= curColumn; srcColumn += 1) {
            let lastLine = srcColumn < curColumn ? this.lineHeight : curLine
            let srcLine = 0
            while (true) {
              if (srcLine == lastLine) {
                break
              }
              let matchCount = 0
              while (true) {
                if (srcLine + matchCount == lastLine) {
                  break
                }
                let srcByte = this.imageData[srcColumn * this.lineHeight + srcLine + matchCount]
                // TODO: incorporate mask to tell if values truly transparent
                if (srcByte == 0) {
                  break
                }
                let dstByte = this.imageData[curColumnOffset + curLine + matchCount]
                if (srcByte != dstByte) {
                  break
                }
                matchCount += 1
                if (matchCount == dstMoveCount) {
                  break
                }
              }

              // NOTE: ties go to newest/nearest match
              if (bestMoveCount <= matchCount) {
                bestMoveColumn = srcColumn
                bestMoveLine = srcLine
                bestMoveCount = matchCount
              }

              srcLine += 1
            }
          }
        }

        counts[MatchType.Move] = bestMoveCount
        values[MatchType.Move] = counts[MatchType.Move] > 3 ? 3 / counts[MatchType.Move] : 0

        let bestMatchValue = 1
        let bestMatchType = MatchType.None
        for (let type = MatchType.Rep1Back; type <= MatchType.Move; type += 1) {
          if (values[type] > 0 && values[type] < bestMatchValue) {
            bestMatchValue = values[type]
            bestMatchType = type
          }
        }

        if (bestMatchType == MatchType.Rep1Back) {
          this.flushRawBytes()
          this.entries.push({ type: "rep1", count: counts[MatchType.Rep1Back] })
          curLine += counts[MatchType.Rep1Back]
          continue
        }

        if (bestMatchType == MatchType.Rep1Cur) {
          this.pushRawByte(rawByte)
          curLine += 1
          this.flushRawBytes()
          this.entries.push({ type: "rep1", count: counts[MatchType.Rep1Cur] })
          curLine += counts[MatchType.Rep1Cur]
          continue
        }

        if (bestMatchType == MatchType.Rep1Next) {
          this.pushRawByte(rawByte)
          curLine += 1
          this.pushRawByte(this.imageData[curColumnOffset + curLine])
          curLine += 1
          this.flushRawBytes()
          this.entries.push({ type: "rep1", count: counts[MatchType.Rep1Next] })
          curLine += counts[MatchType.Rep1Next]
          continue
        }

        if (bestMatchType == MatchType.Rep2Back) {
          this.flushRawBytes()
          this.entries.push({ type: "rep2", count: counts[MatchType.Rep2Back] })
          curLine += counts[MatchType.Rep2Back] * 2
          continue
        }

        if (bestMatchType == MatchType.Rep2Split) {
          this.pushRawByte(rawByte)
          curLine += 1
          this.flushRawBytes()
          this.entries.push({ type: "rep2", count: counts[MatchType.Rep2Split] })
          curLine += counts[MatchType.Rep2Split] * 2
          continue
        }

        if (bestMatchType == MatchType.Rep2Next) {
          this.pushRawByte(rawByte)
          curLine += 1
          this.pushRawByte(this.imageData[curColumnOffset + curLine])
          curLine += 1
          this.flushRawBytes()
          this.entries.push({ type: "rep2", count: counts[MatchType.Rep2Next] })
          curLine += counts[MatchType.Rep2Next] * 2
          continue
        }

        if (bestMatchType == MatchType.Move) {
          let moveBytes = []
          for (let i = 0; i < bestMoveCount; i += 1) {
            let srcByte = this.imageData[bestMoveColumn * this.lineHeight + bestMoveLine + i]
            moveBytes.push(srcByte)
          }

          this.flushRawBytes()
          this.entries.push({
            type: "move",
            count: bestMoveCount,
            data: moveBytes,
            srcColumn: bestMoveColumn,
            srcLine: bestMoveLine
          })
          curLine += bestMoveCount
          continue
        }

        this.pushRawByte(rawByte)
        curLine += 1
      }

      this.flushRawBytes()
    }

    this.optimizeEntries()
    return this.encode()
  }

  private optimizeEntries() {

    // pass 1
    let startIndex = 0
    let endIndex = 0
    while (true) {
      if (endIndex == this.entries.length) {
        break
      }
      startIndex = endIndex
      while (true) {
        endIndex += 1
        if (endIndex == this.entries.length) {
          break
        }
        if (this.entries[endIndex].type == "column") {
          break
        }
      }
      for (let i = startIndex; i < endIndex; i += 1) {
        // move repeats at end of move to following rep1/rep2
        if (this.entries[i].type == "move") {
          if (i + 1 < endIndex) {
            let moveEntry = this.entries[i]
            let repEntry = this.entries[i + 1]
            if (repEntry.type == "rep1" && repEntry.count) {
              let start = moveEntry.data!.length - 1
              while (start > 0) {
                if (moveEntry.data![start - 1] != moveEntry.data![start]) {
                  break
                }
                start -= 1
              }
              let count = moveEntry.data!.length - start - 1
              if (count > 0) {
                if (moveEntry.data!.length - count < this.minMoveCount) {
                  count = moveEntry.data!.length - this.minMoveCount
                  if (count <= 0) {
                    continue
                  }
                }
                moveEntry.data!.splice(start, count)
                moveEntry.count -= count
                repEntry.count += count
              }
            } else if (repEntry.type == "rep2" && repEntry.count) {
              let start = moveEntry.data!.length - 2
              while (start > 1) {
                if (moveEntry.data![start - 2] != moveEntry.data![start + 0]) {
                  break
                }
                if (moveEntry.data![start - 1] != moveEntry.data![start + 1]) {
                  break
                }
                start -= 2
              }
              let count = (moveEntry.data!.length - start - 2) / 2
              if (count > 0) {
                if (moveEntry.data!.length - count * 2 < this.minMoveCount) {
                  count = Math.floor((moveEntry.data!.length - this.minMoveCount) / 2)
                  if (count <= 0) {
                    continue
                  }
                }
                moveEntry.data!.splice(start, count * 2)
                moveEntry.count -= count * 2
                repEntry.count += count
              }
            }
          }
        }
      }
    }

    // pass 2
    startIndex = 0
    endIndex = 0
    while (true) {
      if (endIndex == this.entries.length) {
        break
      }
      startIndex = endIndex
      while (true) {
        endIndex += 1
        if (endIndex == this.entries.length) {
          break
        }
        if (this.entries[endIndex].type == "column") {
          break
        }
      }

      while (true) {
        let changed = false

        for (let i = startIndex; i < endIndex; i += 1) {

          // combine even sets of flip/raw/flip/... into "copy"
          if (this.entries[i].type == "flip") {
            let flipCount = 1
            let consumeCount = 0
            for (let j = i + 1; j < endIndex; j += 1) {
              let nextType = this.entries[j].type
              if (nextType == "flip") {
                flipCount += 1
                if ((flipCount & 1) == 0) {
                  consumeCount = j - i
                }
              } else if (nextType != "raw" || j + 1 == endIndex) {
                if (nextType == "raw") {
                  j += 1
                }
                // look for a flip that could be hoisted to make count even
                if ((flipCount & 1) != 0) {
                  for (let k = j + 1; k < this.entries.length; k += 1) {
                    let nextType = this.entries[k].type
                    if (nextType == "flip") {
                      this.entries.splice(k, 1)
                      if (k < endIndex) {
                        endIndex -= 1
                      }
                      flipCount += 1
                      consumeCount = j - i - 1
                      break
                    } else if (nextType == "raw") {
                      break
                    }
                  }
                }
                break
              }
            }
            if (consumeCount > 0) {
              this.entries[i].data = []
              for (let j = 0; j < consumeCount; j += 1) {
                if (this.entries[i + 1 + j].type == "raw") {
                  this.entries[i].data!.push(...this.entries[i + 1 + j].data!)
                }
              }
              this.entries[i].type = "copy"
              this.entries.splice(i + 1, consumeCount)
              endIndex -= consumeCount
              changed = true
              continue
            }
          }

          // combine raw/copyN
          if (this.entries[i].type == "raw") {
            if (i + 1 < endIndex) {
              if (this.entries[i + 1].type == "copy") {
                if (this.entries[i + 1].data!.length > 1) {
                  this.entries[i].type = "copy"
                  this.entries[i].data!.push(...this.entries[i + 1].data!)
                  this.entries.splice(i + 1, 1)
                  endIndex -= 1
                  changed = true
                }
              }
            }
          }

          // combine copyN/raw
          if (this.entries[i].type == "copy" && this.entries[i].data!.length > 1) {
            if (i + 1 < endIndex) {
              if (this.entries[i + 1].type == "raw") {
                this.entries[i].data!.push(...this.entries[i + 1].data!)
                this.entries.splice(i + 1, 1)
                endIndex -= 1
                changed = true
              }
            }
          }

          // combine copy/copy
          if (this.entries[i].type == "copy") {
            if (i + 1 < endIndex) {
              if (this.entries[i + 1].type == "copy") {
                this.entries[i].data!.push(...this.entries[i + 1].data!)
                this.entries.splice(i + 1, 1)
                endIndex -= 1
                changed = true
              }
            }
          }
        }

        if (!changed) {
          break
        }
      }
    }
  }

  private countRep1(column: number, line: number) {
    let rep1Count = 0
    if (line >= 0) {
      let columnOffset = column * this.lineHeight
      let repByte = this.imageData[columnOffset + line]
      line += 1
      if (repByte != 0x00) {
        while (line + rep1Count < this.lineHeight) {
          if (this.imageData[columnOffset + line + rep1Count] != repByte) {
            break
          }
          rep1Count += 1
        }
      }
    }
    return rep1Count
  }

  private countRep2(column: number, line: number) {
    let rep2Count = 0
    if (line >= 0) {
      let columnOffset = column * this.lineHeight
      let repByteA = this.imageData[columnOffset + line]
      line += 1
      if (line < this.lineHeight) {
        let repByteB = this.imageData[columnOffset + line]
        line += 1
        if (repByteA != 0x00 && repByteB != 0x00) {
          while (line + rep2Count * 2 + 2 <= this.lineHeight) {
            if (this.imageData[columnOffset + line + rep2Count * 2 + 0] != repByteA) {
              break
            }
            if (this.imageData[columnOffset + line + rep2Count * 2 + 1] != repByteB) {
              break
            }
            rep2Count += 1
          }
        }
      }
    }
    return rep2Count
  }

  private pushRawByte(value: number) {
    if ((value ^ this.highBit) & 0x80) {
      this.flushRawBytes()
      this.entries.push({ type: "flip", count: 1 })
      this.highBit ^= 0x80
    }
    this.rawBytes.push(value)
  }

  private flushRawBytes() {
    if (this.rawBytes.length > 0) {
      this.entries.push({ type: "raw", count: this.rawBytes.length, data: this.rawBytes })
      this.rawBytes = []
    }
  }

  private asHexData(data: number[]): string {
    let hexData = ""
    for (let i = 0; i < data.length; i += 1) {
      if (hexData != "") {
        hexData += " "
      }
      hexData += data[i].toString(16).padStart(2, "0").toUpperCase()
    }
    return hexData
  }

  dumpBlocks() {
    this.entries.forEach(entry => {
      if (entry.type == "move") {
        console.log(`move ${entry.data!.length} {${this.asHexData(entry.data!)}}`)
      } else if (entry.type == "flip") {
        console.log(entry.type)
      } else if (entry.type == "copy") {
        console.log(`copy ${entry.data!.length} [${this.asHexData(entry.data!)}]`)
      } else if (entry.type == "column") {
        console.log("")
        console.log(entry.type + " " + entry.count)
      } else if (entry.type == "raw") {
        console.log(`raw  ${entry.data!.length} [${this.asHexData(entry.data!)}]`)
      } else {
        console.log(entry.type + " " + entry.count)
      }
    })
  }

  private encode(): number[] {

    let outData: number[] = []
    outData.push(this.leftColumn)
    outData.push(this.topLine)
    outData.push(this.columnWidth)
    outData.push(this.lineHeight)

    this.entries.forEach(entry => {
      if (entry.type == "raw") {
        entry.data!.forEach(value => {
          outData.push(value & 0x7F)
        })
      } else if (entry.type == "flip") {
        outData.push(0x80)
      } else if (entry.type == "copy") {
        if (entry.data!.length == 1) {
          outData.push(0x81)
        } else {
          outData.push(0x83)
          outData.push(entry.data!.length)
        }
        outData.push(...entry.data!)
      } else if (entry.type == "skip") {
        let count = entry.count
        while (count > 0) {
          let repCount = count
          if (repCount > this.maxSkipCount) {
            repCount = this.maxSkipCount
          }
          outData.push(0x80 | (repCount << 1) | 0x00)
          count -= repCount
        }
      } else if (entry.type == "rep1") {
        let count = entry.count
        while (count > 0) {
          let repCount = count
          if (repCount > this.maxRep1Count) {
            repCount = this.maxRep1Count
          }
          let nextCount = count - repCount
          if (nextCount > 0 && nextCount < this.minRep1Count) {
            repCount = count - this.minRep1Count
            nextCount = this.minRep1Count
          }
          outData.push(0x80 | (repCount << 2) | 0x01)
          count = nextCount
        }
      } else if (entry.type == "rep2") {
        let count = entry.count
        while (count > 0) {
          let repCount = count
          if (repCount > this.maxRep2Count) {
            repCount = this.maxRep2Count
          }
          outData.push(0x80 | (repCount << 3) | 0x03)
          count -= repCount
        }
      } else if (entry.type == "move") {
        // NOTE: move count will have already been limited
        outData.push(0x80 | (((entry.data!.length >> 1) & 0xF) << 3) | 0x07)
        outData.push((entry.srcColumn! << 1) | (entry.data!.length & 1))
        outData.push(entry.srcLine!)
      }
    })

    return outData
  }
}

//------------------------------------------------------------------------------

export function packNaja2(image: PixelData): number[] {
  let compressor = new Naja2Compressor()
  let data = compressor.compress(image)
  return data
}

//------------------------------------------------------------------------------

export function packNaja1(image: PixelData): number [] {
  let outData = []
  let left = Math.floor(image.bounds.x / 7)
  let right = Math.floor((image.bounds.x + image.bounds.width + 6) / 7)
  let top = image.bounds.y
  let bottom = image.bounds.y + image.bounds.height
  let byteWidth = right - left

  outData.push(top)
  outData.push(bottom - 1)
  outData.push(left)
  outData.push(right - 1)

  let repeat = 0
  let value = 0
  for (let x = right - left; --x >= 0; ) {
    for (let y = bottom - top; --y >= 0; ) {
      let v = image.bytes[y * byteWidth + x]
      if (repeat == 0) {
        value = v
        repeat = 1
      } else if (v == value) {
        repeat += 1
      } else if (repeat > 2 || value == 0xfe) {
        outData.push(0xfe)
        outData.push(repeat)
        outData.push(value)
        value = v
        repeat = 1
      } else {
        while (repeat > 0) {
          outData.push(value)
          repeat -= 1
        }
        value = v
        repeat = 1
      }
    }
  }
  if (repeat > 0) {
    if (repeat > 2 || value == 0xfe) {
      outData.push(0xfe)
      outData.push(repeat)
      outData.push(value)
    } else {
      while (repeat > 0) {
        outData.push(value)
        repeat -= 1
      }
    }
  }
  return outData
}

//------------------------------------------------------------------------------
