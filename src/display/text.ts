import * as base64 from 'base64-js'
import { Point, Size, Rect, PixelData } from "../shared/types"
import { DisplayFormat, Bitmap } from "./format"
import { TextLoresInterleave, HGR_BLACK_RGB, HGR_WHITE_RGB } from "./tables"

//------------------------------------------------------------------------------

// TODO: possibly add interleave40/80

export function deinterleave40(inData: Uint8Array, outData: PixelData, interleaveTable: number[]) {
  let dstOffset = 0
  for (let y = 0; y < outData.bounds.height; y += 1) {
    const srcOffset = interleaveTable[y]
    for (let x = 0; x < outData.byteWidth; x += 1) {
      outData.bytes[dstOffset + x] = inData[srcOffset + x]
    }
    dstOffset += outData.byteWidth
  }
}

export function deinterleave80(inData: Uint8Array, outData: PixelData, interleaveTable: number[]) {
  let dstOffset = 0
  const halfByteWidth = outData.byteWidth / 2
  const halfInSize = inData.length / 2
  for (let y = 0; y < outData.bounds.height; y += 1) {
    const srcOffset = interleaveTable[y]
    let dstIndex = dstOffset
    for (let x = 0; x < halfByteWidth; x += 1) {
      outData.bytes[dstIndex++] = inData[srcOffset + x]
      outData.bytes[dstIndex++] = inData[srcOffset + x + halfInSize]
    }
    dstOffset += outData.byteWidth
  }
}

//------------------------------------------------------------------------------

export class Text40Format extends DisplayFormat {

  private fontVariant: string = "a2e"
  protected font?: Font

  constructor() {
    super()
  }

  public setFontVariant(fontVariant: string) {
    this.font = undefined
    this.fontVariant = fontVariant
  }

  public get name(): string {
    return "text40"
  }

  public get frameSize(): Size {
    return { width: 40, height: 24 }
  }

  public get displaySize(): Size {
    return { width: 560, height: 384 }
  }

  public get pixelScale(): Point {
    return { x: 14, y: 16 }
  }

  public get alignment(): Point {
    return { x: 0, y: 0 }
  }

  public calcPixelWidth(byteWidth: number) {
    return byteWidth
  }

  public calcByteWidth(pixelX: number, pixelWidth: number) {
    return pixelWidth
  }

  public calcAddress(pixelX: number, pixelY: number, pageIndex: number): number {
    return 0x0400 + pageIndex * 0x0400 + TextLoresInterleave[pixelY] + pixelX
  }

  public calcByteColumn(pixelX: number): number {
    return pixelX
  }

  public createFramePixelData(): PixelData {
    return new PixelData(this.name, {x: 0, y: 0, ...this.frameSize}, this.frameSize.width)
  }

  public createBitmap(src: Bitmap | Rect):  Bitmap {
    return new TextBitmap(src, this)
  }

  public get colorCount(): number {
    return 2
  }

  public getColorValueRgb(index: number): number {
    if (index == 0) {
      return 0xff000000
    } else {
      return 0xffffffff
    }
  }

  public getColorPattern(index: number): number[][] {
    if (index == 0) {
      return [[0xA0]]   // space character
    } else {
      return [[0x20]]   // inverted space character
    }
  }

  public get altModes(): number {
    return 1
  }

  public colorize(srcBitmap: Bitmap, yTop: number, yBot: number, altMode: number, colorBuffer: Uint32Array, colorBufferAlt: Uint32Array) {
    if (!this.font) {
      this.font = Font.create(this.fontVariant)
    }
    let frameOffset = yTop * srcBitmap.stride
    let colorOffset = yTop * this.pixelScale.y / 2 * this.displaySize.width
    const isWideText = this.pixelScale.x == 14
    for (let y = yTop; y < yBot; y += 1) {
      for (let x = 0; x < this.frameSize.width; x += 1) {
        const charIndex = srcBitmap.data[frameOffset + x]
        let dstOffset = colorOffset + x * this.pixelScale.x
        const charBits = this.font.getCharBits(charIndex)
        if (!charBits) {
          continue
        }
        for (let yy = 0; yy < 8; yy += 1) {
          const dataByte = charBits[yy] ^ 0x7F
          let dstIndex = dstOffset
          let mask = 0x01
          for (let xx = 0; xx < 7; xx += 1) {
            const value = (dataByte & mask) ? HGR_WHITE_RGB : HGR_BLACK_RGB
            colorBuffer[dstIndex++] = value
            if (isWideText) {
              colorBuffer[dstIndex++] = value
            }
            mask <<= 1
          }
          dstOffset += this.displaySize.width
        }
      }
      frameOffset += srcBitmap.stride
      colorOffset += this.displaySize.width * this.pixelScale.y / 2
    }
  }

