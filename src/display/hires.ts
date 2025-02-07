
import { Point, Size, Rect, PixelData } from "../shared/types"
import { DisplayFormat, Bitmap } from "./format"
import { deinterleave40, deinterleave80 } from "./text"

import { HiresColors, DoubleHiresColors, HiresInterleave } from "./tables"
import { HGR_BLACK_RGB, HGR_WHITE_RGB } from "./tables"
import { HGR_PURPLE_RGB, HGR_GREEN_RGB, HGR_BLUE_RGB, HGR_ORANGE_RGB } from "./tables"
import { LIGHT_BLUE_RGB, DARK_BLUE_RGB } from "./tables"
import { YELLOW_RGB, BROWN_RGB, AQUA_RGB, PINK_RGB } from "./tables"

const LIGHT_BROWN_RGB = YELLOW_RGB
const DARK_BROWN_RGB = BROWN_RGB
const LIGHT_BLUE_GREEN_RGB = AQUA_RGB
const LIGHT_MAGENTA_RGB = PINK_RGB

//------------------------------------------------------------------------------

// TODO: update these to more closely match new HGR_*_RGBA values
const DIM_PURPLE_RGB       = 0xff320033   // (255,68,253) 10% (51,0,50)
const DIM_BLUE_RGB         = 0xff332900   // (20,207,253) 10% (0,41,51)
const DIM_ORANGE_RGB       = 0xff000c33   // (255,106,60) 10% (51,12,0)
const DIM_GREEN_RGB        = 0xff0a3102   // ( 20,245,60) 10% (2,49,10)

enum HiresColorIndex {
  Black0 = 0,
  Purple = 1,
  Green  = 2,
  White0 = 3,
  Black1 = 4,
  Blue   = 5,
  Orange = 6,
  White1 = 7,
}

//------------------------------------------------------------------------------

export class HiresFormat extends DisplayFormat {

  private readonly colorPatterns = [
    [[ 0x00, 0x00 ]], // black 0
    [[ 0x7F, 0x00 ]], // purple
    [[ 0x00, 0x7F ]], // green
    [[ 0x7F, 0x7F ]], // white 0
    [[ 0x80, 0x80 ]], // black 1
    [[ 0xFF, 0x80 ]], // blue
    [[ 0x80, 0xFF ]], // orange
    [[ 0xFF, 0xFF ]], // white 1
  ]

  public get name(): string {
    return "hires"
  }

  public get frameSize(): Size {
    return { width: 280, height: 192 }
  }

  public get displaySize(): Size {
    return { width: 560, height: 384 }
  }

  public get pixelScale(): Point {
    return { x: 2, y: 2 }
  }

  public get alignment(): Point {
    return { x: 7, y: 0 }
  }

  public calcPixelWidth(byteWidth: number) {
    return byteWidth * 7
  }

  public calcByteWidth(pixelX: number, pixelWidth: number) {
    return Math.ceil((pixelX % 7 + pixelWidth) / 7)
  }

  public calcAddress(pixelX: number, pixelY: number, pageIndex: number): number {
    return 0x2000 + pageIndex * 0x2000 + HiresInterleave[pixelY] + Math.floor(pixelX / 7)
  }

  public calcByteColumn(pixelX: number): number {
    return Math.floor(pixelX / 7)
  }

  public createFramePixelData(): PixelData {
    return new PixelData(this.name, {x: 0, y: 0, ...this.frameSize}, 40)
  }

  public createBitmap(src: Bitmap | Rect):  Bitmap {
    return new HiresBitmap(src, this)
  }

  public override createColorBuffers(): { main: Uint32Array, alt: Uint32Array } {
    const size = this.displaySize.width * this.displaySize.height / 2
    return { main: new Uint32Array(size), alt: new Uint32Array(size) }
  }

  public get colorCount(): number {
    return this.colorPatterns.length
  }

  public getColorValueRgb(index: number): number {
    return HiresColors[index]
  }

  public getColorPattern(index: number): number[][] {
    return this.colorPatterns[index]
  }

  public deinterleaveFrame(data: Uint8Array): PixelData {
    const pixelData = this.createFramePixelData()
    deinterleave40(data, pixelData, HiresInterleave)
    return pixelData
  }

