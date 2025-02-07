
//  * undo tracking wrong in RPW A2
//    - undo back to saved version out of sync

// Features
//  - multiple brushes
//  - multiple line thicknesses
//  - constrain lines to 15 degree increments
//  - fill patterns (for Game walls)
//  - text editing
//    - text box with word-wrap
//    - insertion point/selection
//    - cut/copy/paste
//    - multiple fonts, scaling
//    - auto-scroll in zoom
//  - polygons, curves, etc.
//  - smart copy/paste
//    - to/from .png, w/dithering
//    - convert hires <-> dhires

// Maybe
//  ? flash text insertion point
//  ? animate marquee/lasso selection
//  ? clip crosshairs to zoom actual size box
//  ? use gimp icons
//    ? stop using border box for selected tool
//    ? hover hilite
//  ? "detents" at byte boundaries on contrained selection drag
//  ? limit selection pad to bounds of screen

// Generalizing
//  - display mode decoupled from paint display
//    - progressive update to support vaporlock
//      - maybe tied to dirty rect mechanism
//    - mixed text and graphics
//  - palettes
//    - edit/select palettes
//  - layers/sprites?
//    - 2600 background vs sprites
//    - per-layer undo history
//    - compositing between layers
//    ? mask editing for Game monsters
//    ? show background layer/image for tracing purposes

import { IHostHooks } from "../shared/types"
import { Point, Size, Rect, pointInRect, rectIsEmpty, PixelData } from "../shared/types"
import { IMachineDisplay } from "../shared/types"
import { DisplayFormat, Bitmap } from "./format"
import { Tool, Cursor, ToolCursors } from "./tools"
import { Polygon, FloodFill, drawMaskEdges, drawEllipse } from "./graphics"
import { textFromPixels, imageFromText } from "./copy_paste"

import { Text40Format, Text80Format, Font } from "./text"
import { LoresFormat, DoubleLoresFormat } from "./lores"
import { HiresFormat, DoubleHiresFormat } from "./hires"

// TODO: this should eventually become part of the machine
//  or something else platform specific
export const formatMap = new Map<string, DisplayFormat>([
  ["text40", new Text40Format()],
  ["text80", new Text80Format()],
  ["lores",  new LoresFormat()],
  ["dlores", new DoubleLoresFormat()],
  ["hires",  new HiresFormat()],
  ["dhires", new DoubleHiresFormat()]
])

//==============================================================================
//#region ScreenDisplay
//==============================================================================

export class ScreenDisplay {

  protected canvas: HTMLCanvasElement

  // abstraction of all display format-specific information
  public format: DisplayFormat

  // scaling from frame pixels to visible display
  // TODO: use this.format directly?
  protected pixelScale: Point

  // size of display after pixel scaling (frameSize * pixelScale)
  // TODO: use this.format directly?
  protected displaySize: Size

  protected frame: Bitmap
  protected visibleFrame?: Bitmap

  protected colorBufferTV: Uint32Array
  protected colorBufferRGB: Uint32Array
  protected altMode: number = 1

  protected displayData?: ImageData
  protected displayArray?: Uint32Array

  // TODO: figure out if this should be used anymore
  protected showInterlaceLines = false

  public onToolChanged?: (oldTool: Tool, newTool: Tool, modifiers: number) => void
  public onToolRectChanged?: () => void
  public onColorChanged?: (oldColor: number, newColor: number, isBack: boolean) => void

  constructor(formatName: string, canvas: HTMLCanvasElement) {
    this.format = formatMap.get(formatName)!
    this.canvas = canvas

    this.pixelScale = this.format.pixelScale

    const frameSize = this.format.frameSize
    this.displaySize = {
      width: frameSize.width * this.pixelScale.x,
      height: frameSize.height * this.pixelScale.y
    }

    this.canvas.width = this.format.displaySize.width
    this.canvas.height = this.format.displaySize.height

    this.frame = this.format.createFrameBitmap()
    const buffers = this.format.createColorBuffers()
    this.colorBufferTV = buffers.main
    this.colorBufferRGB = buffers.alt

    const ctx = this.canvas.getContext('2d')
    if (ctx) {
      this.displayData = ctx.createImageData(this.displaySize.width, this.displaySize.height)
      this.displayArray = new Uint32Array(this.displayData.data.buffer)
    }
  }

  setFrameMemory(pixelData: PixelData) {
    this.frame.decode(pixelData)
    this.updateFrame()
  }

  protected updateFrame() {
    let minDirtyY = 9999
    let maxDirtyY = -1
    let minDirtyX = 9999
    let maxDirtyX = -1

    if (!this.visibleFrame) {
      this.visibleFrame = this.format.createFrameBitmap()
      minDirtyY = 0
      maxDirtyY = this.visibleFrame.height - 1
      minDirtyX = 0
      maxDirtyX = this.visibleFrame.width - 1
    }

    // scan frame for changes
    let offset = 0
    for (let y = 0; y < this.frame.height; y += 1) {
      let linesDiffer = false
      for (let x = 0; x < this.frame.width; x += 1) {
        if (this.visibleFrame.data[offset + x] != this.frame.data[offset + x]) {
          this.visibleFrame.data[offset + x] = this.frame.data[offset + x]
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
      }
      offset += this.frame.width
    }

    if (minDirtyX <= maxDirtyX && minDirtyY <= maxDirtyY) {

      // convert frame dirty bounds into display dirtyRect
      let displayDirtyRect = {
        x: minDirtyX,
        y: minDirtyY,
        width: (maxDirtyX - minDirtyX + 1),
        height: (maxDirtyY - minDirtyY + 1)
      }
      this.frame.alignDirtyRect(displayDirtyRect)
      displayDirtyRect.x *= this.pixelScale.x
      displayDirtyRect.y *= this.pixelScale.y
      displayDirtyRect.width *= this.pixelScale.x
      displayDirtyRect.height *= this.pixelScale.y
      this.updateBuffers(displayDirtyRect)
    }
  }

  protected updateBuffers(displayDirtyRect?: Rect) {
    if (!displayDirtyRect) {
      displayDirtyRect = { x: 0, y: 0, ...this.displaySize }
    }
    this.updateDisplayBuffer(displayDirtyRect)
    this.updateCanvas()
  }

  protected updateDisplayBuffer(displayDirtyRect: Rect) {

    if (!this.displayArray) {
      return
    }

    // NOTE: color buffer dimensions are displayWidth by displayHeight / 2 (line double)

    // expand frame data into color buffers
    const frameTop = Math.floor(displayDirtyRect.y / this.pixelScale.y)
    const frameBot = Math.ceil((displayDirtyRect.y + displayDirtyRect.height) / this.pixelScale.y)
    this.format.colorize(this.frame, frameTop, frameBot, this.altMode, this.colorBufferTV, this.colorBufferRGB)

    // line double color buffer into displayArray
    const colorTop = Math.floor(displayDirtyRect.y / 2)
    const colorBot = Math.ceil((displayDirtyRect.y + displayDirtyRect.height) / 2)
    this.format.lineDouble(this.colorBufferTV, colorTop, colorBot, this.displayArray, this.showInterlaceLines)

    // NOTE: caller must do updateCanvas
  }

  protected updateCanvas() {
    if (this.displayData) {
      const ctx = this.canvas.getContext('2d')
      ctx?.putImageData(this.displayData, 0, 0)
    }
  }
}

//#endregion
//==============================================================================
//#region ZoomDisplay
//==============================================================================

class ZoomDisplay extends ScreenDisplay {

  private machineDisplay: IMachineDisplay
  private pageIndex: number

  private zoomData?: ImageData
  protected zoomArray?: Uint32Array

  protected overlayRect : Rect
  protected overlayResizeRect : Rect
  protected overlayStartRect : Rect
  protected overlayPosition = 3

  protected zoomLevel = 0
  public readonly zoomMaxLevel = 7    // inclusive
  protected zoomScale = 1
  protected totalScale: Point         // zoomScale * aspectScale

  protected frameSize: Size           // frame pixels, or changed by subclass
  private scrollSize: Size            // pageSize * this.totalScale (displaySize)
  protected windowRect: Rect          // canvas size within scrollSize

