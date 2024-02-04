
// TODO:
//  - coordinate information (cleanup)
//    - selection size, screen position, byte address
//
//  - shift constrain on axis (including byte-aligned selection move)
//
//  - fix pasteImage positioning problems (display resized larger than screen)
//    - parse image position information from text
//  - click outside of drawable area should be completely ignored
//    - selection stops updating when edge hit
//
//  ? change cursor when over resize area of "actual size" overlay
//  ? if actual size overlay larger than zoom, show bounding box
//
//  - brush, lasso, line, magnifier tools
//  ? erase tool
//  - move (hand) tool (left/right for mouse)
//  - tool tips for paint tools (description and key shortcut)
//
//  - tool cursors
//    - change select cursor if over current selection versus not
//    - change cursor over zoom overlay
//  ? text tool (Naja-specific), including paste
//
//  - save work so auto-update doesn't throw it away

import { IHostHooks, PixelData } from "./shared"
import { Point, Size, Rect, pointInRect, rectIsEmpty } from "./shared"
import { IMachineDisplay } from "./shared"
import { SCREEN_WIDTH, SCREEN_HEIGHT, HiresFrame, HiresTable } from "./shared"

// import { packNaja1, packNaja2 } from "./pack"
// import { textFromNaja, textFromPixels, imageFromText } from "./hex_parser"
import { textFromPixels, imageFromText } from "./copy_paste"

//------------------------------------------------------------------------------

// display coordinates are 560x384 (screen * 2)
// page coordinates are display coordinates * zoomScale

const DISPLAY_WIDTH = 560
const DISPLAY_HEIGHT = 384

// https://mrob.com/pub/xapple2/colors.html
// NOTE: these are in ABGR order
const colorPalette16 = [
  0xff000000,  //  0 - HIRES black
  0xff601ee3,  //  1 - red
  0xffbd4e60,  //  2 - dark blue
  0xfffd44ff,  //  3 - HIRES violet
  0xff60a300,  //  4 - dark green
  0xff9c9c9c,  //  5 - gray
  0xfffdcf14,  //  6 - HIRES blue
  0xffffc3d0,  //  7 - light blue
  0xff037260,  //  8 - dark brown
  0xff3c6aff,  //  9 - HIRES orange
  0xff9c9c9c,  //  A - gray
  0xffd0a0ff,  //  B - light magenta
  0xff3cf514,  //  C - HIRES green
  0xff8dddd0,  //  D - light brown (looks more yellow)
  0xffd0ff72,  //  E - light blue-green
  0xffffffff,  //  F - HIRES white
]

const BLACK_INDEX         = 0
const DARK_BLUE_INDEX     = 2
const PURPLE_INDEX        = 3
const BLUE_INDEX          = 6
const LIGHT_BLUE_INDEX    = 7
const DARK_BROWN_INDEX    = 8
const ORANGE_INDEX        = 9
const LIGHT_MAGENTA_INDEX = 11
const GREEN_INDEX         = 12
const LIGHT_BROWN_INDEX   = 13  // looks more yellow
const LIGHT_BLUE_GREEN_INDEX = 14
const WHITE_INDEX         = 15

const indexTable = [
  BLACK_INDEX,
  PURPLE_INDEX,
  GREEN_INDEX,
  BLUE_INDEX,
  ORANGE_INDEX,
  WHITE_INDEX
]


export class HiresDisplay {

  protected canvas: HTMLCanvasElement
  protected displayScale: number

  protected frame: HiresFrame
  protected visibleFrame?: HiresFrame

  protected indexBufferTV: number []
  protected indexBufferRGB: number []

  protected displayData?: ImageData
  protected displayArray?: Uint32Array

  protected useInterlaceLines = true

  public onToolChanged?: (toolIndex: Tool) => void
  public onToolRectChanged?: (toolRect: Rect) => void

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.displayScale = 2    // always 2 for HIRES, would be 1 for DHIRES

    this.frame = new HiresFrame()

    // NOTE: extra byte for tvMode extension overflow handling
    this.indexBufferTV = new Array(DISPLAY_WIDTH * DISPLAY_HEIGHT + 1)
    this.indexBufferTV.fill(0)
    this.indexBufferRGB = new Array(DISPLAY_WIDTH * DISPLAY_HEIGHT)
    this.indexBufferRGB.fill(0)