  public get altModes(): number {
    return 2
  }

  public colorize(srcBitmap: Bitmap, yTop: number, yBot: number, altMode: number, dstDataTV: Uint32Array, dstDataRGB: Uint32Array) {

    let srcOffset = yTop * srcBitmap.stride
    let dstOffset = yTop * this.displaySize.width

    for (let y = yTop; y < yBot; y += 1) {

      let srcIndex = srcOffset
      let dstIndexRGB = dstOffset
      let dstIndexTV = dstOffset

      // handle initial delay
      let curHighBit = srcBitmap.data[srcIndex++]
      let nextHighBit = curHighBit
      if (curHighBit & 0x80) {
        dstDataTV[dstIndexTV++] = HGR_BLACK_RGB
      }

      let nextColorTV = undefined
      let nextWhiteTV = HGR_WHITE_RGB
      let bits = curHighBit & 1
      let parity = 0

      let x = 0
      while (true) {

        const highBitIndex = ((curHighBit & 0x80) ? HiresColorIndex.Black1 : HiresColorIndex.Black0) + 1
        for (let i = 0; i < 7; i += 1) {
          let outValueRGB: number
          let outValueTV: number
          nextHighBit = srcBitmap.data[srcIndex++]
          bits = ((bits << 1) | (nextHighBit & 1)) & 0x7
          if (bits == 0b010) {
            outValueRGB = HiresColors[highBitIndex + parity]
            if (nextColorTV) {
              outValueTV = nextColorTV
            } else {
              outValueTV = outValueRGB
            }
          } else if (bits == 0b101) {
            outValueRGB = HGR_BLACK_RGB
            outValueTV = HiresColors[highBitIndex + (parity ^ 1)]
          } else if (bits & 0b010) {
            outValueRGB = HGR_WHITE_RGB
            outValueTV = nextWhiteTV
          } else {
            outValueRGB = HGR_BLACK_RGB
            outValueTV = HGR_BLACK_RGB
          }
          nextWhiteTV = HGR_WHITE_RGB
          nextColorTV = undefined
          outValueRGB = (outValueRGB & 0xfffefefe) | ((curHighBit & 0x80) ? 0x00010101 : 0)
          dstDataRGB[dstIndexRGB++] = outValueRGB
          dstDataRGB[dstIndexRGB++] = outValueRGB
          dstDataTV[dstIndexTV++] = outValueTV
          dstDataTV[dstIndexTV++] = outValueTV
          parity ^= 1
        }

        x += 7
        if (x >= srcBitmap.width) {
          break
        }

        // check for change in pixel delay
        if ((nextHighBit ^ curHighBit) & 0x80) {
          curHighBit = nextHighBit
          if (nextHighBit & 0x80) {
            let outValueTV = dstDataTV[dstIndexTV - 1]
            if (bits == 0b010) {
              if (parity) {
                // extend violet into light blue (7)
                outValueTV = LIGHT_BLUE_RGB
              } else {
                // extend green into light brown (D)
                outValueTV = LIGHT_BROWN_RGB
              }
            }
            dstDataTV[dstIndexTV - 2] = outValueTV
            dstDataTV[dstIndexTV - 1] = outValueTV
            dstDataTV[dstIndexTV++] = outValueTV
          } else {
            dstDataTV[dstIndexTV] = HGR_BLACK_RGB
            dstIndexTV -= 1
            let outValueTV: number
            if (bits == 0b010) {
              if (parity) {
                // cut off blue with black to produce dark blue (2)
                outValueTV = DARK_BLUE_RGB
              } else {
                // cut off orange with black to produce dark brown (8)
                outValueTV = DARK_BROWN_RGB
              }
              dstDataTV[dstIndexTV - 1] = outValueTV
            } else if (bits == 0b011) {
              if (parity) {
                // cut off blue with green to produce light blue-green (E)
                outValueTV = LIGHT_BLUE_GREEN_RGB
              } else {
                // cut off orange with violet to produce light magenta (B)
                outValueTV = LIGHT_MAGENTA_RGB
              }
              dstDataTV[dstIndexTV - 1] = outValueTV
              nextWhiteTV = outValueTV
            } else if (bits == 0b110) {
              if (parity) {
                // cut off white with black to produce light magenta (B)
                outValueTV = LIGHT_MAGENTA_RGB
              } else {
                // cut off white with black to produce light blue-green (E)
                outValueTV = LIGHT_BLUE_GREEN_RGB
              }
              dstDataTV[dstIndexTV - 3] = outValueTV
              dstDataTV[dstIndexTV - 2] = outValueTV
              dstDataTV[dstIndexTV - 1] = outValueTV
            } else if (bits == 0x101) {
              if (parity) {
                // cut off orange/black with green to produce bright green
                // NOTE: experimentally, color looks more like brown/yellow,
                //  maybe brighter, but this is close enough
                outValueTV = LIGHT_BROWN_RGB
              } else {
                // cut off blue/black with violet to produce bright violet
                // NOTE: experimentally, color looks more like light blue,
                //  maybe brighter, but this is close enough
                outValueTV = LIGHT_BLUE_RGB
              }
              dstDataTV[dstIndexTV - 3] = outValueTV
              dstDataTV[dstIndexTV - 2] = outValueTV
              dstDataTV[dstIndexTV - 1] = outValueTV
              nextColorTV = outValueTV
            }
          }
        }
      }

      srcOffset += srcBitmap.stride
      dstOffset += this.displaySize.width
    }

    if (altMode == 2) {
      // apply special grid mode colorizing
      const remapTable = [
        DIM_PURPLE_RGB,
        DIM_GREEN_RGB,
        DIM_BLUE_RGB,
        DIM_ORANGE_RGB,
        HGR_PURPLE_RGB,
        HGR_GREEN_RGB,
        HGR_BLUE_RGB,
        HGR_ORANGE_RGB
      ]

      let offset = 0
      for (let y = 0; y < srcBitmap.height; y += 1) {
        for (let x = 0; x < srcBitmap.width * 2; x += 2) {
          let value = dstDataRGB[offset + x + 0]
          const index = ((value & 1) << 1) | ((x >> 1) & 1)
          value &= 0xfffefefe
          if (value == (HGR_BLACK_RGB & 0xfffefefe)) {
            value = remapTable[0 + index] & 0xfffefefe
          } else if (value == (HGR_WHITE_RGB & 0xfffefefe)) {
            value = remapTable[4 + index] & 0xfffefefe
          }
          dstDataRGB[offset + x + 0] = value
          dstDataRGB[offset + x + 1] = value
        }
        offset += srcBitmap.width * 2
      }
    }
  }
}