  constructor(formatName: string, canvas: HTMLCanvasElement, machineDisplay: IMachineDisplay) {

    super(formatName, canvas)

    this.machineDisplay = machineDisplay
    this.pageIndex = 0

    this.totalScale = {
      x: this.pixelScale.x * this.zoomScale,
      y: this.pixelScale.y * this.zoomScale
    }

    // frame pixels
    this.frameSize = {
      width: this.displaySize.width / this.pixelScale.x,
      height: this.displaySize.height / this.pixelScale.y
    }

    // frame pixels scaled by display aspectScale then zoomScale
    this.scrollSize = {
      width: this.frameSize.width * this.totalScale.x,
      height: this.frameSize.height * this.totalScale.y
    }

    // canvas-sized view into scroll area
    this.windowRect = {
      x: 0,
      y: 0,
      width: this.canvas.width,
      height: this.canvas.height
    }

    this.overlayRect = {
      x: 0,
      y: 0,
      width: this.frameSize.width * this.pixelScale.x / 4,
      height: this.frameSize.height * this.pixelScale.y / 4
    }
    this.overlayResizeRect = { x: 0, y: 0, width: 16, height: 16 }
    this.overlayStartRect = { x: 0, y: 0, width: 0, height: 0 }

    this.updateWindowRect()
    this.updateOverlayRect()
  }

  setPageIndex(pageIndex: number) {
    this.pageIndex = pageIndex
  }

  protected displayFromCanvasPt(canvasPt: Point): Point {
    return {
      x: canvasPt.x + this.windowRect.x,
      y: canvasPt.y + this.windowRect.y
    }
  }

  protected canvasFromDisplayPt(displayPt: Point): Point {
    return {
      x: displayPt.x - this.windowRect.x,
      y: displayPt.y - this.windowRect.y
    }
  }

  protected frameFromDisplayRoundClip(displayPt: Point): Point {
    return this.frameFromDisplay(displayPt, "round", true)
  }

  protected frameFromDisplayRoundNoClip(displayPt: Point): Point {
    return this.frameFromDisplay(displayPt, "round", false)
  }

  protected frameFromDisplayFloorClip(displayPt: Point): Point {
    return this.frameFromDisplay(displayPt, "floor", true)
  }

  protected frameFromDisplayFloorNoClip(displayPt: Point): Point {
    return this.frameFromDisplay(displayPt, "floor", false)
  }

  protected frameFromDisplay(dipslayPt: Point, mode: string, clip: boolean): Point {
    let framePt: Point = {
      x: dipslayPt.x / this.totalScale.x,
      y: dipslayPt.y / this.totalScale.y
    }
    this.roundAndClipFramePt(framePt, mode, clip)
    return framePt
  }