    let ctx = this.canvas.getContext('2d')
    if (ctx) {
      this.displayData = ctx.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT)
      this.displayArray = new Uint32Array(this.displayData.data.buffer)
    }
  }

  // NOTE: incoming hiresData is in Apple HIRES scan order
  setFrameMemory(hiresData: Uint8Array) {
    let offset = 0
    for (let y = 0; y < this.frame.height; y += 1) {
      for (let x = 0; x < this.frame.byteWidth; x += 1) {
        this.frame.bytes[offset + x] = hiresData[HiresTable[y] + x]
      }
      offset += this.frame.byteWidth
    }
    this.updateIndexBuffer()
  }

  // TODO: how to mark this virtual?
  protected updateBuffers(dirtyRect?: Rect) {
    if (!dirtyRect) {
      dirtyRect = { x: 0, y: 0, width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }
    }
    this.updateDisplayBuffer(dirtyRect)
    this.updateCanvas()
  }

  protected updateDisplayBuffer(dirtyRect: Rect) {
    if (!this.displayArray) {
      return
    }

    let srcOffset = dirtyRect.y * DISPLAY_WIDTH
    let dstOffset = dirtyRect.y * DISPLAY_WIDTH
    for (let y = dirtyRect.y; y < dirtyRect.y + dirtyRect.height; y += 1) {
      if (this.useInterlaceLines && (y & 1)) {
        for (let x = dirtyRect.x; x < dirtyRect.x + dirtyRect.width; x += 1) {
          this.displayArray[dstOffset + x] = 0xff000000
        }
      } else {
        for (let x = dirtyRect.x; x < dirtyRect.x + dirtyRect.width; x += 1) {
          let color = colorPalette16[this.indexBufferTV[srcOffset + x]]
          this.displayArray[dstOffset + x] = color
        }
      }
      srcOffset += DISPLAY_WIDTH
      dstOffset += DISPLAY_WIDTH
    }

    // NOTE: caller must do updateCanvas
  }

  // TODO: how to mark this virtual?
  protected updateCanvas() {
    if (this.displayData) {
      let ctx = this.canvas.getContext('2d')
      ctx?.putImageData(this.displayData, 0, 0)
    }
  }

  // build buffer of palette indexes using Apple2 memory
  protected updateIndexBuffer() {

    let minDirtyY = 999
    let maxDirtyY = -1
    let minDirtyX = 999
    let maxDirtyX = -1

    if (!this.visibleFrame) {
      this.visibleFrame = new HiresFrame()
      minDirtyY = 0
      maxDirtyY = this.visibleFrame.height - 1
      minDirtyX = 0
      maxDirtyX = this.visibleFrame.byteWidth - 1
    }

    let byteOffset = 0
    let outIndexRGB = 0
    let outIndexTV = 0

    for (let y = 0; y < this.frame.height; y += 1) {

      // update dirty bounds
      let linesDiffer = false
      for (let x = 0; x < this.frame.byteWidth; x += 1) {
        if (this.visibleFrame.bytes[byteOffset + x] != this.frame.bytes[byteOffset + x]) {
          this.visibleFrame.bytes[byteOffset + x] = this.frame.bytes[byteOffset + x]
          if (x < minDirtyX) {
            minDirtyX = x
          }
          if (x > maxDirtyX) {
            maxDirtyX = x
          }
          linesDiffer = true
        }
      }
      if (linesDiffer) {
        if (y < minDirtyY) {
          minDirtyY = y
        }
        if (y > maxDirtyY) {
          maxDirtyY = y
        }
      } else {
        // if nothing changed, skip line
        byteOffset += this.frame.byteWidth
        outIndexRGB += DISPLAY_WIDTH * 2
        outIndexTV += DISPLAY_WIDTH * 2
        continue
      }

      let bitParity = 0
      let curValue = 0
      let nextValue = this.frame.bytes[byteOffset]
      let bits = (nextValue & 0x7f) << 1

      // handle initial delay
      if (nextValue & 0x80) {
        this.indexBufferTV[outIndexTV] = BLACK_INDEX
        outIndexTV += 1
      }

      let nextColorTV = undefined
      let nextWhiteTV = WHITE_INDEX
      for (let x = 0; x < this.frame.byteWidth; x += 1) {

        curValue = nextValue
        let highBitIndex = ((curValue >> 7) << 1) + 1
        nextValue = x < this.frame.byteWidth - 1 ? this.frame.bytes[byteOffset + x + 1] : 0
        bits |= (nextValue & 0x7f) << 8

        for (let i = 0; i < 7; i += 1) {
          let bits3 = bits & 7
          let outValue: number
          let outValueTV: number
          if (bits3 == 0b010) {
            outValue = indexTable[highBitIndex + bitParity]
            if (nextColorTV) {
              outValueTV = nextColorTV
            } else {
              outValueTV = outValue
            }
          } else if (bits3 == 0b101) {
            outValue = BLACK_INDEX
            outValueTV = indexTable[highBitIndex + (bitParity ^ 1)]
          } else if (bits3 & 0b010) {
            outValue = WHITE_INDEX
            outValueTV = nextWhiteTV
          } else {
            outValue = BLACK_INDEX
            outValueTV = BLACK_INDEX
          }
          nextWhiteTV = WHITE_INDEX
          nextColorTV = undefined
          this.indexBufferRGB[outIndexRGB] = outValue
          this.indexBufferRGB[outIndexRGB + 1] = outValue
          outIndexRGB += 2
          this.indexBufferTV[outIndexTV] = outValueTV
          this.indexBufferTV[outIndexTV + 1] = outValueTV
          outIndexTV += 2
          bits >>= 1
          bitParity ^= 1
        }

        // check for change in delay
        if ((curValue ^ nextValue) & 0x80) {
          if (nextValue & 0x80) {
            let outValue = this.indexBufferTV[outIndexTV - 1]
            if ((curValue & 0b11100000) == 0b01000000) {
              if ((nextValue & 0b11000000) == 0b10000000) {
                if ((x & 1) == 0) {
                  // extend violet into light blue (7)
                  outValue = LIGHT_BLUE_INDEX
                } else {
                  // extend green into light brown (D)
                  outValue = LIGHT_BROWN_INDEX
                }
              }
            }
            this.indexBufferTV[outIndexTV - 2] = outValue
            this.indexBufferTV[outIndexTV - 1] = outValue
            this.indexBufferTV[outIndexTV] = outValue
            outIndexTV += 1
          } else {
            this.indexBufferTV[outIndexTV] = BLACK_INDEX
            outIndexTV -= 1
            let outValue: number
            let maskedPrev = curValue & 0b11100000
            let maskedCur = nextValue & 0b00000001
            if (maskedPrev == 0b11000000) {
              if (maskedCur == 0b00000000) {
                if ((x & 1) == 0) {
                  // cut off blue with black to produce dark blue (2)
                  outValue = DARK_BLUE_INDEX
                } else {
                  // cut off orange with black to produce dark brown (8)
                  outValue = DARK_BROWN_INDEX
                }
                this.indexBufferTV[outIndexTV - 1] = outValue
                continue
              } else if (maskedCur == 0b00000001) {
                if ((x & 1) == 0) {
                  // cut off blue with green to produce light blue-green (E)
                  outValue = LIGHT_BLUE_GREEN_INDEX
                } else {
                  // cut off orange with violet to produce light magenta (B)
                  outValue = LIGHT_MAGENTA_INDEX
                }
                this.indexBufferTV[outIndexTV - 1] = outValue
                nextWhiteTV = outValue
                continue
              }
            } else if (maskedPrev == 0b11100000) {
              if (maskedCur == 0b00000000) {
                if ((x & 1) == 0) {
                  // cut off white with black to produce light magenta (B)
                  outValue = LIGHT_MAGENTA_INDEX
                } else {
                  // cut off white with black to produce light blue-green (E)
                  outValue = LIGHT_BLUE_GREEN_INDEX
                }
                this.indexBufferTV[outIndexTV - 3] = outValue
                this.indexBufferTV[outIndexTV - 2] = outValue
                this.indexBufferTV[outIndexTV - 1] = outValue
                continue
              }
            } else if (maskedPrev == 0b10100000) {
              if (maskedCur == 0b00000001) {
                if ((x & 1) == 0) {
                  // cut off orange/black with green to produce bright green
                  // NOTE: experimentally, color looks more like brown/yellow,
                  //  maybe brighter, but this is close enough
                  outValue = LIGHT_BROWN_INDEX
                } else {
                  // cut off blue/black with violet to produce bright violet
                  // NOTE: experimentally, color looks more like light blue,
                  //  maybe brighter, but this is close enough
                  outValue = LIGHT_BLUE_INDEX
                }
                this.indexBufferTV[outIndexTV - 3] = outValue
                this.indexBufferTV[outIndexTV - 2] = outValue
                this.indexBufferTV[outIndexTV - 1] = outValue
                nextColorTV = outValue
                continue
              }
            }
          }
        }
      }

      for (let i = 0; i < DISPLAY_WIDTH; i += 1) {
        this.indexBufferRGB[outIndexRGB] = this.indexBufferRGB[outIndexRGB - DISPLAY_WIDTH]
        outIndexRGB += 1
        this.indexBufferTV[outIndexTV] = this.indexBufferTV[outIndexTV - DISPLAY_WIDTH]
        outIndexTV += 1
      }

      byteOffset += this.frame.byteWidth
    }

    if (minDirtyX <= maxDirtyX && minDirtyY <= maxDirtyY) {
      let dirtyRect = {
        x: minDirtyX * 7 * this.displayScale,
        y: minDirtyY * this.displayScale,
        width: (maxDirtyX - minDirtyX + 1) * 7 * this.displayScale,
        height: (maxDirtyY - minDirtyY + 1) * this.displayScale
      }

      // pad left and right to cover for cross-byte artifacts
      if (dirtyRect.x >= 7) {
        dirtyRect.x -= 7
        dirtyRect.width += 7
      }
      if (dirtyRect.x + dirtyRect.width + 7 <= DISPLAY_WIDTH) {
        dirtyRect.width += 7
      }

      this.updateBuffers(dirtyRect)
    }
  }
}

//------------------------------------------------------------------------------

const fillTable = [
  0x00,
  0x2a,
  0x55,
  0x7f,
  0x80,
  0xaa,
  0xd5,
  0xff,
]

export enum ModifierKeys {
  COMMAND = 1,
  OPTION  = 2,
  CONTROL = 4,
  SHIFT   = 8,
}

export function getModifierKeys(e: PointerEvent | KeyboardEvent): number {
  let modifiers = 0
  if (e.metaKey) {
    modifiers |= ModifierKeys.COMMAND
  }
  if (e.altKey) {
    modifiers |= ModifierKeys.OPTION
  }
  if (e.ctrlKey) {
    modifiers |= ModifierKeys.CONTROL
  }
  if (e.shiftKey) {
    modifiers |= ModifierKeys.SHIFT
  }
  return modifiers
}


class EdgeState {
  leftByte: number
  leftMask: number
  rightByte: number
  rightMask: number

  constructor(r: Rect) {
    this.leftByte = Math.floor(r.x / 7)
    this.leftMask = (((1 << (r.x % 7)) - 1) ^ 0x7f) | 0x80
    this.rightByte = Math.floor((r.x + r.width) / 7)
    this.rightMask = ((1 << ((r.x + r.width) % 7)) - 1) | 0x80
    if (this.rightMask == 0x80) {
      this.rightMask = 0xff
      this.rightByte -= 1
    }
    if (this.leftByte == this.rightByte) {
      this.leftMask &= this.rightMask
    }
  }
}


export enum Tool {
  Move,
  Select,
  Pencil,
  FillRect,
  FrameRect,
}

enum MouseMode {
  None,
  Tool,
  OverlayMove,
  OverlayResize,
}

export type UndoState = {
  frame: HiresFrame
  tool: Tool
  toolRect?: Rect
  selectBits?: PixelData
  selectBack?: PixelData
}

export class ZoomHiresDisplay extends HiresDisplay {

  private machineDisplay: IMachineDisplay
  private pageIndex: number

  private zoomData?: ImageData
  protected zoomArray?: Uint32Array

  protected overlayRect : Rect
  private overlayResizeRect : Rect
  private overlayStartRect : Rect
  private overlayPosition = 3

  protected zoomScale = 1
  protected totalScale: number

  protected pageSize: Size            // 280x192, or changed by subclass
  private scrollSize: Size            // pageSize * this.totalScale
  private windowRect: Rect            // canvas size within scrollSize

  private selectBits?: PixelData
  private selectBack?: HiresFrame