//------------------------------------------------------------------------------

class HiresBitmap extends Bitmap {

  public constructor(src: Bitmap | Rect, format?: DisplayFormat) {
    super(src, format)
  }

  // encode left-to-right pixels into packed/fliped HIRES bits
  public encode(): PixelData {
    const xm7 = this.x % 7
    const dstByteWidth = Math.ceil((this.width + xm7) / 7)
    const data = new Uint8Array(this.height * dstByteWidth)
    const pixelData = new PixelData(this.format.name, this.bounds, dstByteWidth, data)
    let srcOffset = 0
    let dstOffset = 0
    for (let y = 0; y < this.height; y += 1) {
      let i7 = xm7
      let dataByte = this.data[srcOffset + 0] & 0x80
      let dstIndex = dstOffset
      for (let x = 0; x < this.width; x += 1) {
        dataByte |= (this.data[srcOffset + x] & 1) << i7
        if (++i7 == 7) {
          data[dstIndex++] = dataByte
          if (x + 1 < this.width) {
            dataByte = this.data[srcOffset + x + 1] & 0x80
          }
          i7 = 0
        }
      }
      if (i7 != 0) {
        data[dstIndex++] = dataByte
      }
      srcOffset += this.stride
      dstOffset += dstByteWidth
    }
    return pixelData
  }

  // decode packed/flipped HIRES bits into individual, left-to-right pixels
  public decode(pixelData: PixelData): void {
    let srcOffset = 0
    let dstOffset = 0
    const xm7 = this.x % 7
    for (let y = 0; y < this.height; y += 1) {
      let i7 = xm7
      let xi = 0
      for (let x = 0; x < pixelData.byteWidth; x += 1) {
        const dataByte = pixelData.bytes[srcOffset + x]
        const highBit = dataByte & 0x80
        while (i7 < 7) {
          const value = (dataByte & (1 << i7)) ? 0x7F : 0x00
          this.data[dstOffset + xi] = value | highBit
          i7 += 1
          xi += 1
        }
        i7 = 0
      }
      srcOffset += pixelData.byteWidth
      dstOffset += this.stride
    }
  }

