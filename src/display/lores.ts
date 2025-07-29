
import { Point, Size, Rect, PixelData } from "../shared/types"
import { DisplayFormat, Bitmap } from "./format"
import { LoresColors, TextLoresInterleave } from "./tables"
import { deinterleave40, deinterleave80 } from "./text"

//------------------------------------------------------------------------------

export class LoresFormat extends DisplayFormat {

  public get name(): string {
    return "lores"
  }

  public get frameSize(): Size {
    return { width: 40, height: 48 }
  }

  public get displaySize(): Size {
    return { width: 560, height: 384 }
  }

  public get pixelScale(): Point {
    return { x: 14, y: 8 }
  }

  public get alignment(): Point {
    // TODO: consider y:2 alignment?
    return { x: 0, y: 0 }
  }

  public calcPixelWidth(byteWidth: number) {
    return byteWidth
  }

  public calcByteWidth(pixelX: number, pixelWidth: number) {
    return pixelWidth
  }

  public calcAddress(pixelX: number, pixelY: number, pageIndex: number): number {
    return 0x0400 + pageIndex * 0x0400 + TextLoresInterleave[Math.floor(pixelY / 2)] + pixelX
  }

  public calcByteColumn(pixelX: number): number {
    return pixelX
  }

  public createFramePixelData(): PixelData {
    return new PixelData(this.name, {x: 0, y: 0, ...this.frameSize}, this.frameSize.width)
  }

  public createBitmap(src: Bitmap | Rect):  Bitmap {
    return new LoresBitmap(src, this)
  }

  public get colorCount(): number {
    return LoresColors.length
  }

  public getColorValueRgb(index: number): number {
    return LoresColors[index]
  }

  public getColorPattern(index: number): number[][] {
    return [[index]]
  }

  public get altModes(): number {
    return 1
  }

  public colorize(srcBitmap: Bitmap, yTop: number, yBot: number, altMode: number, colorMain: Uint32Array, colorAlt: Uint32Array) {
    let frameOffset = yTop * srcBitmap.stride
    let colorOffset = yTop * this.pixelScale.y / 2 * this.displaySize.width
    for (let y = yTop; y < yBot; y += 1) {

      let srcIndex = frameOffset
      let dstIndex = colorOffset
      for (let x = 0; x < srcBitmap.width; x += 1) {
        const color = LoresColors[srcBitmap.data[srcIndex++]]
        for (let i = 0; i < this.pixelScale.x; i += 1) {
          colorMain[dstIndex++] = color
        }
      }
      frameOffset += srcBitmap.stride
      colorOffset += this.displaySize.width

      for (let yi = 1; yi < this.pixelScale.y / 2; yi += 1) {
        for (let x = 0; x < this.displaySize.width; x += 1) {
          colorMain[colorOffset + x] = colorMain[colorOffset - this.displaySize.width + x]
        }
        colorOffset += this.displaySize.width
      }
    }
  }

  public deinterleaveFrame(data: Uint8Array): PixelData {
    const pixelData = this.createFramePixelData()
    deinterleave40(data, pixelData, TextLoresInterleave)
    return pixelData
  }
}

//------------------------------------------------------------------------------

class LoresBitmap extends Bitmap {

  public constructor(src: Bitmap | Rect, format?: DisplayFormat) {
    super(src, format)
  }

  public encode(): PixelData {
    const dstByteWidth = this.width
    const data = new Uint8Array(Math.ceil(this.height / 2) * dstByteWidth)
    const pixelData = new PixelData(this.format.name, this.bounds, dstByteWidth, data)
    let srcOffset = 0
    let dstOffset = 0
    for (let y = 0; y < this.height; y += 2) {
      for (let x = 0; x < this.width; x += 1) {
        let dataByte = this.data[srcOffset + x]
        if (y + 1 < this.height) {
          dataByte |= this.data[srcOffset + this.stride + x] << 4
        }
        pixelData.bytes[dstOffset + x] = dataByte
      }
      srcOffset += this.stride * 2
      dstOffset += dstByteWidth
    }
    return pixelData
  }

  public decode(pixelData: PixelData): void {
    let srcOffset = 0
    let dstOffset = 0
    for (let y = 0; y < this.height; y += 2) {
      for (let x = 0; x < pixelData.byteWidth; x += 1) {
        const dataByte = pixelData.bytes[srcOffset + x]
        this.data[dstOffset + x] = dataByte & 0x0F
        if (y + 1 < this.height) {
          this.data[dstOffset + this.stride + x] = dataByte >> 4
        }
      }
      srcOffset += pixelData.byteWidth
      dstOffset += this.stride * 2
    }
  }
}

//------------------------------------------------------------------------------

export class DoubleLoresFormat extends LoresFormat {

  public get name(): string {
    return "dlores"
  }

  public get frameSize(): Size {
    return { width: 80, height: 48 }
  }

  public get displaySize(): Size {
    return { width: 560, height: 384 }
  }

  public get pixelScale(): Point {
    return { x: 7, y: 8 }
  }

  public calcAddress(pixelX: number, pixelY: number, pageIndex: number): number {
    return ((pixelX & 1) ? 0x0400 : 0x10400) + pageIndex * 0x0400
      + TextLoresInterleave[Math.floor(pixelY / 2)] + Math.floor(pixelX / 2)
  }

  public calcByteColumn(pixelX: number): number {
    return Math.floor(pixelX / 2)
  }

  public deinterleaveFrame(data: Uint8Array): PixelData {
    const pixelData = this.createFramePixelData()
    deinterleave80(data, pixelData, TextLoresInterleave)
    return pixelData
  }
}

//------------------------------------------------------------------------------