  private tool = Tool.Move
  private savedTool = Tool.Move       // valid between mouse down and mouse up
  private mouseMode = MouseMode.None  // valid between mouse down and mouse up
  private pencilColor = 0

  private backColor = 0x00
  private foreColor = 0x2A

  private canvasPt: Point = { x: 0, y: 0 }
  private startPt : Point = { x: 0, y: 0 }  // in screen pixel coordinates
  private currPt  : Point = { x: 0, y: 0 }  // in screen pixel coordinates
  private toolRect: Rect                    // in screen pixel coordinates

  private undoHistory: UndoState[] = []
  private undoCurrentIndex = 0
  private undoSavedIndex = 0
  private hostHooks?: IHostHooks

  private scrollTimerId?: NodeJS.Timeout

  private showGridLines = true
  private useTransparent = true

  constructor(canvas: HTMLCanvasElement, machineDisplay: IMachineDisplay) {

    super(canvas)

    this.machineDisplay = machineDisplay
    this.pageIndex = 0
    this.totalScale = this.displayScale * this.zoomScale

    this.pageSize = {
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT
    }
    this.scrollSize = {
      width: this.pageSize.width * this.totalScale,
      height: this.pageSize.height * this.totalScale
    }
    this.windowRect = {
      x: 0,
      y: 0,
      width: this.canvas.width,
      height: this.canvas.height
    }
    this.overlayRect = {
      x: 0,
      y: 0,
      width: this.pageSize.width * this.displayScale / 4,
      height: this.pageSize.height * this.displayScale / 4
    }
    this.overlayResizeRect = { x: 0, y: 0, width: 16, height: 16 }
    this.overlayStartRect = { x: 0, y: 0, width: 0, height: 0 }
    this.toolRect = { x: 0, y: 0, width: 0, height: 0 }

    this.updateWindowRect()
    this.updateOverlayRect()
  }

  setPageIndex(pageIndex: number) {
    this.pageIndex = pageIndex
  }

  // canvas coordinates are screen coordinates * displayScale

  private screenFromCanvasFloat(canvasPt: Point): Point {
    return this.screenFromCanvas(canvasPt, 0)
  }

  private screenFromCanvasFloor(canvasPt: Point): Point {
    return this.screenFromCanvas(canvasPt, 1)
  }

  private screenFromCanvasRound(canvasPt: Point): Point {
    return this.screenFromCanvas(canvasPt, 2)
  }

  private screenFromCanvas(canvasPt: Point, mode: number): Point {
    let screenPt: Point = {
      x: (canvasPt.x + this.windowRect.x) / this.totalScale,
      y: (canvasPt.y + this.windowRect.y) / this.totalScale
    }

    if (mode == 1) {
      screenPt.x = Math.floor(screenPt.x)
      screenPt.y = Math.floor(screenPt.y)
    } else if (mode == 2) {
      screenPt.x = Math.round(screenPt.x)
      screenPt.y = Math.round(screenPt.y)
    }

    if (mode == 1) {
      // in floor mode, clamp to screen bounds, exclusive
      if (screenPt.x >= this.pageSize.width) {
        screenPt.x = this.pageSize.width - 1
      }
      if (screenPt.y >= this.pageSize.height) {
        screenPt.y = this.pageSize.height - 1
      }
    } else {
      if (screenPt.x > this.pageSize.width) {
        screenPt.x = this.pageSize.width
      }
      if (screenPt.y > this.pageSize.height) {
        screenPt.y = this.pageSize.height
      }
    }

    if (screenPt.x < 0) {
      screenPt.x = 0
    }
    if (screenPt.y < 0) {
      screenPt.y = 0
    }
    return screenPt
  }

  private clipToPage(rect: Rect): Rect {
    let r = { ...rect }
    if (r.x < 0) {
      r.width += r.x
      r.x = 0
    }
    if (r.y < 0) {
      r.height += r.y
      r.y = 0
    }
    if (r.x + r.width > this.pageSize.width) {
      r.width = this.pageSize.width - r.x
    }
    if (r.y + r.height > this.pageSize.height) {
      r.height = this.pageSize.height - r.y
    }
    if (r.width < 0) {
      r.x = 0
      r.width = 0
    }
    if (r.height < 0) {
      r.y = 0
      r.height = 0
    }
    return r
  }

  protected updateWindowRect() {
    // clamp window to page in case canvas is too large for scale
    if (this.windowRect.width > this.scrollSize.width) {
      this.windowRect.width = this.scrollSize.width
    }
    if (this.windowRect.height > this.scrollSize.height) {
      this.windowRect.height = this.scrollSize.height
    }

    if (this.windowRect.x < 0) {
      this.windowRect.x = 0
    } else if (this.windowRect.x + this.windowRect.width > this.scrollSize.width) {
      this.windowRect.x = this.scrollSize.width - this.windowRect.width
    }

    if (this.windowRect.y < 0) {
      this.windowRect.y = 0
    } else if (this.windowRect.y + this.windowRect.height > this.scrollSize.height) {
      this.windowRect.y = this.scrollSize.height - this.windowRect.height
    }
  }

  resizeDisplay(newWidth: number, newHeight: number) {
    this.canvas.width = newWidth
    this.canvas.height = newHeight
    this.windowRect.width = this.canvas.width
    this.windowRect.height = this.canvas.height
    this.updateWindowRect()
    this.updateOverlayRect()
    this.updateCanvas()
    // prevent resize click/drag from also being treated as overlay resize
    this.mouseMode = MouseMode.None
  }

  setZoomScale(newZoomScale: number, canvasPt?: Point) {

    // compute this before totalScale changes
    let screenPt = canvasPt ? this.screenFromCanvasFloat(canvasPt) : {x:0, y:0}

    let oldZoomScale = this.zoomScale
    this.zoomScale = newZoomScale
    this.totalScale = this.displayScale * this.zoomScale

    this.scrollSize = {
      width: this.pageSize.width * this.totalScale,
      height: this.pageSize.height * this.totalScale
    }
    this.windowRect.x = Math.floor((screenPt.x * this.totalScale) - this.canvas.width / 2)
    this.windowRect.y = Math.floor((screenPt.y * this.totalScale) - this.canvas.height / 2)
    this.windowRect.width = this.canvas.width
    this.windowRect.height = this.canvas.height

    this.updateWindowRect()
    this.updateOverlayRect()

    if (newZoomScale != oldZoomScale) {
      this.zoomData = undefined
      this.zoomArray = undefined
      this.updateBuffers()
    } else {
      this.updateCanvas()
    }
  }

  scroll(deltaX: number, deltaY: number) {
    this.windowRect.x += deltaX
    this.windowRect.y += deltaY
    this.updateWindowRect()
    this.updateCanvas()
  }

  toggleGrid() {
    this.showGridLines = !this.showGridLines
    // update buffers because grid change causes color fill changes
    this.updateBuffers()
  }

  toggleTransparency() {
    this.useTransparent = !this.useTransparent
    if (this.selectBits) {
      this.moveSelection()
    }
  }

  toggleColor() {
    let offset = 0
    let color = this.foreColor
    let colorPhase: number
    if ((color & 0x7f) == 0 || (color & 0x7f) == 0x7f) {
      colorPhase = 0
    } else {
      colorPhase = 0x7f
    }
    for (let y = 0; y < this.frame.height; y += 1) {
      for (let x = 0; x < this.frame.byteWidth; x += 1) {
        this.frame.bytes[offset] ^= color
        color ^= colorPhase
        offset += 1
      }
    }
    this.updateToMemory()
  }

  setTool(tool: Tool) {
    if (tool != this.tool) {
      // clear currently active tool state

      this.dropSelectBits()
      this.updateCanvas()

      if (this.scrollTimerId) {
        clearTimeout(this.scrollTimerId)
        this.scrollTimerId = undefined
      }

      this.tool = tool
      if (this.onToolChanged) {
        this.onToolChanged(this.tool)
      }
    }
  }

  getTool(): Tool {
    return this.tool
  }

  setForeColor(colorIndex: number) {
    if (colorIndex < fillTable.length) {
      this.foreColor = fillTable[colorIndex]
    }
  }

  setBackColor(colorIndex: number) {
    if (colorIndex < fillTable.length) {
      this.backColor = fillTable[colorIndex]
    }
  }