  public alignDirtyRect(dirtyRect: Rect): void {
    let xm7 = dirtyRect.x % 7
    dirtyRect.x -= xm7
    dirtyRect.width += xm7

    xm7 = (dirtyRect.x + dirtyRect.width) % 7
    if (xm7) {
      dirtyRect.width += 7 - xm7
    }

    // pad left and right to cover for cross-byte artifacts
    if (dirtyRect.x >= 7) {
      dirtyRect.x -= 7
      dirtyRect.width += 7
    }
    if (dirtyRect.x + dirtyRect.width + 7 <= this.width) {
      dirtyRect.width += 7
    }
  }

  public drawBitmap(srcBitmap: Bitmap, pt: Point, mask?: Bitmap) {
    super.drawBitmap(srcBitmap, pt, mask)
    this.fixEdges(0, false, mask)
  }

  public createMask(backColor: number): Bitmap {
    const mask = super.createMask(backColor)
    if (backColor == HiresColorIndex.Black0) {
      backColor = HiresColorIndex.Black1
    } else if (backColor == HiresColorIndex.Black1) {
      backColor = HiresColorIndex.Black0
    } else if (backColor == HiresColorIndex.White0) {
      backColor = HiresColorIndex.White1
    } else if (backColor == HiresColorIndex.White1) {
      backColor = HiresColorIndex.White0
    } else {
      return mask
    }
    const mask2 = super.createMask(backColor)
    let offset = 0
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        mask.data[offset + x] &= mask2.data[offset + x]
      }
      offset += mask.stride
    }
    return mask
  }

  public fillRect(rect: Rect, foreColor: number, mask?: Bitmap, parity: boolean = true) {
    super.fillRect(rect, foreColor, mask, parity)
    this.fixEdges(foreColor, false, mask)
  }

  public eraseRect(rect: Rect, backColor: number, mask?: Bitmap, parity: boolean = true) {
    super.fillRect(rect, backColor, mask, parity)
    this.fixEdges(backColor, true, mask)
  }

  private fixEdges(color: number, isErase: boolean, mask?: Bitmap) {
    const r = this.lastClip
    if (r.width != 0 && r.height != 0) {
      if (mask) {
        this.fixMaskEdges(color, isErase, mask)
      } else {
        this.fixRectEdges(color, isErase)
      }
    }
  }

  private isBlackOrWrite(color: number) {
    color &= 3
    return color == HiresColorIndex.Black0 || color == HiresColorIndex.White0
  }

  private fixMaskEdges(color: number, isErase: boolean, mask: Bitmap) {
    const rect = this.lastRect
    const r = this.lastClip
    const isBW = this.isBlackOrWrite(color)

    let srcOffset = (r.y - rect.y) * mask.width + (r.x - rect.x)
    let dstOffset = r.y * this.stride
    const xm7 = r.x % 7
    srcOffset -= r.x

    for (let y = 0; y < r.height; y += 1) {

      let xs: number
      let xe = r.x - xm7
      let xi = xm7

      while (xe != r.x + r.width) {
        xs = xe
        xe = Math.min(xs + 7, r.x + r.width)
        let xc = 0
        let highBit: number | undefined
        for (let i = xs + xi; i < xe; i += 1) {
          if (mask.data[srcOffset + i] != 0) {
            const value = this.data[dstOffset + i]
            if (highBit === undefined) {
              highBit = value
            }
            xc += 1
          }
        }
        if (highBit !== undefined) {
          if (!isErase || !isBW || xc == xe - xs - xi) {
            if (highBit & 0x80) {
              for (let i = xs; i < xe; i += 1) {
                this.data[dstOffset + i] |= 0x80
              }
            } else {
              for (let i = xs; i < xe; i += 1) {
                this.data[dstOffset + i] &= 0x7F
              }
            }
          }
        }
        xi = 0
      }
      srcOffset += mask.stride
      dstOffset += this.stride
    }
  }

  private fixRectEdges(color: number, isErase: boolean) {
    const r = this.lastClip
    if (isErase) {
      // only maintain edge bits if color is white or black
      if (this.isBlackOrWrite(color)) {
        if (r.x > 0) {
          this.fixEdge(r.x - 1, r.y, r.height)
        }
        if (r.x + r.width < this.width) {
          this.fixEdge(r.x + r.width, r.y, r.height)
        }
        return
      }
    }
    this.fixEdge(r.x, r.y, r.height)
    this.fixEdge(r.x + r.width - 1, r.y, r.height)
  }

  private fixEdge(xin: number, yin: number, height: number) {
    const xm7 = xin % 7
    let offset = yin * this.stride + xin - xm7
    for (let yy = 0; yy < height; yy += 1) {
      if (this.data[offset + xm7] & 0x80) {
        for (let x = 0; x < 7; x += 1) {
          this.data[offset + x] |= 0x80
        }
      } else {
        for (let x = 0; x < 7; x += 1) {
          this.data[offset + x] &= 0x7F
        }
      }
      offset += this.stride
    }
  }

  public togglePixel(pt: Point, foreColor: number, backColor: number, foreMatch?: boolean): boolean {

    if (pt.x < 0 || pt.y < 0 || pt.x >= this.width || pt.y >= this.height) {
      return false
    }

    let offset = pt.y * this.stride + pt.x
    if (foreMatch == undefined) {
      foreMatch = (this.data[offset] & 0x7F) != 0
    }
    if (foreMatch) {
      this.data[offset] &= ~0x7F
    } else {
      this.data[offset] |= 0x7F
    }

    offset -= pt.x % 7
    if (foreColor >= HiresColorIndex.Black1) {
      for (let i = 0; i < 7; i += 1) {
        this.data[offset + i] |= 0x80
      }
    } else {
      for (let i = 0; i < 7; i += 1) {
        this.data[offset + i] &= ~0x80
      }
    }
    return foreMatch
  }

  public flipHorizontal() {
    super.flipHorizontal()
    const leftModX = this.x % 7
    const rightModX = (7 - ((this.x + this.width) % 7)) % 7
    this.x += rightModX - leftModX
  }

  public optimize() {
    const pixelData = this.encode()
    for (let col = 0; col < pixelData.byteWidth; col += 1) {
      for (let pass = 0; pass < 2; pass += 1) {
        let offset = col - pixelData.byteWidth
        for (let row = 0; row < 192; row += 1) {
          offset += pixelData.byteWidth
          const currData = pixelData.bytes[offset]
          if (pass == 0) {
            // Convert 0x80 black into 0x00 black if previous
            //  column doesn't have a bit that may encroach.
            if (currData == 0x80) {
              if (col > 0) {
                if (pixelData.bytes[offset - 1] & 0x40) {
                  continue
                }
              }
              pixelData.bytes[offset] = 0x00
            }
          } else {
            if (currData == 0x00) {
              // Convert 0x00 black back to 0x80 black if pixel
              //  above and below have high bit set.
              if (row > 0) {
                if ((pixelData.bytes[offset - pixelData.byteWidth] & 0x80) == 0x00) {
                  continue
                }
              }
              if (row < 191) {
                if ((pixelData.bytes[offset + pixelData.byteWidth] & 0x80) == 0x00) {
                  continue
                }
              }
              if (col > 0) {
                if (pixelData.bytes[offset - 1] & 0x40) {
                  continue
                }
              }
              pixelData.bytes[offset] = 0x80
            }
          }
        }
      }
    }
    this.decode(pixelData)
  }
}

