
import { Point, Size, Rect, PixelData } from "../shared/types"

//------------------------------------------------------------------------------

// this.aspectScale = { x:  2, y:  2 }  // HIRES
// this.aspectScale = { x:  4, y:  2 }  // DHIRES
// this.aspectScale = { x: 14, y: 16 }  // TEXT40
// this.aspectScale = { x: 14, y:  8 }  // LORES
// this.aspectScale = { x:  7, y: 16 }  // TEXT80
// this.aspectScale = { x:  7, y:  8 }  // DLORES
// this.aspectScale = { x:  2, y:  2 }  // IIgs HIRES (320x200)
// this.aspectScale = { x:  1, y:  2 }  // IIgs XHIRES (640x200)
// this.aspectScale = { x:  4, y:  2 }  // Atari 2600 (fore: 160x192, back: 40x192)
// this.aspectScale = { x:  4, y:  2 }  // Atari 7800 lores (160x240)
// this.aspectScale = { x:  2, y:  2 }  // Atari 7800 hires (320x240)

// this.displaySize = { width: 560, height: 384 } // Apple II
// this.displaySize = { width: 640, height: 400 } // Apple IIgs
// this.displaySize = { width: 640, height: 384 } // Atari 2600
// this.displaySize = { width: 640, height: 480 } // Atari 7800

export abstract class DisplayFormat {

  public abstract get name(): string
  public abstract get frameSize(): Size
  public abstract get displaySize(): Size
  public abstract get pixelScale(): Point
  public abstract get alignment(): Point

  public abstract calcPixelWidth(byteWidth: number): number
  public abstract calcByteWidth(pixelX: number, pixelWidth: number): number
  public abstract calcAddress(pixelX: number, pixelY: number, pageIndex: number): number
  public abstract calcByteColumn(pixelX: number): number

  public abstract createFramePixelData(): PixelData

  public createFrameBitmap(): Bitmap {
    return this.createBitmap({x: 0, y: 0, ...this.frameSize})
  }

  public abstract createBitmap(src: Bitmap | Rect): Bitmap

  public createColorBuffers(): { main: Uint32Array, alt: Uint32Array } {
    const size = this.displaySize.width * this.displaySize.height / 2
    const mainBuffer = new Uint32Array(size)
    return { main: mainBuffer, alt: mainBuffer }
  }

  public abstract get colorCount(): number
  public abstract getColorValueRgb(index: number): number
  public abstract getColorPattern(index: number): number[][]

  public abstract get altModes(): number
  public abstract colorize(srcBitmap: Bitmap, yTop: number, yBot: number, altMode: number, colorMain: Uint32Array, colorAlt: Uint32Array): void

  public lineDouble(colorBuffer: Uint32Array, colorTop: number, colorBot: number, displayBuffer: Uint32Array, showInterlaceLines: boolean) {
    const displayWidth = this.displaySize.width
    let colorOffset = colorTop * displayWidth
    let displayOffset = colorOffset * 2
    for (let y = colorTop; y < colorBot; y += 1) {
      if (showInterlaceLines) {
        // TODO: maybe do a vertically blended interlace pattern
        for (let x = 0; x < displayWidth; x += 1) {
          displayBuffer[displayOffset + x] = colorBuffer[colorOffset + x]
          displayBuffer[displayOffset + displayWidth + x] = 0xff000000
        }
      } else {
        for (let x = 0; x < displayWidth; x += 1) {
          const value = colorBuffer[colorOffset + x]
          displayBuffer[displayOffset + x] = value
          displayBuffer[displayOffset + displayWidth + x] = value
        }
      }
      colorOffset += displayWidth
      displayOffset += displayWidth * 2
    }
  }

  // TODO: add interleaveFrame?
  public abstract deinterleaveFrame(data: Uint8Array): PixelData
  // TODO: default pass-thru code

  public decode(pixelData: PixelData): Bitmap {
    const bitmap = this.createBitmap(pixelData.bounds)
    bitmap.decode(pixelData)
    return bitmap
  }
}

//------------------------------------------------------------------------------

export abstract class Bitmap {
  public format: DisplayFormat
  public width: number
  public height: number
  public x: number
  public y: number
  public data: Uint8Array

  protected lastRect: Rect = { x: 0, y: 0, width: 0, height: 0 }
  protected lastClip: Rect = { x: 0, y: 0, width: 0, height: 0 }