  private roundAndClipFramePt(framePt: Point, mode: string, clip: boolean) {
    if (mode == "floor") {
      framePt.x = Math.floor(framePt.x)
      framePt.y = Math.floor(framePt.y)
    } else if (mode == "ceil") {
      framePt.x = Math.ceil(framePt.x)
      framePt.y = Math.ceil(framePt.y)
    } else if (mode == "round") {
      framePt.x = Math.round(framePt.x)
      framePt.y = Math.round(framePt.y)
    }

    if (clip) {
      if (mode == "floor") {
        // in floor mode, clamp to frame bounds, exclusive
        if (framePt.x >= this.frameSize.width) {
          framePt.x = this.frameSize.width - 1
        }
        if (framePt.y >= this.frameSize.height) {
          framePt.y = this.frameSize.height - 1
        }
      } else {
        if (framePt.x > this.frameSize.width) {
          framePt.x = this.frameSize.width
        }
        if (framePt.y > this.frameSize.height) {
          framePt.y = this.frameSize.height
        }
      }

      if (framePt.x < 0) {
        framePt.x = 0
      }
      if (framePt.y < 0) {
        framePt.y = 0
      }
    }
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

  public resizeDisplay(newWidth: number, newHeight: number) {
    this.canvas.width = newWidth
    this.canvas.height = newHeight
    this.windowRect.width = this.canvas.width
    this.windowRect.height = this.canvas.height
    this.updateWindowRect()
    this.updateOverlayRect()
    this.updateCanvas()
  }

  setZoomLevel(newZoomLevel: number, canvasPt?: Point) {

    // compute this before totalScale changes
    const framePt = canvasPt ? this.frameFromDisplayRoundClip(this.displayFromCanvasPt(canvasPt)) : {x:0, y:0}

    let oldZoomScale = this.zoomScale
    this.zoomLevel = newZoomLevel
    this.zoomScale = Math.min(newZoomLevel, this.zoomMaxLevel) * 2 + 1
    this.totalScale.x = this.pixelScale.x * this.zoomScale
    this.totalScale.y = this.pixelScale.y * this.zoomScale

    this.scrollSize = {
      width: this.frameSize.width * this.totalScale.x,
      height: this.frameSize.height * this.totalScale.y
    }
    this.windowRect.x = Math.floor((framePt.x * this.totalScale.x) - this.canvas.width / 2)
    this.windowRect.y = Math.floor((framePt.y * this.totalScale.y) - this.canvas.height / 2)
    this.windowRect.width = this.canvas.width
    this.windowRect.height = this.canvas.height

    this.updateWindowRect()
    this.updateOverlayRect()

    if (this.zoomScale != oldZoomScale) {
      this.zoomData = undefined
      this.zoomArray = undefined
      this.updateBuffers()
    } else {
      this.updateCanvas()
    }
  }

  scroll(canvasPt: Point, delta: Point, modifiers: number) {
    if (modifiers & ModifierKeys.COMMAND) {
      if (delta.y != 0) {
        let newZoomLevel
        if (delta.y > 0) {
          newZoomLevel = Math.max(this.zoomLevel - 1, 0)
        } else {
          newZoomLevel = Math.min(this.zoomLevel + 1, this.zoomMaxLevel)
        }
        if (newZoomLevel != this.zoomLevel) {
          this.setZoomLevel(newZoomLevel, canvasPt)
        }
      }
    } else {
      this.windowRect.x += delta.x
      this.windowRect.y += delta.y
      this.updateWindowRect()
      this.updateCanvas()
    }
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

  protected moveOverlay(dx: number, dy: number) {
    let overlayChanged = false
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

  protected resizeOverlay(dx: number, dy: number) {
    if (this.overlayPosition & 1) {
      this.overlayRect.x = this.overlayStartRect.x + dx
      this.overlayRect.width = this.overlayStartRect.width - dx
    } else {
      this.overlayRect.width = this.overlayStartRect.width + dx
    }

    if (this.overlayRect.width < this.frameSize.width / 2) {
      this.overlayRect.width = this.frameSize.width / 2
      if (this.overlayPosition & 1) {
        this.overlayRect.x = this.overlayStartRect.x + this.overlayStartRect.width - this.overlayRect.width
      }
    } else if (this.overlayRect.width > this.displaySize.width) {
      this.overlayRect.width = this.displaySize.width
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

    if (this.overlayRect.height < this.frameSize.height / 2) {
      this.overlayRect.height = this.frameSize.height / 2
      if (this.overlayPosition & 2) {
        this.overlayRect.y = this.overlayStartRect.y + this.overlayStartRect.height - this.overlayRect.height
      }
    } else if (this.overlayRect.height > this.displaySize.height) {
      this.overlayRect.height = this.displaySize.height
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
    const pixelData = this.format.createFramePixelData()
    this.machineDisplay.getDisplayMemory(pixelData, this.pageIndex)
    this.frame.decode(pixelData)
    this.updateFrame()
  }

  updateToMemory() {
    const pixelData = this.frame.encode()
    this.machineDisplay.setDisplayMemory(pixelData, this.pageIndex)
    this.updateFrame()
  }

  protected updateBuffers(displayDirtyRect?: Rect) {

    if (!displayDirtyRect) {
      displayDirtyRect = { x: 0, y: 0, width: this.displaySize.width, height: this.displaySize.height }
    }

    if (!this.zoomData && this.zoomScale > 1) {
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        this.zoomData = ctx.createImageData(
          this.displaySize.width * this.zoomScale,
          this.displaySize.height * this.zoomScale)
        this.zoomArray = new Uint32Array(this.zoomData.data.buffer)
      }
    }

    this.updateDisplayBuffer(displayDirtyRect)
    if (this.zoomArray) {
      this.updateZoomBuffer(displayDirtyRect)
    }

    this.updateCanvas()
  }

  updateZoomBuffer(displayDirtyRect: Rect) {
    if (!this.zoomArray) {
      return
    }

    const tvMode = (this.altMode == 0)
    const dstPixelStride = this.displaySize.width * this.zoomScale
    let dstOffset = displayDirtyRect.y * dstPixelStride * this.zoomScale
    for (let y = displayDirtyRect.y; y < displayDirtyRect.y + this.displaySize.height; y += 1) {

      const colorOffset = Math.floor(y / 2) * this.displaySize.width
      for (let x = displayDirtyRect.x; x < displayDirtyRect.x + displayDirtyRect.width; x += 1) {
        const value = tvMode ? this.colorBufferTV[colorOffset + x] : this.colorBufferRGB[colorOffset + x]
        for (let s = 0; s < this.zoomScale; s += 1) {
          this.zoomArray[dstOffset + x * this.zoomScale + s] = value
        }
      }
      dstOffset += dstPixelStride

      let repCount = this.zoomScale - 1
      let drawHGridLine = false
      if (this.altMode != 0) {
        if (((y + 1) % this.pixelScale.y) == 0) {
          drawHGridLine = ((y + 1) % this.pixelScale.y) == 0
          repCount -= 1
          if (repCount < 0) {
            dstOffset -= dstPixelStride
          }
        }
      }
      if (repCount > 0) {
        const soffset = dstOffset - dstPixelStride
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

    if (this.altMode != 0) {
      this.drawGridLines(dstPixelStride)
    }

    // NOTE: caller must do updateCanvas
  }

  protected drawGridLines(dstPixelStride: number) {
    if (!this.zoomArray) {
      return
    }

    let gridX = 0
    for (let x = 0; x < this.frameSize.width; x += 1) {
      let gridColor = gridX == 0 ? 0xff007f00 : 0xff000000
      if ((gridX -= 1) < 0) {
        gridX = this.format.alignment.x - 1
      }
      let dstOffset = 0
      for (let y = 0; y < this.displaySize.height * this.zoomScale; y += 1) {
        this.zoomArray[dstOffset + x * this.totalScale.x + 0] = gridColor
        if (gridColor == 0xff007f00 && this.zoomScale > 2) {
          this.zoomArray[dstOffset + x * this.totalScale.x - 1] = gridColor
          this.zoomArray[dstOffset + x * this.totalScale.x + 1] = gridColor
        }
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

    this.updateCanvasDisplay(ctx)

    // draw the "actual size" overlay, if zoomed
    if (this.zoomScale > 1) {
      // window scroll position, clamped to canvas bounds
      let wx = Math.floor(this.windowRect.x / this.zoomScale)
      if (wx + this.overlayRect.width > this.displaySize.width) {
        wx = this.displaySize.width - this.overlayRect.width
      }
      let wy = Math.floor(this.windowRect.y / this.zoomScale)
      if (wy + this.overlayRect.height > this.displaySize.height) {
        wy = this.displaySize.height - this.overlayRect.height
      }

      this.updateCanvasOverlay(ctx, wx, wy)
    }
  }

  protected updateCanvasDisplay(ctx: CanvasRenderingContext2D) {
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
  }

  protected updateCanvasOverlay(ctx: CanvasRenderingContext2D, wx: number, wy: number) {
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
  }
}

//#endregion
//==============================================================================
//#region PaintDisplay
//==============================================================================

export enum ModifierKeys {
  COMMAND = 1,
  OPTION  = 2,
  CONTROL = 4,
  SHIFT   = 8,
}

export function getModifierKeys(e: MouseEvent | KeyboardEvent): number {
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

// type of mouse movement while it's down
enum MouseMode {
  None,
  Tool,
  Grab,
  OverlayMove,
  OverlayResize,
}

enum ConstrainMode {
  None,
  Horizontal,
  Vertical
}

export type UndoState = {
  frame: Bitmap
  tool: Tool
  toolRect?: Rect
  selectBits?: Bitmap
  selectMask?: Bitmap
  selectBack?: Bitmap
  editText?: string
  editFont?: Font
  editColor?: number
}

export type CoordinateInfo = {
  start?: Point
  end?: Point
  size?: Size
}

export class PaintDisplay extends ZoomDisplay {

  private selectBits?: Bitmap
  private selectMask?: Bitmap
  private selectBack?: Bitmap

  private editText?: string
  private editFont?: Font

  private tool = Tool.None

  // valid between toolDown and toolUp
  private savedTool?: Tool
  private mouseMode = MouseMode.None
  private constrainMode?: ConstrainMode
  private dragFromCenter = false
  private brushMask?: Bitmap
  private pencilColor: boolean = false

  private backColor = 0
  private foreColor = 1

  private displayStartPt : Point = { x: 0, y: 0 }   // canvasPt + windowRect
  private displayCurrPt  : Point = { x: 0, y: 0 }   // canvasPt + windowRect
  private frameStartPt : Point = { x: 0, y: 0 }
  private frameCurrPt  : Point = { x: 0, y: 0 }
  private toolRect: Rect = { x: 0, y: 0, width: 0, height: 0 } // in frame pixel coordinates
  private toolPoints: Point[] = []
  private coordInfo: CoordinateInfo = {}
  private handStartPt: Point = { x: 0, y: 0 }       // canvasPt

  private undoHistory: UndoState[] = []
  private undoCurrentIndex = 0
  private undoSavedIndex = 0
  private hostHooks?: IHostHooks

  private scrollTimerId?: NodeJS.Timeout

  private useTransparent = false

  constructor(formatName: string, canvas: HTMLCanvasElement, machineDisplay: IMachineDisplay) {
    super(formatName, canvas, machineDisplay)
  }

  public resizeDisplay(newWidth: number, newHeight: number) {
    super.resizeDisplay(newWidth, newHeight)
    // prevent resize click/drag from also being treated as overlay resize
    this.mouseMode = MouseMode.None
  }

  protected updateCanvasDisplay(ctx: CanvasRenderingContext2D) {
    super.updateCanvasDisplay(ctx)

    // draw selection, if any
    if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
      const scale = this.totalScale
      const offset = {
        x: -this.windowRect.x + 0.5,
        y: -this.windowRect.y + 0.5
      }
      ctx.save()
      this.strokeSelection(ctx, scale, offset)
      ctx.restore()
    }
  }

  protected updateCanvasOverlay(ctx: CanvasRenderingContext2D, wx: number, wy: number) {
    super.updateCanvasOverlay(ctx, wx, wy)

    // draw selection in overlay
    if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
      const scale = this.pixelScale
      const offset = {
        x: this.overlayRect.x - wx + 0.5,
        y: this.overlayRect.y - wy + 0.5
      }
      ctx.save()
      ctx.rect(this.overlayRect.x, this.overlayRect.y, this.overlayRect.width, this.overlayRect.height)
      ctx.clip()
      this.strokeSelection(ctx, scale, offset)
      ctx.restore()
    }
  }

  private strokeSelection(ctx: CanvasRenderingContext2D, scale: Point, offset: Point) {
    ctx.strokeStyle = "red"
    ctx.setLineDash([5, 3])
    ctx.beginPath()
    if (this.tool == Tool.Select) {
      if (!rectIsEmpty(this.toolRect)) {
        ctx.strokeRect(
          this.toolRect.x * scale.x + offset.x,
          this.toolRect.y * scale.y + offset.y,
          this.toolRect.width * scale.x - 1,
          this.toolRect.height * scale.y - 1)
      }
    } else {
      if (this.selectMask) {
        offset.x += this.toolRect.x * scale.x
        offset.y += this.toolRect.y * scale.y
        drawMaskEdges(ctx, this.selectMask, scale, offset)
      } else {
        let first = true
        for (let point of this.toolPoints) {
          const x = point.x * scale.x + offset.x
          const y = point.y * scale.y + offset.y
          if (first) {
            ctx.moveTo(x, y)
            first = false
          } else {
            ctx.lineTo(x, y)
          }
        }
      }
      ctx.stroke()
    }
    // ctx.setLineDash([])
  }

  toggleGrid() {
    this.altMode = (this.altMode + 1) % (this.format.altModes + 1)
    // update buffers because grid change causes color fill changes
    this.updateBuffers()
  }

  toggleTransparency() {
    this.useTransparent = !this.useTransparent
    if (this.selectBits) {
      this.moveSelection()
    }
  }

  setTool(tool: Tool, modifiers: number = 0, doubleClick = false) {

    if (tool != this.tool) {

      const canvasPt = this.canvasFromDisplayPt(this.displayCurrPt)

      const toolWasDown = this.mouseMode == MouseMode.Tool
      if (toolWasDown) {
        // if tool currently down, force it up and synthesize down for new tool
        this.toolUp(canvasPt, modifiers)
      }

      // clear currently active tool state

      this.dropSelection()
      this.updateCanvas()

      if (this.scrollTimerId) {
        clearTimeout(this.scrollTimerId)
        this.scrollTimerId = undefined
      }

      const prevTool = this.tool
      this.tool = tool
      if (this.onToolChanged) {
        this.onToolChanged(prevTool, this.tool, modifiers)
      }

      if (toolWasDown) {
        this.toolDown(canvasPt, modifiers)
      }
    }

    if (doubleClick) {
      if (this.tool == Tool.Select) {
        const trimSelection = (modifiers & ModifierKeys.COMMAND) != 0
        this.selectAll(trimSelection)
      } else if (this.tool == Tool.Lasso) {
        this.selectAllLasso()
      } else if (this.tool == Tool.Eraser) {
        this.captureUndo()
        this.frame.fillRect(this.frame.bounds, this.backColor)
        this.updateToMemory()
        this.setTool(Tool.Pencil, modifiers)
      }
    }
  }

  getTool(): Tool {
    return this.tool
  }

  setForeColor(colorIndex: number) {
    if (colorIndex < this.format.colorCount) {
      const prevColor = this.foreColor
      this.foreColor = colorIndex
      if (this.onColorChanged) {
        this.onColorChanged(prevColor, this.foreColor, false)
      }
      if (this.tool == Tool.Text && this.editText) {
        this.drawText()
      }
    }
  }

  getForeColor(): number {
    return this.foreColor
  }

  setBackColor(colorIndex: number) {
    if (colorIndex < this.format.colorCount) {
      const prevColor = this.backColor
      this.backColor = colorIndex
      if (this.onColorChanged) {
        this.onColorChanged(prevColor, this.backColor, true)
      }
    }
  }

  getBackColor(): number {
    return this.backColor
  }

  getRgbColorString(colorIndex: number): string {
    const value = this.format.getColorValueRgb(colorIndex)
    const color = ((value & 0x0000ff) << 16) + (value & 0x00ff00) + ((value & 0xff0000) >> 16)
    return "#" + color.toString(16).padStart(6, "0")
  }

  //------------------------------------
  // Undo/redo handling
  //------------------------------------

  public setHostHooks(hostHooks?: IHostHooks) {
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
      frame: this.selectBack?.duplicate() ?? this.frame.duplicate(),
      tool: this.tool
    }
    if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
      savedState.toolRect = { ...this.toolRect }
      savedState.selectBits = this.selectBits
      savedState.selectMask = this.selectMask
    } else if (this.tool == Tool.Text) {
      savedState.toolRect = { ...this.toolRect }
      savedState.editText = this.editText
      savedState.editFont = this.editFont
      savedState.editColor = this.foreColor
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
      this.setToolRect(undoState.toolRect)
    } else {
      this.setToolRect({ x: 0, y: 0, width: 0, height: 0 })
    }
    this.selectBits = undoState.selectBits
    this.selectMask = undoState.selectMask
    this.editText = undoState.editText
    this.editFont = undoState.editFont
    this.frame.copyFrom(undoState.frame)
    if (this.selectBits) {
      this.selectBack = this.frame.duplicate()
      this.frame.drawBitmap(this.selectBits, this.toolRect, this.selectMask)
    } else {
      this.selectBack = undefined
    }
    if (undoState.editColor !== undefined) {
      // NOTE: this will also call drawText
      this.setForeColor(undoState.editColor)
    }
    this.updateToMemory()
    this.updateCanvas()
  }

  //------------------------------------

  public chooseCursor(canvasPt: Point, modifiers: number): Cursor {

    // check for click inside "actual size" display overlay
    if (this.zoomScale > 1) {
      if (pointInRect(canvasPt, this.overlayRect)) {
        if (pointInRect(canvasPt, this.overlayResizeRect)) {
          if (this.overlayPosition == 0 || this.overlayPosition == 3) {
            return Cursor.UpLeft
          } else {
            return Cursor.UpRight
          }
        } else {
          return Cursor.Move
        }
      }
    }

    if (this.mouseMode == MouseMode.Grab) {
      return Cursor.Hand
    }

    if (this.tool != Tool.None) {

      if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
        if (this.mouseMode == MouseMode.None) {
          const framePt = this.frameFromDisplayFloorClip(this.displayFromCanvasPt(canvasPt))
          let hitSelection = pointInRect(framePt, this.toolRect)
          if (this.tool == Tool.Lasso && hitSelection && this.selectMask) {
            const hitPt: Point = {
              x: framePt.x - this.toolRect.x + this.selectMask.x,
              y: framePt.y - this.toolRect.y + this.selectMask.y
            }
            hitSelection = (this.selectMask.getPixelAt(hitPt) ?? 0) != 0
          }
          if (modifiers & ModifierKeys.CONTROL) {
            if (rectIsEmpty(this.toolRect)) {
              return Cursor.Hand
            } else {
              return Cursor.Move
            }
          }
          if (hitSelection) {
            return Cursor.Move
          }
        } else if (this.selectBits) {
          return Cursor.Move
        }
      } else {
        if (this.mouseMode == MouseMode.None && (modifiers & ModifierKeys.CONTROL)) {
          return Cursor.Hand
        }
      }

      if (this.tool == Tool.Zoom) {
        if (modifiers & ModifierKeys.SHIFT) {
          if (this.zoomScale > 1) {
            return Cursor.ZoomOut
          } else {
            return Cursor.Zoom
          }
        } else if (this.zoomLevel == this.zoomMaxLevel) {
          return Cursor.Zoom
        }
      }

      return ToolCursors[this.tool]
    }

    return Cursor.None
  }

  toolRightDown(canvasPt: Point, modifiers: number) {
    this.mouseMode = MouseMode.Grab
    this.updateHand(true, modifiers, canvasPt)
  }

  toolRightMove(canvasPt: Point, modifiers: number) {
    if (this.mouseMode == MouseMode.Grab) {
      this.updateHand(false, modifiers, canvasPt)
    }
  }

  toolRightUp(canvasPt: Point, modifiers: number) {
    if (this.mouseMode == MouseMode.Grab) {
      this.mouseMode = MouseMode.None
    }
  }

  toolDown(canvasPt: Point, modifiers: number) {
    this.constrainMode = undefined
    this.savedTool = this.tool

    this.displayCurrPt = {
      x: canvasPt.x + this.windowRect.x,
      y: canvasPt.y + this.windowRect.y
    }
    this.displayStartPt = {...this.displayCurrPt}

    this.dragFromCenter = (modifiers & ModifierKeys.OPTION) != 0

    // check for click inside "actual size" display overlay
    if (this.zoomScale > 1) {
      if (pointInRect(canvasPt, this.overlayRect)) {
        if (pointInRect(canvasPt, this.overlayResizeRect)) {
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

    if (modifiers & ModifierKeys.CONTROL) {
      let doGrab = true
      if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
        if (!rectIsEmpty(this.toolRect)) {
          doGrab = false
        }
      }
      if (doGrab) {
        this.mouseMode = MouseMode.Grab
        this.updateHand(true, modifiers, canvasPt)
        return
      }
    }

    this.mouseMode = MouseMode.Tool
    this.toolUpdate(true, modifiers)
  }

  toolMove(canvasPt: Point, modifiers: number) {

    this.displayCurrPt = {
      x: canvasPt.x + this.windowRect.x,
      y: canvasPt.y + this.windowRect.y
    }

    if (this.constrainMode === undefined) {
      if (modifiers & ModifierKeys.SHIFT) {
        const dxAbs = Math.abs(this.displayCurrPt.x - this.displayStartPt.x)
        const dyAbs = Math.abs(this.displayCurrPt.y - this.displayStartPt.y)
        if (dxAbs >= dyAbs) {
          this.constrainMode = ConstrainMode.Horizontal
        } else {
          this.constrainMode = ConstrainMode.Vertical
        }
      } else {
        this.constrainMode = ConstrainMode.None
      }
    }

    if (this.mouseMode == MouseMode.OverlayMove) {
      const dx = this.displayCurrPt.x - this.displayStartPt.x
      const dy = this.displayCurrPt.y - this.displayStartPt.y
      this.moveOverlay(dx, dy)
    } else if (this.mouseMode == MouseMode.OverlayResize) {
      const dx = Math.floor(this.displayCurrPt.x - this.displayStartPt.x)
      const dy = Math.floor(this.displayCurrPt.y - this.displayStartPt.y)
      this.resizeOverlay(dx, dy)
    } else if (this.mouseMode == MouseMode.Grab) {
      this.updateHand(false, modifiers, canvasPt)
    } else if (this.mouseMode == MouseMode.Tool) {
      this.toolUpdate(false, modifiers)
    }
  }

  private toolScroll(modifiers: number) {
    if (this.mouseMode == MouseMode.None) {
      return
    }

    const windowStart = {...this.windowRect}
    const x = this.displayCurrPt.x - this.windowRect.x
    if (x <= 16) {
      this.windowRect.x -= 8
    } else if (x >= this.windowRect.width - 16) {
      this.windowRect.x += 8
    }
    const y = this.displayCurrPt.y - this.windowRect.y
    if (y <= 16) {
      this.windowRect.y -= 8
    } else if (y > this.windowRect.height - 16) {
      this.windowRect.y += 8
    }

    this.updateWindowRect()
    const dx = this.windowRect.x - windowStart.x
    const dy = this.windowRect.y - windowStart.y
    if (dx || dy) {
      this.displayCurrPt.x += dx
      this.displayCurrPt.y += dy
      this.toolUpdate(false, modifiers)
      this.updateCanvas()
    }
  }

  toolArrow(direction: number, modifiers: number) {
    if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
      if (!rectIsEmpty(this.toolRect)) {
        this.liftSelection(modifiers)
        if (direction == 0) {
          this.toolRect.y -= 1
        } else if (direction == 1) {
          this.toolRect.x -= 1
        } else if (direction == 2) {
          this.toolRect.y += 1
        } else if (direction == 3) {
          this.toolRect.x += 1
        }
        this.setToolRect(this.toolRect)
        this.moveSelection()
        return
      }
    }
    if (direction & 1) {
      let color = (modifiers & ModifierKeys.OPTION) ? this.backColor : this.foreColor
      const delta = (direction & 2) - 1
      color += delta
      if (color < 0) {
        color += this.format.colorCount
      } else if (color >= this.format.colorCount) {
        color = 0
      }
      if (modifiers & ModifierKeys.OPTION) {
        this.setBackColor(color)
      } else {
        this.setForeColor(color)
      }
    }
  }

  toolUp(canvasPt: Point, modifiers: number) {

    if (this.mouseMode == MouseMode.Grab) {
      this.mouseMode = MouseMode.None
      return
    }

    if (this.tool == Tool.Select) {
      if (!this.selectBits) {
        if (modifiers & ModifierKeys.COMMAND) {
          this.trimSelection()
        }
      }
    } else if (this.tool == Tool.Lasso) {
      if (!this.selectBits) {
        if (this.toolPoints.length > 2) {
          const lassoMask = this.buildLassoMask(this.toolPoints)
          if (lassoMask) {
            this.selectMask = lassoMask
            this.toolRect = this.selectMask.bounds
          }
        }
        this.toolPoints = []
        this.updateCanvas()
      }
    }

    if (this.scrollTimerId) {
      clearTimeout(this.scrollTimerId)
      this.scrollTimerId = undefined
    }

    this.mouseMode = MouseMode.None
    const oldTool = this.tool
    this.tool = this.savedTool ?? Tool.None
    this.savedTool = undefined
    if (this.onToolChanged) {
      this.onToolChanged(oldTool, this.tool, modifiers)
    }
  }

  private toolUpdate(firstUpdate: boolean, modifiers: number) {
    switch (this.tool) {
      case Tool.Select:
      case Tool.Lasso:
        this.updateSelection(firstUpdate, modifiers)
        break
      case Tool.Line:
        this.updateLine(firstUpdate, modifiers)
        break
      case Tool.FillRect:
      case Tool.FrameRect:
      case Tool.FillOval:
      case Tool.FrameOval:
        this.updateRectOval(firstUpdate, modifiers)
        break
      case Tool.Pencil:
        this.updatePencil(firstUpdate, modifiers)
        break
      case Tool.Brush:
        this.updateBrush(firstUpdate, modifiers)
        break
      case Tool.Eraser:
        this.updateEraser(firstUpdate, modifiers)
        break
      case Tool.Dropper:
        this.updateDropper(firstUpdate, modifiers)
        break
      case Tool.Bucket:
        this.updateBucket(firstUpdate, modifiers)
        break
      case Tool.Text:
        this.updateText(firstUpdate, modifiers)
        break
      case Tool.Zoom:
        this.updateMagnify(firstUpdate, modifiers)
        return  // don't update scrollTimerId
    }
    this.scrollTimerId = setTimeout(() => { this.toolScroll(modifiers) }, 50)
  }

  private updateLine(firstUpdate: boolean, modifiers: number) {
    this.frameCurrPt = this.frameFromDisplayFloorNoClip(this.displayCurrPt)
    if (firstUpdate) {
      this.captureUndo()
      this.frameStartPt = this.frameCurrPt
    }
    let startPt: Point = {...this.frameStartPt}
    let endPt: Point = {...this.frameCurrPt}
    const xMajor = Math.abs(endPt.x - startPt.x) >= Math.abs(endPt.y - startPt.y)
    if (modifiers & ModifierKeys.SHIFT) {
      if (xMajor) {
        endPt.y = startPt.y
      } else {
        endPt.x = startPt.x
      }
    }
    if (this.dragFromCenter) {
      const width = (endPt.x - startPt.x) * 2
      const height = (endPt.y - startPt.y) * 2
      startPt.x = endPt.x - width
      startPt.y = endPt.y - height
    }
    this.frame.copyFrom(this.undoHistory[this.undoCurrentIndex - 1].frame)
    const dstRect = { x: startPt.x, y: startPt.y, width: 1, height: 1 }
    this.frame.fillRect(dstRect, this.foreColor)
    this.interpolatePoints(startPt, endPt, "round", (pt: Point) => {
      const dstRect = { x: pt.x, y: pt.y, width: 1, height: 1 }
      this.frame.fillRect(dstRect, this.foreColor)
    })

    this.setCoordinateInfo(startPt, endPt)
    this.updateToMemory()
  }

  private updateRectOval(firstUpdate: boolean, modifiers: number) {

    if (modifiers & ModifierKeys.SHIFT) {
      this.constrainSize()
    }
    this.frameCurrPt = this.frameFromDisplayFloorNoClip(this.displayCurrPt)
    if (firstUpdate) {
      this.captureUndo()
      this.frameStartPt = this.frameCurrPt
    }
    this.rebuildToolRect()
    this.frame.copyFrom(this.undoHistory[this.undoCurrentIndex - 1].frame)

    switch (this.tool) {
      case Tool.FillOval:
      case Tool.FrameOval:
        const mask = this.format.createBitmap(this.frame.bounds)
        drawEllipse(this.toolRect, mask, this.tool == Tool.FillOval)
        this.frame.fillRect(this.frame.bounds, this.foreColor, mask)
        break
      case Tool.FrameRect:
        // TODO: this is HIRES specific
        if (this.toolRect.width >= 4 && this.toolRect.height >= 2) {
          const patternWidth = this.format.getColorPattern(this.foreColor)[0].length
          let r = { x: this.toolRect.x, y: this.toolRect.y, width: this.toolRect.width, height: 1 }
          this.frame.fillRect(r, this.foreColor)
          r.y = this.toolRect.y + this.toolRect.height - 1
          this.frame.fillRect(r, this.foreColor)
          r.y = this.toolRect.y
          r.width = patternWidth
          r.height = this.toolRect.height
          this.frame.fillRect(r, this.foreColor)
          r.x = this.toolRect.x + this.toolRect.width - patternWidth
          this.frame.fillRect(r, this.foreColor)
          break
        }
        // fall through
      case Tool.FillRect:
        this.frame.fillRect(this.toolRect, this.foreColor)
        break
    }

    this.updateToMemory()
  }

  private updateBrush(firstUpdate: boolean, modifiers: number) {
    this.constrainDirection()
    this.frameCurrPt = this.frameFromDisplayFloorNoClip(this.displayCurrPt)
    if (firstUpdate) {
      this.captureUndo()
      this.frameStartPt = this.frameCurrPt
    }

    if (!this.brushMask) {
      // TODO: more brush shapes
      const brushBits = [
        0b00000000,
        0b00000000,
        0b00011000,
        0b00111100,
        0b00111100,
        0b00011000,
        0b00000000,
        0b00000000,
      ]
      let scale: Point = { x: 1, y: 1 }
      if (this.format.pixelScale.x > this.format.pixelScale.y) {
        scale.y = Math.max(Math.floor(this.format.pixelScale.x / this.format.pixelScale.y), 1)
      } else {
        scale.x = Math.max(Math.floor(this.format.pixelScale.y / this.format.pixelScale.x), 1)
      }
      const brushBounds: Rect = {x: 0, y: 0, width: 8 * scale.x, height: 8 * scale.y}
      this.brushMask = this.format.createBitmap(brushBounds)
      this.brushMask.bitsToMask(brushBits, 0x80, 0x01, {x: 0, y: 0}, scale)
    }

    this.interpolatePoints(this.frameStartPt, this.frameCurrPt, "round", (pt: Point) => {
      const dstRect: Rect = {
        x: pt.x - this.brushMask!.width / 2,
        y: pt.y - this.brushMask!.height / 2,
        width: this.brushMask!.width,
        height: this.brushMask!.height
      }
      this.frame.fillRect(dstRect, this.foreColor, this.brushMask)
    })
    this.frameStartPt = this.frameCurrPt
    this.setCoordinateInfo(this.frameCurrPt)
    this.updateToMemory()
  }

  private updateEraser(firstUpdate: boolean, modifiers: number) {
    this.constrainDirection()
    let rectChanged = false
    if (firstUpdate) {
      this.captureUndo()
      rectChanged = true
    }
    this.interpolatePoints(this.displayStartPt, this.displayCurrPt, "float", (displayPt: Point) => {
      let dpt = { x: displayPt.x - 8, y: displayPt.y - 8 }
      const fpt1 = this.frameFromDisplay(dpt, "floor", false)
      dpt.x += 16
      dpt.y += 16
      const fpt2 = this.frameFromDisplay(dpt, "ceil", false)
      if (fpt1.x != this.toolRect.x || fpt1.y != this.toolRect.y) {
        rectChanged = true
      }
      const dstRect: Rect = {
        x: fpt1.x,
        y: fpt1.y,
        width: fpt2.x - fpt1.x,
        height: fpt2.y - fpt1.y
      }
      this.frameCurrPt = {...fpt1}
      this.frame.fillRect(dstRect, this.backColor)
    })
    if (rectChanged) {
      this.displayStartPt = this.displayCurrPt
      this.setCoordinateInfo(this.frameCurrPt)
      this.updateToMemory()
    }
  }

  private updatePencil(firstUpdate: boolean, modifiers: number) {
    this.constrainDirection()
    if (firstUpdate) {
      this.captureUndo()
      this.frameCurrPt = this.frameFromDisplayFloorClip(this.displayCurrPt)
      this.pencilColor = this.frame.togglePixel(this.frameCurrPt, this.foreColor, this.backColor)
    } else {
      this.frameCurrPt = this.frameFromDisplayFloorNoClip(this.displayCurrPt)
      this.interpolatePoints(this.frameStartPt, this.frameCurrPt, "round", (pt: Point) => {
        this.frame.togglePixel(pt, this.foreColor, this.backColor, this.pencilColor)
      })
    }
    this.frameStartPt = this.frameCurrPt
    this.setCoordinateInfo(this.frameCurrPt)
    this.updateToMemory()
  }

  private updateDropper(firstUpdate: boolean, modifiers: number) {
    this.frameCurrPt = this.frameFromDisplayFloorClip(this.displayCurrPt)
    const dropColor = this.frame.getColorAt(this.frameCurrPt)
    if (dropColor !== undefined) {
      if (modifiers & ModifierKeys.OPTION) {
        this.setBackColor(dropColor)
      } else {
        this.setForeColor(dropColor)
      }
    }
    this.setCoordinateInfo(this.frameCurrPt)
  }

  private updateBucket(firstUpdate: boolean, modifiers: number) {
    if (firstUpdate) {
      this.captureUndo()
      this.frameStartPt = this.frameFromDisplayFloorNoClip(this.displayCurrPt)
      if (pointInRect(this.frameStartPt, this.frame.bounds)) {
        const fillColor = this.frame.getColorAt(this.frameStartPt)
        if (fillColor !== undefined) {
          let fillMask = this.frame.createMask(fillColor)
          const floodFill = new FloodFill(fillMask)
          fillMask = floodFill.fill(this.frameStartPt)
          this.frame.fillRect(this.frame.bounds, this.foreColor, fillMask)
          this.updateToMemory()
        }
        this.setCoordinateInfo(this.frameStartPt)
      }
    }
  }

  private updateHand(firstUpdate: boolean, modifiers: number, canvasPt: Point) {
    if (firstUpdate) {
      this.handStartPt = {...canvasPt}
    }
    this.windowRect.x -= canvasPt.x - this.handStartPt.x
    this.windowRect.y -= canvasPt.y - this.handStartPt.y
    this.handStartPt = {...canvasPt}
    this.updateWindowRect()
    this.updateCanvas()
  }

  public updateMagnify(firstUpdate: boolean, modifiers: number) {
    if (firstUpdate) {
      let newZoomLevel
      if (modifiers & ModifierKeys.SHIFT) {
        newZoomLevel = Math.max(this.zoomLevel - 1, 0)
      } else {
        newZoomLevel = Math.min(this.zoomLevel + 1, this.zoomMaxLevel)
      }
      if (newZoomLevel != this.zoomLevel) {
        this.setZoomLevel(newZoomLevel, this.canvasFromDisplayPt(this.displayCurrPt))
      }

      this.frameCurrPt = this.frameFromDisplayFloorClip(this.displayCurrPt)
      this.setCoordinateInfo(this.frameCurrPt)
    }
  }

  public inputText(e: KeyboardEvent): boolean {
    if (this.tool != Tool.Text || this.editText === undefined) {
      return false
    }
    if (e.key == "Backspace") {
      if (this.editText.length > 0) {
        this.editText = this.editText.slice(0, this.editText.length - 1)
      }
    } else if (e.key == "Enter") {
      this.editText += "\n"
    } else if (e.key.length == 1) {
      const code = e.key.charCodeAt(0)
      let charBits = this.editFont?.getCharBits(code)
      if (charBits) {
        this.editText += e.key
      } else if (code >= 0x61 && code <= 0x7A) {
        charBits = this.editFont?.getCharBits(code - 0x61 + 0x41)
        if (charBits) {
          this.editText += e.key.toUpperCase()
        }
      }
    } else {
      return false
    }
    this.drawText()
    return true
  }

  private updateText(firstUpdate: boolean, modifiers: number) {
    if (firstUpdate) {
      this.frameStartPt = this.frameFromDisplayFloorClip(this.displayCurrPt)
      if (this.editText !== undefined) {
        this.dropSelection()
        this.setCoordinateInfo(this.frameStartPt)
      } else {
        this.captureUndo()

        this.editText = ""
        this.editFont = Font.create((modifiers & ModifierKeys.SHIFT) ? "naja" : "appleiie")
        const charRect = {
          x: this.frameStartPt.x,
          y: this.frameStartPt.y - this.editFont.charSize.height,
          width: this.editFont.charSize.width,
          height: this.editFont.charSize.height,
        }
        this.setToolRect(charRect)
        this.drawText()
      }
    }
  }

  private drawText(drawCursor = true) {

    if (this.editText === undefined || !this.editFont) {
      return
    }

    this.frame.copyFrom(this.undoHistory[this.undoCurrentIndex - 1].frame)

    let left = this.toolRect.x
    let top = this.toolRect.y

    const scale = {x: 1, y: 1}
    // TODO: option for font scaling?

    const charRect = {
      x: left,
      y: top,
      width: this.editFont.charSize.width * scale.x,
      height: this.editFont.charSize.height * scale.y
    }

    const fontDX = (this.editFont.charSize.width + this.editFont.charSpacing.width) * scale.x
    const fontDY = (this.editFont.charSize.height + this.editFont.charSpacing.height) * scale.y

    for (let i = 0; i < this.editText.length; i += 1) {
      if (this.editText[i] == "\n") {
        charRect.x = left
        charRect.y += fontDY
        continue
      }

      const code = this.editText.charCodeAt(i)
      if (code >= 0x20 && code < 0x80) {
        const charBits = this.editFont.getCharBits(code)
        if (!charBits) {
          continue
        }
        const charBounds: Rect = {
          x: 0, y: 0,
          width: this.editFont.charSize.width * scale.x,
          height: this.editFont.charSize.height * scale.y
        }
        const charMask = this.format.createBitmap(charBounds)
        charMask.bitsToMask(charBits, this.editFont.startMask, this.editFont.endMask, {x: 0, y: 0}, scale)

        this.frame.fillRect(charRect, this.foreColor, charMask)
      }

      charRect.x += fontDX
    }

    if (drawCursor) {
      this.frame.fillRect(charRect, this.foreColor)
    }

    this.setCoordinateInfo(this.toolRect, charRect, charRect)
    this.updateToMemory()
  }

  private updateSelection(firstUpdate: boolean, modifiers: number) {
    if (firstUpdate) {
      this.frameStartPt = this.frameFromDisplayRoundClip(this.displayCurrPt)
      let hitSelection = pointInRect(this.frameStartPt, this.toolRect)
      if (this.tool == Tool.Lasso && hitSelection && this.selectMask) {
        const pt: Point = {
          x: this.frameStartPt.x - this.toolRect.x + this.selectMask.x,
          y: this.frameStartPt.y - this.toolRect.y + this.selectMask.y
        }
        hitSelection = (this.selectMask.getPixelAt(pt) ?? 0) != 0
      }
      if (modifiers & ModifierKeys.CONTROL) {
        hitSelection = true
      }
      if (hitSelection) {
        // compute offset from cursor to top/left of selection
        this.frameStartPt.x -= this.toolRect.x
        this.frameStartPt.y -= this.toolRect.y
        this.liftSelection(modifiers)
      } else {
        this.dropSelection()
        if (this.tool == Tool.Lasso) {
          this.toolPoints = []
        }
      }
    }

    if (this.selectBits) {
      this.constrainDirection()
      this.frameCurrPt = this.frameFromDisplayRoundNoClip(this.displayCurrPt)
      this.toolRect.x = this.frameCurrPt.x - this.frameStartPt.x
      this.toolRect.y = this.frameCurrPt.y - this.frameStartPt.y
      if (this.constrainMode == ConstrainMode.Horizontal) {
        // TODO: implement "detents" at byte boundaries
        const alignX = this.format.alignment.x
        if (alignX) {
          this.toolRect.x -= (this.toolRect.x % alignX) - (this.selectBits.x % alignX)
        }
      }
      this.setToolRect(this.toolRect)
      this.moveSelection()
    } else {
      if (this.tool == Tool.Select) {
        if (modifiers & ModifierKeys.SHIFT) {
          this.constrainSize()
        }
      }
      this.frameCurrPt = this.frameFromDisplayRoundClip(this.displayCurrPt)
      if (this.tool == Tool.Lasso) {
        this.toolPoints.push(this.frameCurrPt)
        this.setCoordinateInfo(this.frameFromDisplayFloorClip(this.displayCurrPt))
      } else {
        this.rebuildToolRect(true)
      }

      this.updateCanvas()
    }
  }

  private interpolatePoints(start: Point, end: Point, mode: string, proc: (pt: Point) => void ) {
    proc(start)
    const dx = end.x - start.x
    const dy = end.y - start.y
    const delta = Math.max(Math.abs(dx), Math.abs(dy))
    for (let d = 1; d <= delta; d += 1) {
      const pt: Point = {
        x: start.x + dx * d / delta,
        y: start.y + dy * d / delta
      }
      if (mode == "round") {
        pt.x = Math.round(pt.x)
        pt.y = Math.round(pt.y)
      }
      proc(pt)
    }
  }

  private liftSelection(modifiers: number) {
    if (this.selectBits) {
      this.captureUndo()
      // leave replicated selection
      if (modifiers & ModifierKeys.OPTION) {
        this.selectBack = this.frame.duplicate()
      }
    } else {
      this.captureUndo()
      this.selectBits = this.frame.duplicate(this.toolRect)
      if (!(modifiers & ModifierKeys.OPTION)) {
        this.frame.eraseRect(this.toolRect, this.backColor, this.selectMask)
      }
      this.selectBack = this.frame.duplicate()
    }
  }

  private dropSelection() {
    if (this.selectBits !== undefined) {
      this.captureUndo()
      this.selectBits = undefined
    }
    this.selectMask = undefined
    this.selectBack = undefined

    if (this.editText !== undefined) {
      this.drawText(false)
      this.captureUndo()
      this.editText = undefined
      this.editFont = undefined
    }

    this.clearToolRect()
  }

  private constrainDirection() {
    if (this.constrainMode == ConstrainMode.Vertical) {
      this.displayCurrPt.x = this.displayStartPt.x
    } else if (this.constrainMode == ConstrainMode.Horizontal) {
      this.displayCurrPt.y = this.displayStartPt.y
    }
  }

  private constrainSize() {
    const dx = this.displayCurrPt.x - this.displayStartPt.x
    const dy = this.displayCurrPt.y - this.displayStartPt.y
    const dxAbs = Math.abs(dx)
    const dyAbs = Math.abs(dy)
    if (dxAbs >= dyAbs) {
      const dySign = dyAbs ? dy / dyAbs : 1
      this.displayCurrPt.y = this.displayStartPt.y + dxAbs * dySign
    } else {
      const dxSign = dxAbs ? dx / dxAbs : 1
      this.displayCurrPt.x = this.displayStartPt.x + dyAbs * dxSign
    }
  }

  private buildLassoMask(lassoPoints: Point[]): Bitmap | undefined {

    // scan convert polygon to mask the size of the screen
    const polygon = new Polygon()
    const polyMask = this.format.createBitmap(this.frame.bounds)
    polygon.scanEdges(lassoPoints, polyMask)

    // create offscreen bitmap to contain frame,
    //  with 1 pixel border on all sides
    const offBounds: Rect = {
      x: 0, y: 0,
      width: this.frame.width + 2,
      height: this.frame.height + 2
    }
    const offscreen = this.format.createBitmap(offBounds)

    // fill offscreen with background color
    offscreen.fillRect(offscreen.bounds, this.backColor)

    // draw frame bits contained by the lasso into the offscreen,
    //  adjusting for 1 pixel border
    offscreen.drawBitmap(this.frame, {x: 1, y: 1}, polyMask)

    // create a fill mask from the offscreen
    const offMask = offscreen.createMask(this.backColor)

    // flood fill offMask starting at 0,0
    const floodFill = new FloodFill(offMask)
    const fillMask = floodFill.fill({ x: 0, y: 0})

    // invert mask
    fillMask.reverseMask()

    // extract minimum mask
    const fillMinRect = fillMask.minMaskRect()
    if (fillMinRect.width == 0 || fillMinRect.height == 0) {
      return
    }

    const lassoMask = fillMask.duplicate(fillMinRect)

    // remove border coordinates
    lassoMask.x -= 1
    lassoMask.y -= 1
    return lassoMask
  }

  private rebuildToolRect(isSelection: boolean = false) {

    let rect: Rect = { x: 0, y: 0, width: 0, height: 0}
    if (this.dragFromCenter) {
      const halfWidth = Math.abs(this.frameCurrPt.x - this.frameStartPt.x)
      rect.x = this.frameStartPt.x - halfWidth
      rect.width = halfWidth * 2
      const halfHeight = Math.abs(this.frameCurrPt.y - this.frameStartPt.y)
      rect.y = this.frameStartPt.y - halfHeight
      rect.height = halfHeight * 2
    } else {
      rect.x = Math.min(this.frameStartPt.x, this.frameCurrPt.x)
      rect.width = Math.abs(this.frameCurrPt.x - this.frameStartPt.x)
      rect.y = Math.min(this.frameStartPt.y, this.frameCurrPt.y)
      rect.height = Math.abs(this.frameCurrPt.y - this.frameStartPt.y)
    }

    // briefly convert width,height into x2,y2
    rect.width += rect.x
    rect.height += rect.y
    if (isSelection) {
      rect.x = Math.round(rect.x)
      rect.y = Math.round(rect.y)
      rect.width = Math.round(rect.width) - rect.x
      rect.height = Math.round(rect.height) - rect.y
    } else {
      rect.x = Math.floor(rect.x)
      rect.y = Math.floor(rect.y)
      rect.width = Math.floor(rect.width) + 1 - rect.x
      rect.height = Math.floor(rect.height) + 1 - rect.y
    }

    if (!isSelection) {
      if (rect.width <= 0) {
        rect.width = 1
      }
      if (rect.height <= 0) {
        rect.height = 1
      }
    }

    this.setToolRect(rect)
  }

  cutSelection(modifiers: number) {
    this.cutCopyClearSelection(true, true, modifiers)
  }

  copySelection(modifiers: number) {
    this.cutCopyClearSelection(true, false, modifiers)
  }

  clearSelection(modifiers: number) {
    this.cutCopyClearSelection(false, true, modifiers)
  }

  private cutCopyClearSelection(copy: boolean, clear: boolean, modifiers: number) {
    if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
      if (!rectIsEmpty(this.toolRect)) {
        let bitmap: Bitmap | undefined
        let mask: Bitmap | undefined
        if (this.selectBits) {
          if (copy) {
            bitmap = this.selectBits
            mask = this.selectMask
          }
          if (clear) {
            this.captureUndo()
            if (this.selectBack) {
              this.frame.copyFrom(this.selectBack)
            }
            this.selectBits = undefined
            this.selectMask = undefined
            this.selectBack = undefined
            this.clearToolRect()
            this.moveSelection()
          }
        } else {
          if (copy) {
            if (!rectIsEmpty(this.toolRect)) {
              bitmap = this.frame.duplicate(this.toolRect)
              mask = this.selectMask
            } else {
              bitmap = this.frame.duplicate()
            }
          }
          if (clear) {
            this.captureUndo()
            this.frame.eraseRect(this.toolRect, this.backColor, this.selectMask)
            this.selectMask = undefined
            this.clearToolRect()
            this.updateToMemory()
          }
        }

        if (bitmap) {
          const pixelData = bitmap.encode()
          const maskData = mask?.encode()
          const compress = (modifiers & ModifierKeys.SHIFT) != 0
          const imageText = textFromPixels(pixelData, maskData, compress)
          navigator.clipboard.writeText(imageText).then(() => {})
        }
      }
    }
  }

  pasteSelection(clipText: string, canvasPt?: Point) {
    // only allow pasting characters if text tool is currently active
    if (this.tool == Tool.Text) {
      if (this.editText !== undefined) {
        this.editText += clipText
        this.drawText()
      }
      return
    }
    const framePt = canvasPt ? this.frameFromDisplayRoundClip(this.displayFromCanvasPt(canvasPt)) : canvasPt
    const result = imageFromText(clipText, this.frame.format)
    if (result.pixelData) {
      const bitmap = this.format.decode(result.pixelData)
      const mask = result.maskData !== undefined ? this.format.decode(result.maskData) : undefined
      this.pasteImage(bitmap, mask, framePt)
      // TODO: may need to update cursor to match change to select tool
    }
  }

  flipSelection(horizontal: boolean, vertical: boolean) {
    if (horizontal || vertical) {
      if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
        const modifiers = 0
        this.liftSelection(modifiers)
        if (horizontal) {
          this.selectBits!.flipHorizontal()
          this.selectMask?.flipHorizontal()
          const alignX = this.format.alignment.x
          if (alignX) {
            this.toolRect.x -= (this.toolRect.x % alignX) - (this.selectBits!.x % alignX)
          }
        }
        if (vertical) {
          this.selectBits!.flipVertical()
          this.selectMask?.flipVertical()
        }
        this.moveSelection()
        this.updateCanvas()
      }
    }
  }

  xorSelection() {
    if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
      const modifiers = 0
      this.liftSelection(modifiers)
      this.selectBits!.xorColor(this.foreColor)
      this.moveSelection()
      this.updateCanvas()
    }
  }

  xorFrame() {
    this.captureUndo()
    this.frame.xorColor(this.foreColor)
    this.updateToMemory()
  }

  padSelection() {
    // TODO: also support pad for Tool.Select?
    if (this.tool == Tool.Lasso) {
      if (!this.selectBits) {
        if (this.selectMask) {
          this.captureUndo()
          this.selectMask = this.selectMask.padMask()
          this.toolRect = this.selectMask.bounds
          this.updateCanvas()
        }
      }
    }
  }

  selectAll(trim: boolean) {
    let r: Rect = { x: 0, y: 0, ...this.frameSize }
    this.setSelection(r, trim)
  }

  selectAllLasso() {
    if (this.selectBits) {
      this.dropSelection()
      this.moveSelection()
    }
    const lassoPoints = [
      { x: 0, y: 0 },
      { x: this.format.frameSize.width, y: 0 },
      { x: this.format.frameSize.width, y: this.format.frameSize.height },
      { x: 0, y: this.format.frameSize.height }
    ]
    const lassoMask = this.buildLassoMask(lassoPoints)
    if (lassoMask) {
      this.selectMask = lassoMask
      this.setTool(Tool.Lasso)
      this.setToolRect(this.selectMask.bounds)
    }
    this.updateCanvas()
  }

  setSelection(rect: Rect, trim: boolean = false) {
    if (this.selectBits) {
      this.dropSelection()
      this.moveSelection()
    }
    this.setTool(Tool.Select)
    this.setToolRect(rect)
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
    const tempBitmap = this.frame.duplicate(this.toolRect)
    const maskBitmap = tempBitmap.createMask(this.backColor)
    let rect = maskBitmap.minMaskRect()
    rect.x += tempBitmap.x
    rect.y += tempBitmap.y
    this.setToolRect(rect)
    this.updateCanvas()
  }

  private moveSelection() {

    if (this.selectBack && this.selectBits) {
      this.frame.copyFrom(this.selectBack)

      let drawMask = this.selectMask
      if (this.useTransparent) {
        const tempMask = this.selectBits.createMask(this.backColor)
        if (drawMask) {
          tempMask.eraseRect(tempMask.bounds, 0, drawMask, false)
        }
        drawMask = tempMask
      }
      this.frame.drawBitmap(this.selectBits, this.toolRect, drawMask)
    }
    this.updateToMemory()

    // force a selection redraw in case the selection contents
    //  exactly match existing screen contents (empty dirty rectangle)
    this.updateCanvas()
  }

  private clearToolRect() {
    this.toolPoints = []
    this.setToolRect({ x: 0, y: 0, width: 0, height: 0 })
  }

  private setToolRect(r: Rect) {
    this.toolRect = {...r}
    this.coordInfo.start = {...r}
    this.coordInfo.end = undefined
    this.coordInfo.size = {...r}
    if (this.onToolRectChanged) {
      this.onToolRectChanged()
    }
  }

  private setCoordinateInfo(startPt?: Point, endPt?: Point, size?: Size) {
    this.coordInfo.start = startPt
    this.coordInfo.end = endPt
    if (size) {
      this.coordInfo.size = size
    } else if (startPt && endPt) {
      this.coordInfo.size = {
        width: Math.abs(endPt.x - startPt.x),
        height: Math.abs(endPt.y - startPt.y)
      }
    } else {
      this.coordInfo.size = undefined
    }
    if (this.onToolRectChanged) {
      this.onToolRectChanged()
    }
  }

  public getCoordinateInfo(canvasPt?: Point): CoordinateInfo {
    if (this.mouseMode == MouseMode.Tool) {
      return this.coordInfo
    }

    if (this.tool == Tool.Select || this.tool == Tool.Lasso) {
      if (this.coordInfo.size) {
        if (this.coordInfo.size.width && this.coordInfo.size.height) {
          return this.coordInfo
        }
      }
    }

    if (this.tool == Tool.Text) {
      if (this.editText !== undefined) {
        return this.coordInfo
      }
    }

    if (canvasPt) {
      return { start: this.frameFromDisplayFloorNoClip(this.displayFromCanvasPt(canvasPt)) }
    }

    return {}
  }

  pasteImage(bitmap: Bitmap, mask: Bitmap | undefined, framePt: Point | undefined) {

    // drop any previous selection
    if (this.selectBits) {
      this.dropSelection()
    } else {
      this.captureUndo()
    }

    let frameRect = {
      x: Math.floor(this.windowRect.x / this.totalScale.x),
      y: Math.floor(this.windowRect.y / this.totalScale.y),
      width: Math.ceil((this.windowRect.x + this.windowRect.width) / this.totalScale.x),
      height: Math.ceil((this.windowRect.y + this.windowRect.height) / this.totalScale.y)
    }
    frameRect.width -= frameRect.x
    frameRect.height -= frameRect.y

    // TODO: there are problems with pasting into screen
    //  when display resized to larger than screen

    this.setTool(mask ? Tool.Lasso : Tool.Select)
    this.selectBits = bitmap
    this.selectMask = mask
    this.selectBack = this.frame.duplicate()
    let x: number
    let y: number
    if (framePt && pointInRect(framePt, frameRect)) {
      x = Math.floor(framePt.x - bitmap.width / 2)
      y = Math.floor(framePt.y - bitmap.height / 2)
    } else if (pointInRect({ x: bitmap.x, y: bitmap.y }, frameRect)) {
      x = bitmap.x
      y = bitmap.y
    } else {
      x = Math.floor((frameRect.x - bitmap.width) / 2)
      y = Math.floor((frameRect.y - bitmap.height) / 2)
    }

    if (x < frameRect.x) {
      x = frameRect.x
    }
    if (y < frameRect.y) {
      y = frameRect.y
    }

    if (this.format.alignment.x) {
      const alignX = this.format.alignment.x
      x = x - (x % alignX) + (bitmap.x % alignX)
      if (x < frameRect.x) {
        x += alignX
      }
    }

    this.setToolRect({ x, y, width: bitmap.width, height: bitmap.height})
    this.moveSelection()
  }

  public optimize() {
    this.captureUndo()
    this.frame.optimize()
    this.updateToMemory()
  }

  //----------------------------------------------------------------------------
}

//#endregion
//==============================================================================