//------------------------------------------------------------------------------

// General description of double hires in Apple II Tech Note #3
//  https://ia903007.us.archive.org/28/items/IIe_2523003_Dbl_Hi-Res_Graphics/IIe_2523003_Dbl_Hi-Res_Graphics.pdf

export class DoubleHiresFormat extends DisplayFormat {

  public get name(): string {
    return "dhires"
  }

  public get frameSize(): Size {
    return { width: 140, height: 192 }
  }

  public get displaySize(): Size {
    return { width: 560, height: 384 }
  }

  public get pixelScale(): Point {
    return { x: 4, y: 2 }
  }

  public get alignment(): Point {
    return { x: 0, y: 0 }
  }

  public calcPixelWidth(byteWidth: number) {
    return Math.floor(byteWidth * 7 / 4)
  }

  public calcByteWidth(pixelX: number, pixelWidth: number) {
    // TODO: should this align using pixelX like Hires does?
    return Math.ceil(pixelWidth * 4 / 7)
  }

  public calcAddress(pixelX: number, pixelY: number, pageIndex: number): number {
    const xb80 = Math.floor(pixelX * 4 / 7)
    const xb40 = Math.floor(xb80 / 2)
    return ((xb80 & 1) ? 0x2000 : 0x12000) + pageIndex * 0x2000 + HiresInterleave[pixelY] + xb40
  }