  protected constructor(src: Bitmap | Rect, format?: DisplayFormat) {
    if (src instanceof Bitmap) {
      this.format = src.format
      this.width = src.width
      this.height = src.height
      this.x = src.x
      this.y = src.y
      this.data = src.data.slice()
    } else {
      this.format = format!
      this.width = src.width
      this.height = src.height
      this.x = src.x
      this.y = src.y
      this.data = new Uint8Array(this.width * this.height).fill(0)
    }
  }

  public abstract encode(): PixelData
  public abstract decode(data: PixelData): void

  public get stride(): number {
    return this.width
  }

  public get size(): Size {
    return { width: this.width, height: this.height}
  }

  public get bounds(): Rect {
    return { x: this.x, y: this.y, width: this.width, height: this.height }
  }

  public get left(): number {
    return this.x
  }

  public get top(): number {
    return this.y
  }

  public get right(): number {
    return this.x + this.width
  }

  public get bottom(): number {
    return this.y + this.height
  }

  public copyFrom(srcBitmap: Bitmap) {
    this.data = srcBitmap.data.slice()
  }

  public alignDirtyRect(dirtyRect: Rect) {
  }

  public getPixelAt(pt: Point): number | undefined {
    if (pt.x < this.left || pt.x >= this.right ||
        pt.y < this.top || pt.y >= this.bottom) {
      return
    }
    return this.data[(pt.y - this.y) * this.stride + pt.x - this.x]
  }

  public getColorAt(pt: Point) : number | undefined {
    const patWidth = this.format.getColorPattern(0)[0].length
    const pattern = new Array(patWidth)
    const sx = pt.x - (pt.x % pattern.length)
    for (let i = 0; i < patWidth; i += 1) {
      pattern[i] = this.getPixelAt({x: sx + i, y: pt.y})!
    }
    let fillColor: number | undefined
    for (let i = 0; i < this.format.colorCount; i += 1) {
      const colorPat = this.format.getColorPattern(i)
      let matched = true
      for (let j = 0; j < pattern.length; j += 1) {
        if (pattern[j] != colorPat[0][j]) {
          matched = false
          break
        }
      }
      if (matched) {
        fillColor = i
        break
      }
    }
    return fillColor
  }

  public fillRect(rect: Rect, foreColor: number, mask?: Bitmap, parity: boolean = true) {
    const r = this.clipRect(rect)
    if (r.width != 0 && r.height != 0) {
      const pattern = this.format.getColorPattern(foreColor)
      const patHeight = pattern.length
      const patWidth = pattern[0].length
      let patX = (r.x + this.x) % patWidth
      let patY = (r.y + this.y) % patHeight
      let offset = r.y * this.stride + r.x
      let maskOffset = (r.y - rect.y) * (mask?.stride ?? 0) + (r.x - rect.x)
      for (let y = 0; y < r.height; y += 1) {
        let px = patX
        if (mask) {
          for (let x = 0; x < r.width; x += 1) {
            if ((mask.data[maskOffset + x] != 0) == parity) {
              this.data[offset + x] = pattern[patY][px]
            }
            if (++px == patWidth) {
              px = 0
            }
          }
        } else {
          for (let x = 0; x < r.width; x += 1) {
            this.data[offset + x] = pattern[patY][px]
            if (++px == patWidth) {
              px = 0
            }
          }
        }
        offset += this.stride
        maskOffset += mask?.stride ?? 0
        if (++patY == patHeight) {
          patY = 0
        }
      }
    }
  }

  public eraseRect(rect: Rect, backColor: number, mask?: Bitmap, parity: boolean = true) {
    this.fillRect(rect, backColor, mask, parity)
  }

  public drawBitmap(srcBitmap: Bitmap, pt: Point, mask?: Bitmap) {
    const rect = { x: pt.x, y: pt.y, width: srcBitmap.width, height: srcBitmap.height }
    const r = this.clipRect(rect)
    if (r.width != 0 && r.height != 0) {
      let srcOffset = Math.max(-pt.y, 0) * srcBitmap.stride + Math.max(-pt.x, 0)
      let dstOffset = r.y * this.stride + r.x
      for (let y = 0; y < r.height; y += 1) {
        for (let x = 0; x < r.width; x += 1) {
          if (!mask || mask.data[srcOffset + x] != 0) {
            this.data[dstOffset + x] = srcBitmap.data[srcOffset + x]
          }
        }
        srcOffset += srcBitmap.stride
        dstOffset += this.stride
      }
    }
  }