  public deinterleaveFrame(data: Uint8Array): PixelData {
    const pixelData = this.createFramePixelData()
    deinterleave40(data, pixelData, TextLoresInterleave)
    return pixelData
  }
}

//------------------------------------------------------------------------------

class TextBitmap extends Bitmap {

  public constructor(src: Bitmap | Rect, format?: DisplayFormat) {
    super(src, format)
  }

  public encode(): PixelData {
    const dstByteWidth = this.width
    const data = new Uint8Array(this.height * dstByteWidth)
    const pixelData = new PixelData(this.format.name, this.bounds, dstByteWidth, data)
    let srcOffset = 0
    let dstOffset = 0
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        pixelData.bytes[dstOffset + x] = this.data[srcOffset + x]
      }
      srcOffset += this.stride
      dstOffset += dstByteWidth
    }
    return pixelData
  }

  public decode(pixelData: PixelData): void {
    let srcOffset = 0
    let dstOffset = 0
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < pixelData.byteWidth; x += 1) {
        this.data[dstOffset + x] = pixelData.bytes[srcOffset + x]
      }
      srcOffset += pixelData.byteWidth
      dstOffset += this.stride
    }
  }

  public togglePixel(pt: Point, foreColor: number, backColor: number, foreMatch?: boolean): boolean {
    if (pt.x < 0 || pt.y < 0 || pt.x >= this.width || pt.y >= this.height) {
      return false
    }
    const offset = pt.y * this.stride + pt.x
    if (foreMatch == undefined) {
      foreMatch = this.data[offset] == 0x20
    }
    this.data[offset] = foreMatch ? 0xA0 : 0x20
    return foreMatch
  }
}

//------------------------------------------------------------------------------

export class Text80Format extends Text40Format {

  public get name(): string {
    return "text80"
  }

  public get frameSize(): Size {
    return { width: 80, height: 24 }
  }

  public get displaySize(): Size {
    return { width: 560, height: 384 }
  }

  public get pixelScale(): Point {
    return { x: 7, y: 16 }
  }