  getRgbColorString(colorIndex: number): string {
    const remap = [
      BLACK_INDEX,
      GREEN_INDEX,
      PURPLE_INDEX,
      WHITE_INDEX,
      BLACK_INDEX,
      ORANGE_INDEX,
      BLUE_INDEX,
      WHITE_INDEX
    ]
    let value = colorPalette16[remap[colorIndex]]
    let color = ((value & 0x0000ff) << 16) + (value & 0x00ff00) + ((value & 0xff0000) >> 16)
    return "#" + color.toString(16).padStart(6, "0")
  }

  //------------------------------------
  // Undo/redo handling
  //------------------------------------

  public setHostHooks(hostHooks: IHostHooks) {
    this.hostHooks = hostHooks
  }

  private captureUndo(fullCapture = true) {
    // capture will invalidate those undos past the current, so delete them
    if (this.undoCurrentIndex < this.undoHistory.length) {
      this.undoHistory = this.undoHistory.slice(0, this.undoCurrentIndex)
      if (this.undoSavedIndex > this.undoCurrentIndex) {
        this.undoSavedIndex = -1
      }
    }

    let savedState: UndoState = {
      frame: new HiresFrame(this.selectBack ? this.selectBack : this.frame),
      tool: this.tool
    }
    if (this.tool == Tool.Select) {
      savedState.toolRect = {...this.toolRect}
      savedState.selectBits = this.selectBits
    }

    this.undoHistory.push(savedState)

    if (fullCapture) {
      this.undoCurrentIndex += 1

      if (this.hostHooks) {
        this.hostHooks.capturedUndo(this.undoCurrentIndex)
      }
    }
  }

  public undo() {
    if (this.undoCurrentIndex > 0) {
      // if currentIndex is at the end of history,
      //  need to capture changes on screen before undo them
      if (this.undoCurrentIndex == this.undoHistory.length) {
        this.captureUndo(false)
      }
      this.undoCurrentIndex -= 1
      this.applyUndoState()
    }
  }

  public redo() {
    if (this.undoCurrentIndex + 1 < this.undoHistory.length) {
      this.undoCurrentIndex += 1
      this.applyUndoState()
      // if redoing top/current frame, remove it
      if (this.undoCurrentIndex + 1 == this.undoHistory.length) {
        this.undoHistory = this.undoHistory.slice(0, this.undoHistory.length - 1)
      }
    }
  }

  public saveUndo() {
    this.undoSavedIndex = this.undoCurrentIndex
  }

  public revertUndo(index: number) {
    if (index >= 0 && index < this.undoHistory.length) {
      this.undoCurrentIndex = index
      this.undoSavedIndex = index
      this.applyUndoState()
    }
  }

  private applyUndoState() {
    const undoState = this.undoHistory[this.undoCurrentIndex]
    this.setTool(undoState.tool)
    if (undoState.toolRect) {
      this.toolRect = {...undoState.toolRect}
    } else {
      this.toolRect = { x: 0, y: 0, width: 0, height: 0 }
    }
    this.selectBits = undoState.selectBits
    this.toolRectChanged()
    this.frame.copyFrom(undoState.frame)
    if (this.selectBits) {
      this.selectBack = new HiresFrame(this.frame)
      this.drawImage(this.selectBits, this.toolRect)
    } else {
      this.selectBack = undefined
    }
    this.updateToMemory()
    this.updateCanvas()
  }

  //------------------------------------

  toolDown(canvasPt: Point, modifiers: number) {
    this.savedTool = this.tool
    this.canvasPt = canvasPt

    // check for click inside "actual size" display overlay
    if (this.zoomScale > 1) {
      if (pointInRect(this.canvasPt, this.overlayRect)) {
        this.startPt = this.canvasPt
        if (pointInRect(this.canvasPt, this.overlayResizeRect)) {
          this.mouseMode = MouseMode.OverlayResize
          this.overlayStartRect.x = this.overlayRect.x
          this.overlayStartRect.y = this.overlayRect.y
          this.overlayStartRect.width = this.overlayRect.width
          this.overlayStartRect.height = this.overlayRect.height
        } else {
          this.mouseMode = MouseMode.OverlayMove
        }
        return
      }
    }

    this.mouseMode = MouseMode.Tool
    if (this.tool == Tool.Select) {
      this.startPt = this.screenFromCanvasFloor(this.canvasPt)
      if (pointInRect(this.startPt, this.toolRect)) {
        // compute offset from cursor to top/left of selection
        this.startPt.x -= this.toolRect.x
        this.startPt.y -= this.toolRect.y
        this.liftSelectBits(modifiers)
        this.moveSelection()
        this.scrollProc(modifiers)
      } else {
        this.dropSelectBits()
        this.startPt = this.screenFromCanvasFloat(this.canvasPt)
        this.currPt = this.startPt
        this.rebuildSelectRect()
        this.updateCanvas()
        this.scrollProc(modifiers)
      }
    } else if (this.tool == Tool.FillRect || this.tool == Tool.FrameRect) {
      this.captureUndo()
      this.startPt = this.screenFromCanvasFloat(this.canvasPt)
      this.currPt = this.startPt
      this.rebuildToolRect()
      this.moveRectangle()
      this.scrollProc(modifiers)
    } else if (this.tool == Tool.Pencil) {
      this.captureUndo()
      this.startPt = this.screenFromCanvasFloor(this.canvasPt)
      this.pencilColor = this.togglePencilBit(this.startPt) ? 0 : 1
      this.scrollProc(modifiers)

      this.toolRect.x = this.startPt.x
      this.toolRect.y = this.startPt.y
      this.toolRect.width = 0
      this.toolRect.height = 0
      this.toolRectChanged()
    }
  }

  private liftSelectBits(modifiers: number) {
    if (this.selectBits) {
      this.captureUndo()
      // leave replicated selection
      if (modifiers & ModifierKeys.OPTION) {
        this.selectBack = new HiresFrame(this.frame)
      }
    } else {
      this.captureUndo()
      this.selectBits = this.captureRect(this.toolRect)
      if (!(modifiers & ModifierKeys.OPTION)) {
        this.fillRect(this.toolRect, this.backColor)
      }
      this.selectBack = new HiresFrame(this.frame)
    }
  }

  private dropSelectBits() {
    if (this.selectBits) {
      this.captureUndo()
      this.selectBits = undefined
      this.selectBack = undefined
    }
    this.clearToolRect()
  }

  toolMove(canvasPt: Point, modifiers: number) {
    this.canvasPt = canvasPt
    if (this.mouseMode == MouseMode.OverlayMove) {
      this.moveOverlay()
    } else if (this.mouseMode == MouseMode.OverlayResize) {
      this.resizeOverlay()
    } else if (this.mouseMode == MouseMode.Tool) {
      if (this.tool == Tool.Select) {
        if (this.selectBits) {
          // TODO: share this with ScrollProc
          this.currPt = this.screenFromCanvasFloor(this.canvasPt)
          let mod7 = this.toolRect.x % 7
          this.toolRect.x = this.currPt.x - this.startPt.x
          this.toolRect.y = this.currPt.y - this.startPt.y
          if (modifiers & ModifierKeys.SHIFT) {
            this.toolRect.x += mod7 - (this.toolRect.x % 7)
          }
          this.toolRectChanged()
          this.moveSelection()
        } else {
          this.currPt = this.screenFromCanvasFloat(this.canvasPt)
          this.rebuildSelectRect()
          this.updateCanvas()
        }
      } else if (this.tool == Tool.FillRect || this.tool == Tool.FrameRect) {
        this.currPt = this.screenFromCanvasFloat(this.canvasPt)
        this.rebuildToolRect()
        this.moveRectangle()
      } else if (this.tool == Tool.Pencil) {
        this.togglePencilBits()
      }
    }
  }

  toolArrow(direction: number, modifiers: number) {
    if (this.tool == Tool.Select) {
      this.liftSelectBits(modifiers)
      if (direction == 0) {
        this.toolRect.y -= 1
      } else if (direction == 1) {
        this.toolRect.x += (modifiers & ModifierKeys.SHIFT) ? 7 : 1
      } else if (direction == 2) {
        this.toolRect.y += 1
      } else if (direction == 3) {
        this.toolRect.x -= (modifiers & ModifierKeys.SHIFT) ? 7 : 1
      }
      this.moveSelection()
    }
  }

  toolUp(canvasPt: Point, modifiers: number) {
    if (this.tool == Tool.Select) {
      if (modifiers & ModifierKeys.CONTROL) {
        this.trimSelection()
      }
    }
    if (this.scrollTimerId) {
      clearTimeout(this.scrollTimerId)
      this.scrollTimerId = undefined
    }
    this.mouseMode = MouseMode.None
    this.tool = this.savedTool
    if (this.onToolChanged) {
      this.onToolChanged(this.tool)
    }
  }