  public bitsToMask(bits: number[], startMask: number, endMask: number, pt: Point, scale: Point) {
    let dstY = pt.y
    let dstOffset = pt.y * this.stride
    for (let bitLine = 0; bitLine < bits.length; bitLine += 1) {
      for (let yRep = 0; yRep < scale.y; yRep += 1) {
        if (dstY >= this.height) {
          return
        }
        if (dstY >= 0) {
          let x = pt.x
          let mask = startMask
          const b = bits[bitLine]
          while (true) {
            for (let xRep = 0; xRep < scale.x; xRep += 1) {
              if (x >= 0) {
                if (b & mask) {
                  this.data[dstOffset + x] = 0x7F
                }
              }
              x += 1
              if (x >= this.x + this.width) {
                mask = endMask
                break
              }
            }
            if (mask == endMask) {
              break
            }
            if (startMask > endMask) {
              mask >>= 1
            } else {
              mask <<= 1
            }
          }
        }
        dstY += 1
        dstOffset += this.stride
      }
    }
  }

  public createMask(backColor: number): Bitmap {
    const mask = this.format.createBitmap({ x: 0, y: 0, ...this.size })
    mask.data.fill(0x7F)

    const pattern = this.format.getColorPattern(backColor)
    const patHeight = pattern.length
    const patWidth = pattern[0].length
    let patX = (0 + this.x) % patWidth
    let patY = (0 + this.y) % patHeight
    let offset = 0

    for (let y = 0; y < this.height; y += 1) {
      let px = patX
      let pc = 0

      for (let x = 0; x < this.width; x += 1) {
        if (this.data[offset + x] == pattern[patY][px]) {
          pc += 1
        } else {
          if (pc >= patWidth || x - pc == 0) {
            for (let i = x - pc; i < x; i += 1) {
              mask.data[offset + i] = 0x00
            }
          }
          pc = 0
        }
        px += 1
        if (px == patWidth) {
          px = 0
        }
      }
      if (pc > 0) {
        for (let i = this.width - pc; i < this.width; i += 1) {
          mask.data[offset + i] = 0x00
        }
      }
      offset += this.stride
      patY += 1
      if (patY == patHeight) {
        patY = 0
      }
    }
    return mask
  }

  public padMask(): Bitmap {
    const outRect: Rect = {
      x: 0, y: 0, width: this.size.width + 2, height: this.size.height + 2
    }
    const outMask = this.format.createBitmap(outRect)
    outMask.drawBitmap(this, {x: 0, y: 0}, this)
    outMask.drawBitmap(this, {x: 1, y: 0}, this)
    outMask.drawBitmap(this, {x: 2, y: 0}, this)
    outMask.drawBitmap(this, {x: 0, y: 1}, this)
    outMask.drawBitmap(this, {x: 1, y: 1}, this)
    outMask.drawBitmap(this, {x: 2, y: 1}, this)
    outMask.drawBitmap(this, {x: 0, y: 2}, this)
    outMask.drawBitmap(this, {x: 1, y: 2}, this)
    outMask.drawBitmap(this, {x: 2, y: 2}, this)
    outMask.x = this.x - 1
    outMask.y = this.y - 1
    return outMask
  }