  public calcByteColumn(pixelX: number): number {
    const xb80 = Math.floor(pixelX * 4 / 7)
    const xb40 = Math.floor(xb80 / 2)
    return xb40
  }

  public createFramePixelData(): PixelData {
    return new PixelData(this.name, {x: 0, y: 0, ...this.frameSize}, 80)
  }

  public createBitmap(src: Bitmap | Rect):  Bitmap {
    return new DoubleHiresBitmap(src, this)
  }

  public override createColorBuffers(): { main: Uint32Array, alt: Uint32Array } {
    const size = this.displaySize.width * this.displaySize.height / 2
    return { main: new Uint32Array(size), alt: new Uint32Array(size) }
  }

  public get colorCount(): number {
    return DoubleHiresColors.length
  }

  public getColorValueRgb(index: number): number {
    return DoubleHiresColors[index]
  }

  public getColorPattern(index: number): number[][] {
    return [[index]]
  }

  // input data is aux memory followed by main memory, each 40 bytes by 192 lines, each with line swizzle
  public deinterleaveFrame(data: Uint8Array): PixelData {
    const pixelData = this.createFramePixelData()
    deinterleave80(data, pixelData, HiresInterleave)
    return pixelData
  }

  public get altModes(): number {
    return 1
  }

  public colorize(srcBitmap: Bitmap, yTop: number, yBot: number, altMode: number, dstDataTV: Uint32Array, dstDataRGB: Uint32Array) {
    let srcOffset = yTop * srcBitmap.stride
    let dstOffset = yTop * this.displaySize.width
    for (let y = yTop; y < yBot; y += 1) {

      let srcIndex = srcOffset
      let dstIndex = dstOffset
      let prevPixel = 0
      let curPixel = 0
      let nextPixel = srcBitmap.data[srcIndex++]

      for (let x = 0; x < srcBitmap.width; x += 1) {

        prevPixel = curPixel
        curPixel = nextPixel
        nextPixel = x + 1 < srcBitmap.width ? srcBitmap.data[srcIndex++] : 0

        const color4 = this.prevTable[curPixel * 16 + prevPixel] + this.nextTable[curPixel * 16 + nextPixel]
        dstDataTV[dstIndex + 0] = DoubleHiresColors[(color4 >> 12) & 0x0f]
        dstDataTV[dstIndex + 1] = DoubleHiresColors[(color4 >>  8) & 0x0f]
        dstDataTV[dstIndex + 2] = DoubleHiresColors[(color4 >>  4) & 0x0f]
        dstDataTV[dstIndex + 3] = DoubleHiresColors[(color4 >>  0) & 0x0f]

        const curColor = DoubleHiresColors[curPixel]
        dstDataRGB[dstIndex + 0] = curColor
        dstDataRGB[dstIndex + 1] = curColor
        dstDataRGB[dstIndex + 2] = curColor
        dstDataRGB[dstIndex + 3] = curColor

        dstIndex += 4
      }

      srcOffset += srcBitmap.stride
      dstOffset += this.displaySize.width
    }
  }