  private togglePencilBits() {
    this.currPt = this.screenFromCanvasFloor(this.canvasPt)
    let dx = this.currPt.x - this.startPt.x
    let dy = this.currPt.y - this.startPt.y
    let delta = Math.max(Math.abs(dx), Math.abs(dy))
    if (delta > 1) {
      for (let d = 1; d < delta; d += 1) {
        let pt: Point = {
          x: Math.floor(this.startPt.x + dx * d / delta),
          y: Math.floor(this.startPt.y + dy * d / delta)
        }
        this.togglePencilBit(pt, this.pencilColor, false)
      }
    }
    this.togglePencilBit(this.currPt, this.pencilColor)
    this.startPt = this.currPt

    this.toolRect.x = this.startPt.x
    this.toolRect.y = this.startPt.y
    this.toolRect.width = 0
    this.toolRect.height = 0
    this.toolRectChanged()
  }

  private togglePencilBit(screenPt: Point, color?: number, update = true): number {
    let xdiv7 = Math.floor(screenPt.x / 7)
    let xmod7 = screenPt.x % 7
    let mask = 1 << xmod7
    let offset = screenPt.y * this.frame.byteWidth + xdiv7

    let oldValue = (this.frame.bytes[offset] & mask) ? 1 : 0
    if (color == undefined) {
      color = oldValue ^ 1
    }

    if (color == 1) {
      this.frame.bytes[offset] |= mask
    } else {
      this.frame.bytes[offset] &= ~mask
    }

    if (this.foreColor & 0x80) {
      this.frame.bytes[offset] |= 0x80
    } else {
      this.frame.bytes[offset] &= ~0x80
    }

    if (update) {
      this.updateToMemory()
    }

    return oldValue
  }

  private rebuildSelectRect() {
    this.rebuildToolRect(true)
  }

  private rebuildToolRect(isSelection: boolean = false) {
    this.toolRect.x = this.startPt.x
    this.toolRect.width = this.currPt.x - this.toolRect.x
    if (this.toolRect.width < 0) {
      this.toolRect.width = -this.toolRect.width
      this.toolRect.x = this.currPt.x
    }
    this.toolRect.y = this.startPt.y
    this.toolRect.height = this.currPt.y - this.toolRect.y
    if (this.toolRect.height < 0) {
      this.toolRect.height = -this.toolRect.height
      this.toolRect.y = this.currPt.y
    }

    this.toolRect.width += this.toolRect.x
    this.toolRect.height += this.toolRect.y
    if (isSelection) {
      this.toolRect.x = Math.round(this.toolRect.x)
      this.toolRect.y = Math.round(this.toolRect.y)
      this.toolRect.width = Math.round(this.toolRect.width) - this.toolRect.x
      this.toolRect.height = Math.round(this.toolRect.height) - this.toolRect.y
    } else {
      this.toolRect.x = Math.floor(this.toolRect.x)
      this.toolRect.y = Math.floor(this.toolRect.y)
      this.toolRect.width = Math.round(this.toolRect.width) - this.toolRect.x
      this.toolRect.height = Math.round(this.toolRect.height) - this.toolRect.y
    }

    if (!isSelection) {
      if (this.toolRect.width <= 0) {
        this.toolRect.width = 1
      }
      if (this.toolRect.height <= 0) {
        this.toolRect.height = 1
      }
    }

    this.toolRectChanged()
  }

  private scrollProc(modifiers: number) {
    let didScroll = false
    let scrollDelta = 16
    if (this.canvasPt.x <= scrollDelta) {
      this.windowRect.x -= scrollDelta
      didScroll = true
    } else if (this.canvasPt.x >= this.windowRect.width - scrollDelta) {
      this.windowRect.x += scrollDelta
      didScroll = true
    }
    if (this.canvasPt.y <= scrollDelta) {
      this.windowRect.y -= scrollDelta
      didScroll = true
    } else if (this.canvasPt.y >= this.windowRect.height - scrollDelta) {
      this.windowRect.y += scrollDelta
      didScroll = true
    }
    if (didScroll) {
      this.updateWindowRect()
      if (this.tool == Tool.Select) {
        if (this.selectBits) {
          // TODO: share this with toolMove
          this.currPt = this.screenFromCanvasFloor(this.canvasPt)
          let mod7 = this.toolRect.x % 7
          this.toolRect.x = this.currPt.x - this.startPt.x
          this.toolRect.y = this.currPt.y - this.startPt.y
          if (modifiers & ModifierKeys.SHIFT) {
            this.toolRect.x += mod7 - (this.toolRect.x % 7)
          }
          this.toolRectChanged()
          this.moveSelection()
        } else {
          this.currPt = this.screenFromCanvasFloat(this.canvasPt)
          this.rebuildSelectRect()
          this.updateCanvas()
        }
      } else if (this.tool == Tool.Pencil) {
        this.togglePencilBits()
      } else if (this.tool == Tool.FillRect || this.tool == Tool.FrameRect) {
        this.currPt = this.screenFromCanvasFloat(this.canvasPt)
        this.rebuildToolRect()
        this.moveRectangle()
      }
    }
    this.scrollTimerId = setTimeout(() => { this.scrollProc(modifiers) }, 50)
  }

  cutSelection(compress: boolean) {
    this.cutCopyClearSelection(true, true, compress)
  }

  copySelection(compress: boolean) {
    this.cutCopyClearSelection(true, false, compress)
  }

  clearSelection() {
    this.cutCopyClearSelection(false, true, false)
  }

  private cutCopyClearSelection(copy: boolean, clear: boolean, compress: boolean) {
    if (this.tool == Tool.Select) {
      if (!rectIsEmpty(this.toolRect)) {
        let pixelData: PixelData | undefined
        if (this.selectBits) {
          if (copy) {
            pixelData = this.selectBits
          }
          if (clear) {
            this.captureUndo()
            if (this.selectBack) {
              this.frame.copyFrom(this.selectBack)
            }
            this.selectBits = undefined
            this.selectBack = undefined
            this.clearToolRect()
            this.moveSelection()
          }
        } else {
          if (copy) {
            let r = this.toolRect
            if (rectIsEmpty(r)) {
              r = { x: 0, y: 0, width: this.pageSize.width, height: this.pageSize.height }
            }
            pixelData = this.captureRect(r)
          }
          if (clear) {
            this.captureUndo()
            this.fillRect(this.toolRect, this.backColor)
            this.clearToolRect()
            this.updateToMemory()
          }
        }

        if (pixelData) {
          let imageText: string
          // if (compress) {
          //   // let byteData = packNaja1(pixelData)
          //   let byteData = packNaja2(pixelData)
          //   imageText = textFromNaja(byteData)
          // } else {
            imageText = textFromPixels(pixelData)
          // }
          navigator.clipboard.writeText(imageText).then(() => {})
        }
      }
    }
  }

  pasteSelection(clipText: string, canvasPt?: Point) {
    // TODO: possibly update cursor
    // TODO: support pasting text as characters
    let screenPt = canvasPt ? this.screenFromCanvasFloat(canvasPt) : canvasPt
    let image = imageFromText(clipText)
    if (image) {
      this.pasteImage(image, screenPt)
      // TODO: may need to update cursor to match change to select tool
    }
  }

  flipSelection(horizontal: boolean, vertical: boolean) {
    if (horizontal || vertical) {
      if (this.tool == Tool.Select) {
        this.captureUndo()
        if (!this.selectBits) {
          this.selectBits = this.captureRect(this.toolRect)
          this.selectBack = new HiresFrame(this.frame)
        }
        if (horizontal) {
          this.selectBits = this.flipImageHorizontal(this.selectBits)
        }
        if (vertical) {
          this.selectBits = this.flipImageVertical(this.selectBits)
        }
        this.moveSelection()
        this.updateCanvas()
      }
    }
  }

  selectAll(trim: boolean) {
    let r: Rect = { x: 0, y: 0, width: this.pageSize.width, height: this.pageSize.height }
    this.setSelection(r, trim)
  }

  setSelection(rect: Rect, trim: boolean = false) {
    if (this.selectBits) {
      this.dropSelectBits()
      this.moveSelection()
    }
    this.setTool(Tool.Select)
    this.toolRect = rect
    this.toolRectChanged()
    if (trim) {
      this.trimSelection()
    }
    this.updateCanvas()
  }

  selectNone() {
    this.clearToolRect()
    this.updateCanvas()
  }