  public reverseMask() {
    let offset = 0
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.data[offset + x] ^= 0x7F
      }
      offset += this.stride
    }
  }

  public minMaskRect(): Rect {
    let cr = { x: 0, y: 0, width: this.width, height: this.height }

    // trim top
    let offset = cr.y * this.stride
    while (cr.height > 0) {
      let trimLine = true
      for (let x = 0; x < this.width; x += 1) {
        if (this.data[offset + x] != 0) {
          trimLine = false
          break
        }
      }
      if (!trimLine) {
        break
      }
      cr.y += 1
      cr.height -= 1
      offset += this.stride
    }

    // trim bottom
    offset = (cr.y + cr.height - 1) * this.stride
    while (cr.height > 0) {
      let trimLine = true
      for (let x = 0; x < this.width; x += 1) {
        if (this.data[offset + x] != 0) {
          trimLine = false
          break
        }
      }
      if (!trimLine) {
        break
      }
      cr.height -= 1
      offset -= this.stride
    }

    if (cr.height != 0) {
      // trim left
      offset = cr.y * this.stride + cr.x
      let leftTrim = this.width
      for (let y = 0; y < cr.height; y += 1) {
        for (let x = 0; x < cr.width; x += 1) {
          if (x == leftTrim) {
            break
          }
          if (this.data[offset + x] != 0) {
            leftTrim = x
            break
          }
        }
        if (leftTrim == 0) {
          break
        }
        offset += this.stride
      }
      cr.x += leftTrim
      cr.width -= leftTrim

      if (cr.width != 0) {
        // trim right
        offset = cr.y * this.stride + cr.x + cr.width - 1
        let rightTrim = this.width
        for (let y = 0; y < cr.height; y += 1) {
          for (let x = 0; x < cr.width; x += 1) {
            if (x == rightTrim) {
              break
            }
            if (this.data[offset - x] != 0) {
              rightTrim = x
              break
            }
          }
          if (rightTrim == 0) {
            break
          }
          offset += this.stride
        }
        cr.width -= rightTrim
      }
    }

    if (cr.width == 0 || cr.height == 0) {
      cr = { x: 0, y: 0, width: 0, height: 0 }
    }
    return cr
  }

  public togglePixel(pt: Point, foreColor: number, backColor: number, foreMatch?: boolean): boolean {

    if (pt.x < 0 || pt.y < 0 || pt.x >= this.width || pt.y >= this.height) {
      return false
    }

    const offset = pt.y * this.stride + pt.x
    if (foreMatch == undefined) {
      foreMatch = this.data[offset] == foreColor
    }
    this.data[offset] = foreMatch ? backColor : foreColor
    return foreMatch
  }

  public xorColor(foreColor: number) {
    const pattern = this.format.getColorPattern(foreColor)
    const patHeight = pattern.length
    const patWidth = pattern[0].length
    let patX = (0 + this.x) % patWidth
    let patY = (0 + this.y) % patHeight
    let offset = 0
    for (let y = 0; y < this.height; y += 1) {
      let px = patX
      for (let x = 0; x < this.width; x += 1) {
        this.data[offset + x] ^= pattern[patY][px]
        px += 1
        if (px == patWidth) {
          px = 0
        }
      }
      offset += this.stride
      patY += 1
      if (patY == patHeight) {
        patY = 0
      }
    }
  }

  protected clipRect(rect: Rect): Rect {
    let r = { ...rect }
    if (r.x < this.x) {
      r.width -= this.x - r.x
      r.x = 0
    }
    if (r.y < this.y) {
      r.height -= this.y - r.y
      r.y = 0
    }
    if (r.x + r.width > this.x + this.width) {
      r.width = this.x + this.width - r.x
    }
    if (r.y + r.height > this.y + this.height) {
      r.height = this.y + this.height - r.y
    }
    if (r.width < 0 || r.height < 0) {
      r = { x: 0, y: 0, width: 0, height: 0 }
    }
    this.lastRect = rect
    this.lastClip = r
    return r
  }

  public duplicate(rect?: Rect): Bitmap {
    if (rect === undefined) {
      return this.format.createBitmap(this)
    }
    const r = this.clipRect(rect)
    const bitmap = this.format.createBitmap(r)
    bitmap.x = r.x
    bitmap.y = r.y
    let srcOffset = r.y * this.stride + r.x
    let dstOffset = 0
    for (let y = 0; y < r.height; y += 1) {
      for (let x = 0; x < r.width; x += 1) {
        bitmap.data[dstOffset + x] = this.data[srcOffset + x]
      }
      srcOffset += this.stride
      dstOffset += bitmap.stride
    }
    return bitmap
  }

  public flipHorizontal() {
    let offset = 0
    const xmid = Math.floor(this.width / 2)
    for (let y = 0; y < this.height; y += 1) {
      for (let xl = 0, xr = this.width - 1; xl < xmid; xl += 1, xr -= 1) {
        const value = this.data[offset + xl]
        this.data[offset + xl] = this.data[offset + xr]
        this.data[offset + xr] = value
      }
      offset += this.stride
    }
  }

  public flipVertical() {
    let topOffset = 0
    let botOffset = (this.height - 1) * this.stride
    const ymid = Math.floor(this.height / 2)
    for (let y = 0; y < ymid; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const value = this.data[topOffset + x]
        this.data[topOffset + x] = this.data[botOffset + x]
        this.data[botOffset + x] = value
      }
      topOffset += this.stride
      botOffset -= this.stride
    }
  }

  public optimize() {
  }
}

//------------------------------------------------------------------------------