  private readonly prevTable = [
    0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,
    0x0000,0x1110,0x0000,0x1110,0x0000,0x1110,0x0000,0x1110,0x0000,0x1110,0x0000,0x1110,0x0000,0x1110,0x0000,0x1110,
    0x0000,0x3300,0x2200,0x3300,0x0000,0x3300,0x2200,0x3300,0x0000,0x3300,0x2200,0x3300,0x0000,0x3300,0x2200,0x3300,
    0x0000,0x3300,0x2200,0x3300,0x0000,0x3300,0x2200,0x3300,0x0000,0x3300,0x2200,0x3300,0x0000,0x3300,0x2200,0x3300,
    0x0400,0x5500,0x6400,0x7500,0x4400,0x5500,0x6400,0x7500,0x0400,0x5500,0x6400,0x7500,0x4400,0x5500,0x6400,0x7500,
    0x0500,0x5500,0x6500,0x7500,0x4500,0x5500,0x6500,0x7500,0x0500,0x5500,0x6500,0x7500,0x4500,0x5500,0x6500,0x7500,
    0x0600,0x7700,0x6600,0x7700,0x4600,0x7700,0x6600,0x7700,0x0600,0x7700,0x6600,0x7700,0x4600,0x7700,0x6600,0x7700,
    0x0700,0x7700,0x6700,0x7700,0x4700,0x7700,0x6700,0x7700,0x0700,0x7700,0x6700,0x7700,0x4700,0x7700,0x6700,0x7700,
    0x8000,0x9000,0xA000,0xB000,0x8000,0x9000,0xA000,0xB000,0x8000,0x9000,0xA000,0xB000,0x8000,0x9000,0xA000,0xB000,
    0x8990,0x9990,0xA990,0xB990,0x8990,0x9990,0xA990,0xB990,0x8990,0x9990,0xA990,0xB990,0x8990,0x9990,0xA990,0xB990,
    0xAAA0,0xBBA0,0xAAA0,0xBBA0,0xAAA0,0xBBA0,0xAAA0,0xBBA0,0xAAA0,0xBBA0,0xAAA0,0xBBA0,0xAAA0,0xBBA0,0xAAA0,0xBBA0,
    0xABB0,0xBBB0,0xABB0,0xBBB0,0xABB0,0xBBB0,0xABB0,0xBBB0,0xABB0,0xBBB0,0xABB0,0xBBB0,0xABB0,0xBBB0,0xABB0,0xBBB0,
    0xCC00,0xDD00,0xEC00,0xFD00,0xCC00,0xDD00,0xEC00,0xFD00,0xCC00,0xDD00,0xEC00,0xFD00,0xCC00,0xDD00,0xEC00,0xFD00,
    0xCDD0,0xDDD0,0xEDD0,0xFDD0,0xCDD0,0xDDD0,0xEDD0,0xFDD0,0xCDD0,0xDDD0,0xEDD0,0xFDD0,0xCDD0,0xDDD0,0xEDD0,0xFDD0,
    0xEEE0,0xFFE0,0xEEE0,0xFFE0,0xEEE0,0xFFE0,0xEEE0,0xFFE0,0xEEE0,0xFFE0,0xEEE0,0xFFE0,0xEEE0,0xFFE0,0xEEE0,0xFFE0,
    0xEFF0,0xFFF0,0xEFF0,0xFFF0,0xEFF0,0xFFF0,0xEFF0,0xFFF0,0xEFF0,0xFFF0,0xEFF0,0xFFF0,0xEFF0,0xFFF0,0xEFF0,0xFFF0
  ]