  trimSelection() {
    if (rectIsEmpty(this.toolRect) || this.selectBits) {
      return
    }

    let color = this.backColor
    let colorPhase: number
    if ((color & 0x7f) == 0 || (color & 0x7f) == 0x7f) {
      colorPhase = 0
    } else {
      colorPhase = 0x7f
    }

    let cr = this.clipToPage(this.toolRect)
    let edges = new EdgeState(cr)
    if (edges.leftByte & 1) {
      color ^= colorPhase
    }

    // trim top
    let offset = cr.y * this.frame.byteWidth
    while (cr.height > 0) {
      let trimLine = true
      let c = color
      // check left edge
      if (((this.frame.bytes[offset + edges.leftByte] ^ c) & edges.leftMask) != 0) {
        trimLine = false
      }
      c ^= colorPhase
      if (trimLine) {
        for (let x = edges.leftByte + 1; x <= edges.rightByte - 1; x += 1) {
          if (this.frame.bytes[offset + x] != c) {
            trimLine = false
            break
          }
          c ^= colorPhase
        }
      }
      // check right edge
      if (trimLine && edges.leftByte != edges.rightByte) {
        if (((this.frame.bytes[offset + edges.rightByte] ^ c) & edges.rightMask) != 0) {
          trimLine = false
        }
      }
      if (!trimLine) {
        break
      }
      cr.y += 1
      cr.height -= 1
      offset += this.frame.byteWidth
    }

    // trim bottom
    offset = (cr.y + cr.height - 1) * this.frame.byteWidth
    while (cr.height > 0) {
      let trimLine = true
      let c = color
      // check left edge
      if (((this.frame.bytes[offset + edges.leftByte] ^ c) & edges.leftMask) != 0) {
        trimLine = false
      }
      c ^= colorPhase
      if (trimLine) {
        for (let x = edges.leftByte + 1; x <= edges.rightByte - 1; x += 1) {
          if (this.frame.bytes[offset + x] != c) {
            trimLine = false
            break
          }
          c ^= colorPhase
        }
      }
      // check right edge
      if (trimLine && edges.leftByte != edges.rightByte) {
        if (((this.frame.bytes[offset + edges.rightByte] ^ c) & edges.rightMask) != 0) {
          trimLine = false
        }
      }
      if (!trimLine) {
        break
      }
      cr.height -= 1
      offset -= this.frame.byteWidth
    }

    // trim left bits
    if (edges.leftMask != 0xff) {
      let trimColumn = true
      let offset = cr.y * this.frame.byteWidth + edges.leftByte
      for (let y = 0; y < cr.height; y += 1) {
        if (((this.frame.bytes[offset] ^ color) & edges.leftMask) != 0) {
          trimColumn = false
          break
        }
        offset += this.frame.byteWidth
      }
      if (trimColumn) {
        edges.leftByte += 1
        edges.leftMask = 0xff
        color ^= colorPhase
        let xmod7 = 7 - (cr.x % 7)
        cr.x += xmod7
        cr.width -= xmod7
      }
    }

    // trim left bytes
    if (edges.leftMask == 0xff) {
      while (edges.leftByte <= edges.rightByte) {
        let trimColumn = true
        let offset = cr.y * this.frame.byteWidth + edges.leftByte
        for (let y = 0; y < cr.height; y += 1) {
          if (this.frame.bytes[offset] != color) {
            trimColumn = false
            break
          }
          offset += this.frame.byteWidth
        }
        if (!trimColumn) {
          break
        }
        edges.leftByte += 1
        cr.x += 7
        cr.width -= 7
        color ^= colorPhase
      }
    }

    // right edge color
    let rcolor = color
    if ((edges.leftByte ^ edges.rightByte) & 1) {
      rcolor ^= colorPhase
    }

    // trim right bits
    if (edges.rightMask != 0xff && edges.leftByte <= edges.rightByte) {
      let trimColumn = true
      let offset = cr.y * this.frame.byteWidth + edges.rightByte
      for (let y = 0; y < cr.height; y += 1) {
        if (((this.frame.bytes[offset] ^ rcolor) & edges.rightMask) != 0) {
          trimColumn = false
          break
        }
        offset += this.frame.byteWidth
      }
      if (trimColumn) {
        edges.rightByte -= 1
        edges.rightMask = 0xff
        color ^= colorPhase
        let xmod7 = ((cr.x + cr.width) % 7)
        cr.width -= xmod7
      }
    }

    // trim right bytes
    if (edges.rightMask == 0xff) {
      while (edges.leftByte <= edges.rightByte) {
        let trimColumn = true
        let offset = cr.y * this.frame.byteWidth + edges.rightByte
        for (let y = 0; y < cr.height; y += 1) {
          if (this.frame.bytes[offset] != rcolor) {
            trimColumn = false
            break
          }
          offset += this.frame.byteWidth
        }
        if (!trimColumn) {
          break
        }
        edges.rightByte -= 1
        rcolor ^= colorPhase
        cr.width -= 7
      }
    }

    this.toolRect = cr
    this.toolRectChanged()
    this.updateCanvas()
  }

  private moveSelection() {
    if (this.selectBack && this.selectBits) {
      this.frame.copyFrom(this.selectBack)
      this.drawImage(this.selectBits, this.toolRect)
    }
    this.updateToMemory()

    // force a selection redraw in case the selection contents
    //  exactly match existing screen contents (empty dirty rectangle)
    this.updateCanvas()
  }

  private clearToolRect() {
    this.toolRect = { x: 0, y: 0, width: 0, height: 0 }
    this.toolRectChanged()
  }

  private toolRectChanged() {
    if (this.onToolRectChanged) {
      this.onToolRectChanged(this.toolRect)
    }
  }

  pasteImage(image: PixelData, screenPt?: Point) {

    // drop any previous selection
    if (this.selectBits) {
      this.dropSelectBits()
    } else {
      this.captureUndo()
    }

    let screenRect = {
      x: Math.floor(this.windowRect.x / this.totalScale),
      y: Math.floor(this.windowRect.y / this.totalScale),
      width: Math.ceil((this.windowRect.x + this.windowRect.width) / this.totalScale),
      height: Math.ceil((this.windowRect.y + this.windowRect.height) / this.totalScale)
    }
    screenRect.width -= screenRect.x
    screenRect.height -= screenRect.y

    // TODO: there are problems with pasting into screen
    //  when display resized to larger than screen

    this.setTool(Tool.Select)
    this.selectBits = image
    this.selectBack = new HiresFrame(this.frame)
    let x: number
    let y: number
    if (screenPt && pointInRect(screenPt, screenRect)) {
      x = Math.floor(screenPt.x - image.bounds.width / 2)
      y = Math.floor(screenPt.y - image.bounds.height / 2)
    } else if (pointInRect(image.bounds, screenRect)) {
      x = image.bounds.x
      y = image.bounds.y
    } else {
      x = Math.floor((screenRect.x - image.bounds.width) / 2)
      y = Math.floor((screenRect.y - image.bounds.height) / 2)
    }

    if (x < screenRect.x) {
      x = screenRect.x
    }
    if (y < screenRect.y) {
      y = screenRect.y
    }

    // force matching x % 7 alignment
    x = x - (x % 7) + (image.bounds.x % 7)
    if (x < screenRect.x) {
      x += 7
    }

    this.toolRect.x = x
    this.toolRect.y = y
    this.toolRect.width = image.bounds.width
    this.toolRect.height = image.bounds.height
    this.toolRectChanged()
    this.moveSelection()
  }

  private moveRectangle() {
    this.frame.copyFrom(this.undoHistory[this.undoCurrentIndex - 1].frame)
    if (this.tool == Tool.FillRect || this.toolRect.width < 4 || this.toolRect.height < 2) {
      this.fillRect(this.toolRect, this.foreColor)
    } else {
      let r = { x: this.toolRect.x, y: this.toolRect.y, width: this.toolRect.width, height: 1 }
      this.fillRect(r, this.foreColor)
      r.y = this.toolRect.y + this.toolRect.height - 1
      this.fillRect(r, this.foreColor)
      r.y = this.toolRect.y
      r.width = 2
      r.height = this.toolRect.height
      this.fillRect(r, this.foreColor)
      r.x = this.toolRect.x + this.toolRect.width - 2
      this.fillRect(r, this.foreColor)
    }
    this.updateToMemory()
  }