  public calcAddress(x: number, y: number, pageIndex: number): number {
    return ((x & 1) ? 0x0400 : 0x10400) + pageIndex * 0x0400 + TextLoresInterleave[y] + Math.floor(x / 2)
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

export abstract class Font {
  public static create(name: string): Font {
    if (name == "naja") {
      return new NajaFont()
    } else if (name == "a2p") {
      return new AppleIIpFont()
    } /*else if (name == "a2e")*/ {
      return new AppleIIeFont()
    }
  }

  public abstract get charSize(): Size
  public abstract get charSpacing(): Size
  public abstract get startMask(): number
  public abstract get endMask(): number
  public abstract getCharBits(asciiCode: number): Uint8Array | undefined
}

//------------------------------------------------------------------------------

export class AppleIIeFont implements Font {

  protected fontData: Uint8Array

  constructor() {
    this.fontData = base64.toByteArray(a2eVideo.join(""))
  }

  public get charSize(): Size {
    return {width: 7, height: 8}
  }

  public get charSpacing(): Size {
    return {width: 0, height: 0}
  }

  public get startMask(): number {
    return 0x01
  }

  public get endMask(): number {
    return 0x40
  }

  public getCharBits(code: number): Uint8Array | undefined {
    return this.fontData.subarray(code * 8, code * 8 + 8)
  }
}

class AppleIIpFont extends AppleIIeFont {
  constructor() {
    super()

    // 0x00 - 0x3F: (inverse) no change
    // 0x40 - 0x7F: (flashing) copy from 0x00 - 0x3F
    // 0x80 - 0xBF: no change
    // 0xC0 - 0xFF: copy from 0x80 - 0xBF
    for (let i = 0; i < 0x40 * 8; i += 1) {
      this.fontData[0x40 * 8 + i] = this.fontData[0x00 * 8 + i]
      this.fontData[0xC0 * 8 + i] = this.fontData[0x80 * 8 + i]
    }
  }
}

//------------------------------------------------------------------------------

const NajaChars = new Uint8Array([
  0x0E,0x1B,0x1B,0x1B,0x1B,0x1B,0x0E,   // 0
  0x0C,0x0E,0x0C,0x0C,0x0C,0x0C,0x1E,   // 1
  0x1F,0x1B,0x18,0x1F,0x03,0x03,0x1F,   // 2
  0x1F,0x18,0x18,0x0E,0x18,0x18,0x1F,   // 3
  0x1B,0x1B,0x1B,0x1F,0x18,0x18,0x18,   // 4
  0x1F,0x03,0x03,0x1F,0x18,0x1B,0x1F,   // 5
  0x1F,0x03,0x03,0x1F,0x1B,0x1B,0x1F,   // 6
  0x1F,0x18,0x18,0x18,0x18,0x18,0x18,   // 7
  0x1F,0x1B,0x1B,0x0E,0x1B,0x1B,0x1F,   // 8
  0x1F,0x1B,0x1B,0x1F,0x18,0x18,0x18,   // 9
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,   // <space>
  0x1F,0x1B,0x1B,0x1F,0x1B,0x1B,0x1B,   // A
  0x0F,0x1B,0x1B,0x0F,0x1B,0x1B,0x0F,   // B
  0x1F,0x1B,0x03,0x03,0x03,0x1B,0x1F,   // C
  0x0F,0x1B,0x1B,0x1B,0x1B,0x1B,0x0F,   // D
  0x1F,0x1B,0x03,0x0F,0x03,0x1B,0x1F,   // E
  0x1F,0x1B,0x03,0x0F,0x03,0x03,0x03,   // F
  0x1F,0x1B,0x03,0x03,0x1F,0x1B,0x1F,   // G
  0x1B,0x1B,0x1B,0x1F,0x1B,0x1B,0x1B,   // H
  0x1E,0x0C,0x0C,0x0C,0x0C,0x0C,0x1E,   // I
  0x18,0x18,0x18,0x18,0x18,0x1B,0x1F,   // J
  0x1B,0x1B,0x1B,0x0F,0x1B,0x1B,0x1B,   // K
  0x03,0x03,0x03,0x03,0x03,0x03,0x1F,   // L
  0x1B,0x1F,0x1F,0x1F,0x1B,0x1B,0x1B,   // M
  0x0F,0x1B,0x1B,0x1B,0x1B,0x1B,0x1B,   // N
  0x1F,0x1B,0x1B,0x1B,0x1B,0x1B,0x1F,   // O
  0x1F,0x1B,0x1B,0x1F,0x03,0x03,0x03,   // P
  0x1F,0x1B,0x1B,0x1B,0x1B,0x0F,0x1C,   // Q
  0x0F,0x1B,0x1B,0x0F,0x1B,0x1B,0x1B,   // R
  0x1F,0x1B,0x03,0x1F,0x18,0x1B,0x1F,   // S
  0x1F,0x0C,0x0C,0x0C,0x0C,0x0C,0x0C,   // T
  0x1B,0x1B,0x1B,0x1B,0x1B,0x1B,0x1F,   // U
  0x1B,0x1B,0x1B,0x1B,0x1B,0x0E,0x0E,   // V
  0x1B,0x1B,0x1B,0x1F,0x1F,0x1F,0x1B,   // W
  0x1B,0x1B,0x1B,0x0E,0x1B,0x1B,0x1B,   // X
  0x1B,0x1B,0x1B,0x1F,0x18,0x1B,0x1F,   // Y
  0x1F,0x18,0x1C,0x0E,0x07,0x03,0x1F,   // Z
  0x0C,0x1E,0x1E,0x0C,0x0C,0x00,0x0C,   // !
  0x1B,0x1B,0x1B,0x00,0x00,0x00,0x00,   // "
  0x1B,0x1B,0x18,0x0E,0x03,0x1B,0x1B,   // %
  0x06,0x06,0x06,0x00,0x00,0x00,0x00,   // '
  0x00,0x1B,0x0E,0x1F,0x0E,0x1B,0x00,   // *
  0x00,0x0C,0x0C,0x1F,0x0C,0x0C,0x00,   // +
  0x00,0x00,0x00,0x00,0x00,0x0C,0x06,   // ,
  0x00,0x00,0x00,0x1F,0x00,0x00,0x00,   // -
  0x00,0x00,0x00,0x00,0x00,0x0C,0x0C,   // .
  0x00,0x00,0x18,0x0C,0x06,0x03,0x00,   // /
  0x00,0x0C,0x0C,0x00,0x0C,0x0C,0x00,   // :
  0x18,0x0C,0x06,0x03,0x06,0x0C,0x18,   // <
  0x00,0x00,0x1F,0x00,0x1F,0x00,0x00,   // =
  0x03,0x06,0x0C,0x18,0x0C,0x06,0x03,   // >
  0x1F,0x1B,0x18,0x1E,0x06,0x00,0x06,   // ?
])

export class NajaFont implements Font {

  public get charSize(): Size {
    return {width: 5, height: 7}
  }

  public get charSpacing(): Size {
    return {width: 1, height: 1}
  }

  public get startMask(): number {
    return 0x01
  }

  public get endMask(): number {
    return 0x10
  }

  public getCharBits(code: number): Uint8Array | undefined {
    let index
    if (code >= 0x30 && code <= 0x39) {			    // 0-9
      index = code - 0x30
    } else if (code >= 0x20 && code <= 0x2F) {
      const map = [
        0x0A,         // <space>
        0x25,         // !
        0x26,         // "
        undefined,    // #
        undefined,    // $
        0x27,         // %
        undefined,    // &
        0x28,         // '
        undefined,    // (
        undefined,    // )
        0x29,         // *
        0x2A,         // +
        0x2B,         // ,
        0x2C,         // -
        0x2D,         // .
        0x2E,         // /
      ]
      index = map[code - 0x20]
    } else if (code >= 0x3A && code <= 0x3F) {
      const map = [
        0x2F,       // :
        undefined,  // ;
        0x30,       // <
        0x31,       // =
        0x32,       // >
        0x33        // ?
      ]
      index = map[code - 0x3A]
    } else if (code >= 0x41 && code <= 0x5A) {  // A-Z
      index = 0x0B + code - 0x41
    }
    if (index !== undefined) {
      return NajaChars.subarray(index * 7, index * 7 + 7)
    }
  }
}

//------------------------------------------------------------------------------

// APPLE IIe - VIDEO UNENHANCED - 342-0133 - A - 2732.bin

const a2eVideo = [
  'HCIqOhoCPAAIFCIiPiIiAB4iIh4iIh4AHCICAgIiHAAeIiIiIiIeAD4CAh4CAj4APgICHgICAgA8AgIC',
  'MiI8ACIiIj4iIiIAHAgICAgIHAAgICAgICIcACISCgYKEiIAAgICAgICPgAiNioqIiIiACIiJioyIiIA',
  'HCIiIiIiHAAeIiIeAgICABwiIiIqEiwAHiIiHgoSIgAcIgIcICIcAD4ICAgICAgAIiIiIiIiHAAiIiIi',
  'IhQIACIiIioqNiIAIiIUCBQiIgAiIhQICAgIAD4gEAgEAj4APgYGBgYGPgAAAgQIECAAAD4wMDAwMD4A',
  'AAAIFCIAAAAAAAAAAAAAfwAAAAAAAAAACAgICAgACAAUFBQAAAAAABQUPhQ+FBQACDwKHCgeCAAGJhAI',
  'BDIwAAQKCgQqEiwACAgIAAAAAAAIBAICAgQIAAgQICAgEAgACCocCBwqCAAACAg+CAgAAAAAAAAICAQA',
  'AAAAPgAAAAAAAAAAAAAIAAAgEAgEAgAAHCIyKiYiHAAIDAgICAgcABwiIBgEAj4APiAQGCAiHAAQGBQS',
  'PhAQAD4CHiAgIhwAOAQCHiIiHAA+IBAIBAQEABwiIhwiIhwAHCIiPCAQDgAAAAgACAAAAAAACAAICAQA',
  'EAgEAgQIEAAAAD4APgAAAAQIECAQCAQAHCIQCAgACAAcIio6GgI8AAgUIiI+IiIAHiIiHiIiHgAcIgIC',
  'AiIcAB4iIiIiIh4APgICHgICPgA+AgIeAgICADwCAgIyIjwAIiIiPiIiIgAcCAgICAgcACAgICAgIhwA',
  'IhIKBgoSIgACAgICAgI+ACI2KioiIiIAIiImKjIiIgAcIiIiIiIcAB4iIh4CAgIAHCIiIioSLAAeIiIe',
  'ChIiABwiAhwgIhwAPggICAgICAAiIiIiIiIcACIiIiIiFAgAIiIiKio2IgAiIhQIFCIiACIiFAgICAgA',
  'PiAQCAQCPgA+BgYGBgY+AAACBAgQIAAAPjAwMDAwPgAAAAgUIgAAAAAAAAAAAAB/BAgQAAAAAAAAABwg',
  'PCI8AAICHiIiIh4AAAA8AgICPAAgIDwiIiI8AAAAHCI+AjwAGCQEHgQEBAAAABwiIjwgHAICHiIiIiIA',
  'CAAMCAgIHAAQABgQEBASDAICIhIOEiIADAgICAgIHAAAADYqKioiAAAAHiIiIiIAAAAcIiIiHAAAAB4i',
  'Ih4CAgAAPCIiPCAgAAA6BgICAgAAADwCHCAeAAQEHgQEJBgAAAAiIiIyLAAAACIiIhQIAAAAIiIqKjYA',
  'AAAiFAgUIgAAACIiIjwgHAAAPhAIBD4AOAwMBgwMOAAICAgICAgICA4YGDAYGA4ALBoAAAAAAAAAKhQq',
  'FCoAAOPd1cXl/cP/9+vd3cHd3f/h3d3h3d3h/+Pd/f393eP/4d3d3d3d4f/B/f3h/f3B/8H9/eH9/f3/',
  'w/39/c3dw//d3d3B3d3d/+P39/f39+P/39/f39/d4//d7fX59e3d//39/f39/cH/3cnV1d3d3f/d3dnV',
  'zd3d/+Pd3d3d3eP/4d3d4f39/f/j3d3d1e3T/+Hd3eH17d3/493949/d4//B9/f39/f3/93d3d3d3eP/',
  '3d3d3d3r9//d3d3V1cnd/93d6/fr3d3/3d3r9/f39//B3+/3+/3B/8H5+fn5+cH///379+/f///Bz8/P',
  'z8/B////9+vd/////////////4D///////////f39/f3//f/6+vr///////r68Hrwevr//fD9ePX4ff/',
  '+dnv9/vNz//79fX71e3T//f39///////9/v9/f379//379/f3+/3//fV4/fj1ff///f3wff3////////',
  '9/f7/////8H/////////////9///3+/3+/3//+PdzdXZ3eP/9/P39/f34//j3d/n+/3B/8Hf7+ff3eP/',
  '7+fr7cHv7//B/eHf393j/8f7/eHd3eP/wd/v9/v7+//j3d3j3d3j/+Pd3cPf7/H////3//f///////f/',
  '9/f7/+/3+/379+/////B/8H////79+/f7/f7/+Pd7/f3//f/493VxeX9w//3693dwd3d/+Hd3eHd3eH/',
  '4939/f3d4//h3d3d3d3h/8H9/eH9/cH/wf394f39/f/D/f39zd3D/93d3cHd3d3/4/f39/f34//f39/f',
  '393j/93t9fn17d3//f39/f39wf/dydXV3d3d/93d2dXN3d3/493d3d3d4//h3d3h/f39/+Pd3d3V7dP/',
  '4d3d4fXt3f/j3f3j393j/8H39/f39/f/3d3d3d3d4//d3d3d3ev3/93d3dXVyd3/3d3r9+vd3f/d3ev3',
  '9/f3/8Hf7/f7/cH/wfn5+fn5wf///fv379///8HPz8/Pz8H////3693/////////////gPv37///////',
  '///j38Pdw//9/eHd3d3h////w/39/cP/39/D3d3dw////+Pdwf3D/+fb++H7+/v////j3d3D3+P9/eHd',
  '3d3d//f/8/f39+P/7//n7+/v7fP9/d3t8e3d//P39/f39+P////J1dXV3f///+Hd3d3d////493d3eP/',
  '///h3d3h/f3//8Pd3cPf3///xfn9/f3////D/ePf4f/7++H7+9vn////3d3dzdP////d3d3r9////93d',
  '1dXJ////3ev3693////d3d3D3+P//8Hv9/vB/8fz8/nz88f/9/f39/f39/fx5+fP5+fx/9Pl////////',
  '/9Xr1evV//////////////7+7rv+/v///f3dd/39///8/Mwz/Pz///v7u+77+///+vqqqvr6///5+Zlm',
  '+fn///j4iCL4+P//9/d33ff3///29maZ9vb///X1VVX19f//9PREEfT0///z8zPM8/P///LyIojy8v//',
  '8fERRPHx///w8AAA8PD//+/v///v7+677u7uu+7u7rvt7d137e3uu+zszDPs7O676+u77uvr7rvq6qqq',
  '6uruu+npmWbp6e676OiIIujo7rvn53fd5+fuu+bmZpnm5u675eVVVeXl7rvk5EQR5OTuu+PjM8zj4+67',
  '4uIiiOLi7rvh4RFE4eHuu+DgAADg4O6739///9/f3Xfe3u673t7dd93d3Xfd3d133NzMM9zc3Xfb27vu',
  '29vdd9raqqra2t132dmZZtnZ3XfY2Igi2Njdd9fXd93X19131tZmmdbW3XfV1VVV1dXdd9TURBHU1N13',
  '09MzzNPT3XfS0iKI0tLdd9HREUTR0d130NAAANDQ3XfPz///z8/MM87O7rvOzswzzc3dd83NzDPMzMwz',
  'zMzMM8vLu+7Ly8wzysqqqsrKzDPJyZlmycnMM8jIiCLIyMwzx8d33cfHzDPGxmaZxsbMM8XFVVXFxcwz',
  'xMREEcTEzDPDwzPMw8PMM8LCIojCwswzwcERRMHBzDPAwAAAwMDMM7+///+/v7vuvr7uu76+u+69vd13',
  'vb277ry8zDO8vLvuu7u77ru7u+66uqqqurq77rm5mWa5ubvuuLiIIri4u+63t3fdt7e77ra2Zpm2trvu',
  'tbVVVbW1u+60tEQRtLS77rOzM8yzs7vusrIiiLKyu+6xsRFEsbG77rCwAACwsLvur6///6+vqqquru67',
  'rq6qqq2t3XetraqqrKzMM6ysqqqrq7vuq6uqqqqqqqqqqqqqqamZZqmpqqqoqIgiqKiqqqend92np6qq',
  'pqZmmaamqqqlpVVVpaWqqqSkRBGkpKqqo6MzzKOjqqqioiKIoqKqqqGhEUShoaqqoKAAAKCgqqqfn///',
  'n5+ZZp6e7ruenplmnZ3dd52dmWacnMwznJyZZpubu+6bm5lmmpqqqpqamWaZmZlmmZmZZpiYiCKYmJlm',
  'l5d33ZeXmWaWlmaZlpaZZpWVVVWVlZlmlJREEZSUmWaTkzPMk5OZZpKSIoiSkplmkZERRJGRmWaQkAAA',
  'kJCZZo+P//+Pj4gijo7uu46OiCKNjd13jY2IIoyMzDOMjIgii4u77ouLiCKKiqqqioqIIomJmWaJiYgi',
  'iIiIIoiIiCKHh3fdh4eIIoaGZpmGhogihYVVVYWFiCKEhEQRhISIIoODM8yDg4gigoIiiIKCiCKBgRFE',
  'gYGIIoCAAACAgIgi////////d93+/u67/v533f393Xf9/Xfd/PzMM/z8d937+7vu+/t33fr6qqr6+nfd',
  '+fmZZvn5d934+Igi+Ph33ff3d93393fd9vZmmfb2d9319VVV9fV33fT0RBH09Hfd8/MzzPPzd93y8iKI',
  '8vJ33fHxEUTx8Xfd8PAAAPDwd93v7///7+9mme7u7rvu7maZ7e3dd+3tZpns7Mwz7Oxmmevru+7r62aZ',
  '6uqqqurqZpnp6Zlm6elmmejoiCLo6GaZ5+d33efnZpnm5maZ5uZmmeXlVVXl5WaZ5OREEeTkZpnj4zPM',
  '4+NmmeLiIoji4maZ4eERROHhZpng4AAA4OBmmd/f///f31VV3t7uu97eVVXd3d133d1VVdzczDPc3FVV',
  '29u77tvbVVXa2qqq2tpVVdnZmWbZ2VVV2NiIItjYVVXX13fd19dVVdbWZpnW1lVV1dVVVdXVVVXU1EQR',
  '1NRVVdPTM8zT01VV0tIiiNLSVVXR0RFE0dFVVdDQAADQ0FVVz8///8/PRBHOzu67zs5EEc3N3XfNzUQR',
  'zMzMM8zMRBHLy7vuy8tEEcrKqqrKykQRycmZZsnJRBHIyIgiyMhEEcfHd93Hx0QRxsZmmcbGRBHFxVVV',
  'xcVEEcTERBHExEQRw8MzzMPDRBHCwiKIwsJEEcHBEUTBwUQRwMAAAMDARBG/v///v78zzL6+7ru+vjPM',
  'vb3dd729M8y8vMwzvLwzzLu7u+67uzPMurqqqrq6M8y5uZlmubkzzLi4iCK4uDPMt7d33be3M8y2tmaZ',
  'trYzzLW1VVW1tTPMtLREEbS0M8yzszPMs7MzzLKyIoiysjPMsbERRLGxM8ywsAAAsLAzzK+v//+vryKI',
  'rq7uu66uIoitrd13ra0iiKyszDOsrCKIq6u77qurIoiqqqqqqqoiiKmpmWapqSKIqKiIIqioIoinp3fd',
  'p6ciiKamZpmmpiKIpaVVVaWlIoikpEQRpKQiiKOjM8yjoyKIoqIiiKKiIoihoRFEoaEiiKCgAACgoCKI',
  'n5///5+fEUSenu67np4RRJ2d3XednRFEnJzMM5ycEUSbm7vum5sRRJqaqqqamhFEmZmZZpmZEUSYmIgi',
  'mJgRRJeXd92XlxFElpZmmZaWEUSVlVVVlZURRJSURBGUlBFEk5MzzJOTEUSSkiKIkpIRRJGREUSRkRFE',
  'kJAAAJCQEUSPj///j48AAI6O7ruOjgAAjY3dd42NAACMjMwzjIwAAIuLu+6LiwAAioqqqoqKAACJiZlm',
  'iYkAAIiIiCKIiAAAh4d33YeHAACGhmaZhoYAAIWFVVWFhQAAhIREEYSEAACDgzPMg4MAAIKCIoiCggAA',
  'gYERRIGBAACAgAAAgIAAAA=='
]

//------------------------------------------------------------------------------