  private readonly nextTable = [
    0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,
    0x0001,0x0001,0x0001,0x0001,0x0005,0x0005,0x0005,0x0005,0x0009,0x0009,0x0009,0x0009,0x000D,0x000D,0x000D,0x000D,
    0x0020,0x0020,0x0022,0x0022,0x0026,0x0026,0x0026,0x0026,0x00AA,0x00AA,0x00AA,0x00AA,0x00AE,0x00AE,0x00AE,0x00AE,
    0x0033,0x0033,0x0033,0x0033,0x0037,0x0037,0x0037,0x0037,0x00BB,0x00BB,0x00BB,0x00BB,0x00BF,0x00BF,0x00BF,0x00BF,
    0x0000,0x0000,0x0000,0x0000,0x0044,0x0044,0x0044,0x0044,0x00CC,0x00CC,0x00CC,0x00CC,0x00CC,0x00CC,0x00CC,0x00CC,
    0x0055,0x0055,0x0055,0x0055,0x0055,0x0055,0x0055,0x0055,0x00DD,0x00DD,0x00DD,0x00DD,0x00DD,0x00DD,0x00DD,0x00DD,
    0x0060,0x0060,0x0062,0x0062,0x0066,0x0066,0x0066,0x0066,0x00EE,0x00EE,0x00EE,0x00EE,0x00EE,0x00EE,0x00EE,0x00EE,
    0x0077,0x0077,0x0077,0x0077,0x0077,0x0077,0x0077,0x0077,0x00FF,0x00FF,0x00FF,0x00FF,0x00FF,0x00FF,0x00FF,0x00FF,
    0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,0x0888,0x0888,0x0888,0x0888,0x0888,0x0888,0x0888,0x0888,
    0x0001,0x0001,0x0001,0x0001,0x0005,0x0005,0x0005,0x0005,0x0009,0x0009,0x0009,0x0009,0x000D,0x000D,0x000D,0x000D,
    0x0000,0x0000,0x0002,0x0002,0x0006,0x0006,0x0006,0x0006,0x000A,0x000A,0x000A,0x000A,0x000E,0x000E,0x000E,0x000E,
    0x0003,0x0003,0x0003,0x0003,0x0007,0x0007,0x0007,0x0007,0x000B,0x000B,0x000B,0x000B,0x000F,0x000F,0x000F,0x000F,
    0x0000,0x0000,0x0000,0x0000,0x0044,0x0044,0x0044,0x0044,0x00CC,0x00CC,0x00CC,0x00CC,0x00CC,0x00CC,0x00CC,0x00CC,
    0x0005,0x0005,0x0005,0x0005,0x0005,0x0005,0x0005,0x0005,0x000D,0x000D,0x000D,0x000D,0x000D,0x000D,0x000D,0x000D,
    0x0000,0x0000,0x0002,0x0002,0x0006,0x0006,0x0006,0x0006,0x000E,0x000E,0x000E,0x000E,0x000E,0x000E,0x000E,0x000E,
    0x0007,0x0007,0x0007,0x0007,0x0007,0x0007,0x0007,0x0007,0x000F,0x000F,0x000F,0x000F,0x000F,0x000F,0x000F,0x000F
  ]
}

//------------------------------------------------------------------------------

class DoubleHiresBitmap extends Bitmap {

  public constructor(src: Bitmap | Rect, format?: DisplayFormat) {
    super(src, format)
  }

  public encode(): PixelData {
    const dstByteWidth = Math.ceil(this.width * 4 / 7)
    const data = new Uint8Array(this.height * dstByteWidth)
    const pixelData = new PixelData(this.format.name, this.bounds, dstByteWidth, data)
    let srcOffset = 0
    let dstOffset = 0
    for (let y = 0; y < this.height; y += 1) {
      let outBits = 0
      let outCount = 0
      let dstIndex = dstOffset
      for (let x = 0; x < this.width; x += 1) {
        let pixel = this.data[srcOffset + x]
        let mask = 0x08
        for (let i = 0; i < 4; i += 1) {
          outBits >>= 1
          if (pixel & mask) {
            outBits |= 0x40
          }
          mask >>= 1
          if (++outCount == 7) {
            pixelData.bytes[dstIndex++] = outBits
            outCount = 0
          }
        }
      }
      if (outCount > 0) {
        while (outCount < 7) {
          outBits >>= 1
          outCount += 1
        }
        pixelData.bytes[dstIndex++] = outBits
      }
      srcOffset += this.stride
      dstOffset += pixelData.byteWidth
    }
    return pixelData
  }

  public decode(pixelData: PixelData): void {
    let srcOffset = 0
    let dstOffset = 0
    for (let y = 0; y < this.height; y += 1) {
      let inBits = 0
      let inCount = 0
      let srcIndex = srcOffset
      for (let x = 0; x < this.width; x += 1) {
        let pixel = 0
        for (let i = 0; i < 4; i += 1) {
          if (inCount == 0) {
            inBits = pixelData.bytes[srcIndex++]
            inCount = 7
          }
          pixel = (pixel << 1) | (inBits & 1)
          inBits >>= 1
          inCount -= 1
        }
        this.data[dstOffset + x] = pixel
      }
      srcOffset += pixelData.byteWidth
      dstOffset += this.stride
    }
  }
}

//------------------------------------------------------------------------------