  // TODO: should this update machine memory instead of caller?
  private fillRect(r: Rect, color: number) {
    let cr = this.clipToPage(r)
    if(rectIsEmpty(cr)) {
      return
    }

    let edges = new EdgeState(cr)

    let colorPhase: number
    if ((color & 0x7f) == 0 || (color & 0x7f) == 0x7f) {
      colorPhase = 0
    } else {
      colorPhase = 0x7f
    }
    if (edges.leftByte & 1) {
      color ^= colorPhase
    }

    let offset = cr.y * this.frame.byteWidth
    for (let y = 0; y < cr.height; y += 1) {
      let c = color
      let value = this.frame.bytes[offset + edges.leftByte]
      this.frame.bytes[offset + edges.leftByte] = ((value ^ c) & edges.leftMask) ^ value
      c ^= colorPhase
      for (let x = edges.leftByte + 1; x < edges.rightByte; x += 1) {
        this.frame.bytes[offset + x] = c
        c ^= colorPhase
      }
      if (edges.leftByte < edges.rightByte) {
        value = this.frame.bytes[offset + edges.rightByte]
        this.frame.bytes[offset + edges.rightByte] = ((value ^ c) & edges.rightMask) ^ value
      }
      offset += this.frame.byteWidth
    }
  }

  private drawImage(image: PixelData, pt: Point) {
    let r = { x: pt.x, y: pt.y, width: image.bounds.width, height: image.bounds.height }
    let cr = this.clipToPage(r)
    let edges = new EdgeState(cr)

    let byteWidth = image.getByteWidth()
    let srcOffset = (cr.y - r.y) * byteWidth + (edges.leftByte -  Math.trunc(r.x / 7))

    let lshift = 0
    let rshift = (r.x % 7) - (image.bounds.x % 7)
    if (rshift < -6) {
      rshift += 7
      srcOffset += 1
    }
    if (rshift < 0) {
      lshift = -rshift
      rshift = 0
    }

    let dstOffset = cr.y * this.frame.byteWidth
    for (let y = 0; y < cr.height; y += 1) {
      for (let x = 0; x < edges.rightByte - edges.leftByte + 1; x += 1) {
        let srcValue = image.dataBytes[srcOffset + x]
        let dstValue

        if (rshift > 0) {
          srcValue = ((srcValue << rshift) & 0x7F) | (srcValue & 0x80)
          srcValue |= ((image.dataBytes[srcOffset + x - 1] ?? 0) & 0x7F) >> (7 - rshift)
        } else if (lshift > 0) {
          srcValue = ((srcValue & 0x7F) >> lshift) | (srcValue & 0x80)
          srcValue |= ((image.dataBytes[srcOffset + x + 1] ?? 0) << (7 - lshift)) & 0x7F
        }

        if (x == 0) {
          if (srcValue != 0 || !this.useTransparent) {
            dstValue = this.frame.bytes[dstOffset + edges.leftByte]
            this.frame.bytes[dstOffset + edges.leftByte] = ((dstValue ^ srcValue) & edges.leftMask) ^ dstValue
          }
        } else if (x < edges.rightByte - edges.leftByte) {
          if (srcValue != 0 || !this.useTransparent) {
            this.frame.bytes[dstOffset + edges.leftByte + x] = srcValue
          }
        } else if (edges.leftByte < edges.rightByte) {
          if (srcValue != 0 || !this.useTransparent) {
            dstValue = this.frame.bytes[dstOffset + edges.rightByte]
            this.frame.bytes[dstOffset + edges.rightByte] = ((dstValue ^ srcValue) & edges.rightMask) ^ dstValue
          }
        }
      }

      srcOffset += byteWidth
      dstOffset += this.frame.byteWidth
    }
  }

  private flipImageHorizontal(inImage: PixelData): PixelData {
    const outImage = new PixelData()
    outImage.bounds = {...inImage.bounds}
    outImage.dataBytes = new Uint8Array(inImage.dataBytes.length)
    const byteWidth = outImage.getByteWidth()
    let offset = 0
    for (let y = 0; y < outImage.bounds.height; y += 1) {
      for (let x = 0; x < byteWidth; x += 1) {
        let inValue = inImage.dataBytes[offset + x]
        let outValue = (inValue >= 0x80) ? 1 : 0
        for (let b = 0; b < 7; b += 1) {
          outValue = (outValue << 1) | (inValue & 1)
          inValue >>= 1
        }
        outImage.dataBytes[offset + byteWidth - 1 - x] = outValue
      }
      offset += byteWidth
    }
    const leftModX = outImage.bounds.x % 7
    const rightModX = (7 - ((outImage.bounds.x + outImage.bounds.width) % 7)) % 7
    outImage.bounds.x += rightModX - leftModX
    return outImage
  }

  private flipImageVertical(inImage: PixelData): PixelData {
    const outImage = new PixelData()
    outImage.bounds = {...inImage.bounds}
    outImage.dataBytes = new Uint8Array(inImage.dataBytes.length)
    const byteWidth = outImage.getByteWidth()
    let topOffset = 0
    let botOffset = (outImage.bounds.height - 1) * byteWidth
    for (let y = 0; y < outImage.bounds.height; y += 1) {
      for (let x = 0; x < byteWidth; x += 1) {
        const value = inImage.dataBytes[topOffset + x]
        outImage.dataBytes[botOffset + x] = value
      }
      topOffset += byteWidth
      botOffset -= byteWidth
    }
    return outImage
  }

  private captureRect(r: Rect): PixelData {
    let cr = this.clipToPage(r)
    let edges = new EdgeState(cr)

    let image = new PixelData()
    image.dataBytes = []
    image.bounds = { ...cr }

    let offset = cr.y * this.frame.byteWidth
    for (let y = 0; y < cr.height; y += 1) {
      for (let x = edges.leftByte; x <= edges.rightByte; x += 1) {
        let value = this.frame.bytes[offset + x]
        if (x == edges.leftByte) {
          value &= edges.leftMask
        }
        if (x == edges.rightByte) {
          value &= edges.rightMask
        }
        image.dataBytes.push(value)
      }
      offset += this.frame.byteWidth
    }

    return image
  }

  //----------------------------------------------------------------------------
  //  Zoom overlay (actual size) support
  //----------------------------------------------------------------------------

  protected updateOverlayRect() {
    this.overlayRect.x = 0
    this.overlayRect.y = 0
    if (this.zoomScale > 1) {
      if (this.overlayPosition & 1) {
        this.overlayRect.x = this.canvas.width - this.overlayRect.width
        this.overlayResizeRect.x = this.overlayRect.x
      } else {
        this.overlayResizeRect.x = this.overlayRect.width - this.overlayResizeRect.width
      }
      if (this.overlayPosition & 2) {
        this.overlayRect.y = this.canvas.height - this.overlayRect.height
        this.overlayResizeRect.y = this.overlayRect.y
      } else {
        this.overlayResizeRect.y = this.overlayRect.height - this.overlayResizeRect.height
      }
    }
  }

  private moveOverlay() {
    let overlayChanged = false
    let dx = this.canvasPt.x - this.startPt.x
    let dy = this.canvasPt.y - this.startPt.y
    if (Math.abs(dx) > 32) {
      if (dx < 0) {
        if (this.overlayPosition & 1) {
          this.overlayPosition &= ~1
          overlayChanged = true
        }
      } else {
        if (!(this.overlayPosition & 1)) {
          this.overlayPosition |= 1
          overlayChanged = true
        }
      }
    }
    if (Math.abs(dy) > 32) {
      if (dy < 0) {
        if (this.overlayPosition & 2) {
          this.overlayPosition &= ~2
          overlayChanged = true
        }
      } else {
        if (!(this.overlayPosition & 2)) {
          this.overlayPosition |= 2
          overlayChanged = true
        }
      }
    }
    if (overlayChanged) {
      this.updateOverlayRect()
      this.updateCanvas()
    }
  }

  private resizeOverlay() {
    let dx = Math.floor(this.canvasPt.x - this.startPt.x)
    let dy = Math.floor(this.canvasPt.y - this.startPt.y)

    if (this.overlayPosition & 1) {
      this.overlayRect.x = this.overlayStartRect.x + dx
      this.overlayRect.width = this.overlayStartRect.width - dx
    } else {
      this.overlayRect.width = this.overlayStartRect.width + dx
    }

    if (this.overlayRect.width < this.pageSize.width / 2) {
      this.overlayRect.width = this.pageSize.width / 2
      if (this.overlayPosition & 1) {
        this.overlayRect.x = this.overlayStartRect.x + this.overlayStartRect.width - this.overlayRect.width
      }
    } else if (this.overlayRect.width > DISPLAY_WIDTH) {
      this.overlayRect.width = DISPLAY_WIDTH
      if (this.overlayPosition & 1) {
        this.overlayRect.x = this.overlayStartRect.x + this.overlayStartRect.width - this.overlayRect.width
      }
    }

    if (this.overlayPosition & 2) {
      this.overlayRect.y = this.overlayStartRect.y + dy
      this.overlayRect.height = this.overlayStartRect.height - dy
    } else {
      this.overlayRect.height = this.overlayStartRect.height + dy
    }

    if (this.overlayRect.height < this.pageSize.height / 2) {
      this.overlayRect.height = this.pageSize.height / 2
      if (this.overlayPosition & 2) {
        this.overlayRect.y = this.overlayStartRect.y + this.overlayStartRect.height - this.overlayRect.height
      }
    } else if (this.overlayRect.height > DISPLAY_HEIGHT) {
      this.overlayRect.height = DISPLAY_HEIGHT
      if (this.overlayPosition & 2) {
        this.overlayRect.y = this.overlayStartRect.y + this.overlayStartRect.height - this.overlayRect.height
      }
    }

    if (this.overlayPosition & 1) {
      this.overlayResizeRect.x = this.overlayRect.x
    } else {
      this.overlayResizeRect.x = this.overlayRect.width - this.overlayResizeRect.width
    }
    if (this.overlayPosition & 2) {
      this.overlayResizeRect.y = this.overlayRect.y
    } else {
      this.overlayResizeRect.y = this.overlayRect.height - this.overlayResizeRect.height
    }

    this.updateCanvas()
  }

  //----------------------------------------------------------------------------
  //  Updates buffers/canvas
  //----------------------------------------------------------------------------

  updateFromMemory() {
    this.machineDisplay.getDisplayMemory(this.frame, this.pageIndex)
    this.updateIndexBuffer()
  }

  updateToMemory() {
    this.machineDisplay.setDisplayMemory(this.frame, this.pageIndex)
    this.updateIndexBuffer()
  }

  protected updateBuffers(dirtyRect?: Rect) {

    if (!dirtyRect) {
      dirtyRect = { x: 0, y: 0, width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }
    }

    if (!this.zoomData && this.zoomScale > 1) {
      let ctx = this.canvas.getContext('2d')
      if (ctx) {
        this.zoomData = ctx.createImageData(
          DISPLAY_WIDTH * this.zoomScale,
          DISPLAY_HEIGHT * this.zoomScale)
        this.zoomArray = new Uint32Array(this.zoomData.data.buffer)
      }
    }

    this.updateDisplayBuffer(dirtyRect)
    if (this.zoomArray) {
      this.updateZoomBuffer(dirtyRect)
    }

    this.updateCanvas()
  }

  updateZoomBuffer(dirtyRect: Rect) {
    if (!this.zoomArray) {
      return
    }

    let srcOffset = 0
    let dstOffset = 0
    let tvMode = !this.showGridLines
    let dstPixelStride = DISPLAY_WIDTH * this.zoomScale
    for (let y = 0; y < DISPLAY_HEIGHT; y += 1) {

      if (y < dirtyRect.y || y >= dirtyRect.y + dirtyRect.height) {
        srcOffset += DISPLAY_WIDTH
        dstOffset += dstPixelStride * this.zoomScale
        continue
      }

      for (let x = dirtyRect.x; x < dirtyRect.x + dirtyRect.width; x += 1) {
        let index = tvMode ? this.indexBufferTV[srcOffset + x] : this.indexBufferRGB[srcOffset + x]
        let color = colorPalette16[index]
        for (let s = 0; s < this.zoomScale; s += 1) {
          this.zoomArray[dstOffset + x * this.zoomScale + s] = color
        }
      }
      srcOffset += DISPLAY_WIDTH
      dstOffset += dstPixelStride

      let repCount = this.zoomScale - 1
      let drawHGridLine = false
      if (this.showGridLines) {
        if (((y + 1) % this.displayScale) == 0) {
          drawHGridLine = ((y + 1) % this.displayScale) == 0
          repCount -= 1
          if (repCount < 0) {
            dstOffset -= dstPixelStride
          }
        }
      }
      if (repCount > 0) {
        let soffset = dstOffset - dstPixelStride
        for (let s = 0; s < repCount; s += 1) {
          for (let x = 0; x < dstPixelStride; x += 1) {
            this.zoomArray[dstOffset + x] = this.zoomArray[soffset + x]
          }
          dstOffset += dstPixelStride
        }
      }
      if (drawHGridLine) {
        for (let x = 0; x < dstPixelStride; x += 1) {
          this.zoomArray[dstOffset + x] = 0xff000000
        }
        dstOffset += dstPixelStride
      }
    }

    if (this.showGridLines) {
      this.drawGridLines(dstPixelStride)
    }

    // NOTE: caller must do updateCanvas
  }

  protected drawGridLines(dstPixelStride: number) {
    if (!this.zoomArray) {
      return
    }

    let gridX7 = 0
    for (let x = 0; x < this.pageSize.width; x += 1) {
      let gridColor = gridX7 == 0 ? 0xff007f00 : 0xff000000
      if ((gridX7 -= 1) < 0) {
        gridX7 = 6
      }
      let dstOffset = 0
      for (let y = 0; y < DISPLAY_HEIGHT * this.zoomScale; y += 1) {
        this.zoomArray[dstOffset + x * this.totalScale] = gridColor
        dstOffset += dstPixelStride
      }
    }
  }

  protected updateCanvas() {
    let ctx = this.canvas.getContext('2d')
    if (!ctx) {
      return
    }

    // fill background behind actual display
    ctx.fillStyle = '#444'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)

    const imageData = this.zoomScale == 1 ? this.displayData : this.zoomData
    if (!imageData) {
      return
    }

    ctx.putImageData(
      imageData,
      -this.windowRect.x, -this.windowRect.y,
      this.windowRect.x, this.windowRect.y,
      this.windowRect.width, this.windowRect.height)
      // this.canvas.width, this.canvas.height)

    // draw selection rectangle, if any
    if (this.tool == Tool.Select && !rectIsEmpty(this.toolRect)) {
      ctx.strokeStyle = "red"
      ctx.setLineDash([5, 3])
      ctx.beginPath()
      ctx.strokeRect(
        this.toolRect.x * this.totalScale - this.windowRect.x + 0.5,
        this.toolRect.y * this.totalScale - this.windowRect.y + 0.5,
        this.toolRect.width * this.totalScale - 1,
        this.toolRect.height * this.totalScale - 1)
      ctx.setLineDash([])
    }

    // draw the "actual size" overlay, if zoomed
    if (this.zoomScale > 1) {

      // window scroll position, clamped to canvas bounds
      let wx = Math.floor(this.windowRect.x / this.zoomScale)
      if (wx + this.overlayRect.width > DISPLAY_WIDTH) {
        wx = DISPLAY_WIDTH - this.overlayRect.width
      }
      let wy = Math.floor(this.windowRect.y / this.zoomScale)
      if (wy + this.overlayRect.height > DISPLAY_HEIGHT) {
        wy = DISPLAY_HEIGHT - this.overlayRect.height
      }

      // draw display pixels
      if (this.displayData) {
        ctx.putImageData(this.displayData,
          this.overlayRect.x - wx,
          this.overlayRect.y - wy,
          wx, wy,
          this.overlayRect.width, this.overlayRect.height)
      }
      ctx.strokeStyle = "white"
      ctx.beginPath()
      ctx.strokeRect(
        this.overlayRect.x - 0.5,
        this.overlayRect.y - 0.5,
        this.overlayRect.width + 1,
        this.overlayRect.height + 1)

      // draw selection in overlay
      if (this.tool == Tool.Select && !rectIsEmpty(this.toolRect)) {
        ctx.save()
        ctx.rect(this.overlayRect.x, this.overlayRect.y, this.overlayRect.width, this.overlayRect.height)
        ctx.clip()
        ctx.strokeStyle = "red"
        ctx.setLineDash([5, 3])
        ctx.beginPath()
        ctx.strokeRect(
          this.overlayRect.x + this.toolRect.x * this.displayScale - wx + 0.5,
          this.overlayRect.y + this.toolRect.y * this.displayScale - wy + 0.5,
          this.toolRect.width * this.displayScale - 1,
          this.toolRect.height * this.displayScale - 1)
        ctx.restore()
      }
    }
  }

  //----------------------------------------------------------------------------
}
