
import { Point, Rect } from "../shared/types"
import { IMachineDisplay, IMachineInput, Joystick } from "../shared/types"
import { IHostHooks } from "../shared/types"
import { Tool, Cursor, ToolIconNames, ToolCursorNames, ToolCursorOrigins } from "./tools"
import { ToolHelp, ColorHelp } from "./tools"
import { PaintDisplay, getModifierKeys } from "./display"

// TODO: is this needed for extension?
// import "./display_view.css"

export enum DisplaySource {
  Visible   = 0,
  Active    = 1,
  Primary   = 2,
  Secondary = 3,
}

const displayTemplate = `
  <div id="display-grid">
    <div id="tool-palette"></div>
    <div id="display-div" class="screen-tabs">

      <ul class="tabs-list">
        <li id="li0" class="active"><a>Active(0)</a></li>
        <li id="li1"><a>Visible(1)</a></li>
        <li id="li2"><a>Primary</a></li>
        <li id="li3"><a>Secondary</a></li>
      </ul>

      <div id="screen-div" class="screen-tab">
        <div id="tool-cursor">
          <div id="crosshair-vert"></div>
          <div id="crosshair-horz"></div>
          <image id="cursor-image"></img>
        </div>
        <canvas tabindex="-1" id="paint-canvas" width="560px" height="384px" style="image-rendering: pixelated"></canvas>
      </div>
    </div>
    <div id="color-xy">
      <div id="color-palette"></div>
      <div id="xy-palette">
        <div class="coord"></div>
      </div>
    </div>
  </div>`

export class DisplayView {
  public topDiv: HTMLDivElement
  private machineDisplay: IMachineDisplay
  private machineInput?: IMachineInput
  private displayMode: string
  private showPageTabs: boolean
  private showAppleView: boolean
  private allowToggleEdit: boolean
  private startInEditMode: boolean
  private displayGrid: HTMLDivElement
  private displayDiv: HTMLDivElement
  private cursorDiv: HTMLDivElement
  private crosshairVert: HTMLDivElement
  private crosshairHorz: HTMLDivElement
  private cursorImage: HTMLImageElement
  private toolPalette: HTMLDivElement
  private colorPalette: HTMLDivElement
  private xyPalette: HTMLDivElement
  private paintCanvas: HTMLCanvasElement
  private paintDisplay: PaintDisplay
  private displaySource: DisplaySource
  private sourceListener?: (source: DisplaySource, isPaged: boolean, pageIndex: number) => void
  private projectName?: string
  private hostHooks?: IHostHooks
  private hasFocus = false
  private isEditing = false
  private leftButtonIsDown = false
  private rightButtonIsDown = false
  private mousePt?: Point
  private lastMousePt?: Point
  private focusClick = false
  private joystick: Joystick
  private lastKey = ""
  private startWidth?: number
  private startHeight?: number
  private editWidth?: number
  private editHeight?: number
  private editTool = Tool.Select
  private tabTool = Tool.Pencil

  private showCrosshairs: boolean = false

  private hoverShortTimerId?: NodeJS.Timeout
  private hoverLongTimerId?: NodeJS.Timeout
  private hoverVisibleDiv?: HTMLElement

  public isGame = false

  constructor(parent: HTMLElement, display: IMachineDisplay, input?: IMachineInput, oldUI = false) {

    this.machineDisplay = display
    this.machineInput = input
    this.displayMode = this.machineDisplay.getDisplayMode() ?? ""

    // TODO: base these on something real
    this.showPageTabs = oldUI && (input != undefined)
    this.showAppleView = !oldUI && (input != undefined)
    this.allowToggleEdit = (input != undefined) // (project != undefined)
    this.startInEditMode = (input == undefined) // (project == undefined)

    this.topDiv = <HTMLDivElement>document.createElement("div")
    // TODO: there's security issue with doing this within a VSCode webview
    this.topDiv.innerHTML = displayTemplate
    parent.appendChild(this.topDiv)

    this.displayGrid = <HTMLDivElement>this.topDiv.querySelector("#display-grid")
    const screenDiv = <HTMLDivElement>this.displayGrid.querySelector("#screen-div")

    const resizeObserver = new ResizeObserver(() => {
      // TODO: get padding values from somewhere
      this.onResize(screenDiv.clientWidth - 8, screenDiv.clientHeight - 8)
    })
    resizeObserver.observe(screenDiv)

    this.cursorDiv = <HTMLDivElement>screenDiv.querySelector("#tool-cursor")
    this.crosshairVert = <HTMLDivElement>screenDiv.querySelector("#crosshair-vert")
    this.crosshairHorz = <HTMLDivElement>screenDiv.querySelector("#crosshair-horz")
    this.cursorImage = <HTMLImageElement>screenDiv.querySelector("#cursor-image")

    this.displayDiv = <HTMLDivElement>this.displayGrid.querySelector("#display-div")
    this.paintCanvas = <HTMLCanvasElement>this.displayDiv.querySelector("#paint-canvas")
    this.paintDisplay = new PaintDisplay(this.displayMode, this.paintCanvas, this.machineDisplay)

    // TODO: clean all this up
    this.toolPalette = <HTMLDivElement>this.displayGrid.querySelector("#tool-palette")
    this.colorPalette = <HTMLDivElement>this.displayGrid.querySelector("#color-palette")
    this.xyPalette = <HTMLDivElement>this.displayGrid.querySelector("#xy-palette")

    if (this.showPageTabs || this.showAppleView) {
      this.displaySource = DisplaySource.Active
    } else {
      this.displaySource = DisplaySource.Primary
    }

    if (!this.showPageTabs) {
      const list = <HTMLElement>this.displayDiv.querySelector(".tabs-list")
      list.style.display = "none"

      // TODO: replace these hacks to clean up margin when screen tabs are hidden
      //  with real css classes
      this.toolPalette.style.marginTop = "4px"
      this.displayGrid.style.marginLeft = "0px"
      const screenTabs = <HTMLDivElement>this.displayGrid.querySelector(".screen-tabs")
      screenTabs.style.marginTop = "4px"
    }

    // Chrome doesn't support oncopy/onpaste of canvas elements
    //  so manually redirect here

    document.oncut = (e: ClipboardEvent) => {
      if (document.activeElement) {
        let element: HTMLElement = document.activeElement as HTMLElement
        if (element && element.oncut) {
          element.oncut(e)
        }
      }
    }

    document.oncopy = (e: ClipboardEvent) => {
      if (document.activeElement) {
        let element: HTMLElement = document.activeElement as HTMLElement
        if (element && element.oncopy) {
          element.oncopy(e)
        }
      }
    }

    document.onpaste = (e: ClipboardEvent) => {
      if (document.activeElement) {
        let element: HTMLElement = document.activeElement as HTMLElement
        if (element && element.onpaste) {
          element.onpaste(e)
        }
      }
    }

    // NOTE: if this changes, update prepareDisplay too
    document.onselectstart = (e: Event) => {
      if (document.activeElement == this.paintCanvas) {
        if (this.isEditing) {
          this.paintDisplay.selectAll(false)
        }
      }
    }

    document.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key == "F5" && !e.shiftKey && !e.ctrlKey) {
        this.paintCanvas.focus()
      }
    })

    this.prepareDisplay()

    if (this.showPageTabs) {
      for (let source = 0; source < 4; source += 1) {
        const liElement = <HTMLLIElement>this.displayDiv.querySelector("#li" + source)
        liElement.onmousedown = () => {
          for (let j = 0; j < 4; j += 1) {
            const liElement = <HTMLLIElement>this.displayDiv.querySelector("#li" + j)
            liElement.className = j == source ? "active" : ""
          }
          this.setDisplaySource(source)
        }
      }
    }

    if (this.startInEditMode) {
      this.toggleEditMode()
      // force this once to initialize xy-palette contents
      this.onToolRectChanged()
    }

    this.joystick = { x0: 0, y0: 0, button0: false, button1: false }
  }

  private updateCursor(modifierKeys: number, cursor?: Cursor) {
    if (!this.mousePt || this.mousePt.x < 0 || this.mousePt.y < 0) {
      cursor = Cursor.None
    }
    if (cursor === undefined) {
      cursor = this.paintDisplay.chooseCursor(this.mousePt!, modifierKeys)
    }
    if (cursor == Cursor.None) {
      this.cursorDiv.style.display = "none"
      this.paintCanvas.style.cursor = "default"
    } else {
      this.cursorDiv.style.display = "block"
      this.paintCanvas.style.cursor = "none"
      const rect = this.paintCanvas.getBoundingClientRect()
      const origin = ToolCursorOrigins[cursor]
      this.cursorDiv.style.left = `${rect.left + this.mousePt!.x + 2 - origin.x}px`
      this.cursorDiv.style.top = `${rect.top + this.mousePt!.y + 2 - origin.y}px`
      this.cursorDiv.style.width = "18px"
      this.cursorDiv.style.height = "18px"
      this.cursorImage.src = ToolCursorNames[cursor]
      if (this.showCrosshairs) {
        const crossRect: Rect = {
          x: -this.mousePt!.x + origin.x,
          y: -this.mousePt!.y + origin.y,
          width: rect.width,
          height: rect.height
        }
        this.crosshairHorz.style.left = `${crossRect.x}px`
        this.crosshairHorz.style.right = `${crossRect.x + crossRect.width}px`
        this.crosshairHorz.style.top = `${origin.y}px`
        this.crosshairHorz.style.width = `${crossRect.width - 4}px`
        this.crosshairVert.style.left = `${origin.x}px`
        this.crosshairVert.style.top = `${crossRect.y}px`
        this.crosshairVert.style.height = `${crossRect.height - 4}px`
        this.crosshairHorz.style.visibility = "visible"
        this.crosshairVert.style.visibility = "visible"
      } else {
        this.crosshairHorz.style.visibility = "hidden"
        this.crosshairVert.style.visibility = "hidden"
      }
    }
  }

  public setHostHooks(hostHooks: IHostHooks) {
    this.hostHooks = hostHooks
    this.paintDisplay.setHostHooks(hostHooks)
  }

  public undo() {
    this.paintDisplay.undo()
  }

  public redo() {
    this.paintDisplay.redo()
  }

  public revertUndo(index: number) {
    this.paintDisplay.revertUndo(index)
  }

  private canvasFromClient(e: PointerEvent): Point {
    const canvas = <HTMLCanvasElement>e.target
    const rect = canvas.getBoundingClientRect()
    // TODO: eliminate these hard-coded values
    const padding = 0
    const border = 4
    let canvasPt: Point = {
      x: e.clientX - rect.left - padding - border,
      y: e.clientY - rect.top - padding - border
    }
    return canvasPt
  }

  loadSettings(projectName: string) {
    this.projectName = projectName
    this.isGame = projectName.toLowerCase().indexOf("naja") != -1
  }

  onResize(width: number, height: number) {
    this.paintDisplay.resizeDisplay(width, height)
  }

  public focus() {
    this.paintCanvas.focus()
  }

  //--------------------------------------------------------
  // joystick support
  //--------------------------------------------------------

  private resetJoystick() {
    // choose initial joystickPt based entering location in canvas
    // TODO: just use initial mouse point, scaled?
    // TODO: don't use constants here
    this.joystick.x0 = (this.mousePt?.x ?? 0) < 280 ? 0 : 255
    this.joystick.y0 = (this.mousePt?.y ?? 0) < 192 ? 0 : 255
    this.joystick.button0 = false
    this.joystick.button1 = false
  }

  private updateJoystick() {
    if (!this.mousePt || !this.lastMousePt) {
      return
    }
    this.joystick.x0 += (this.mousePt.x - this.lastMousePt.x)
    if (this.joystick.x0 < 0) {
      this.joystick.x0 = 0
    } else if (this.joystick.x0 > 255) {
      this.joystick.x0 = 255
    }
    this.joystick.y0 += (this.mousePt.y - this.lastMousePt.y)
    if (this.joystick.y0 < 0) {
      this.joystick.y0 = 0
    } else if (this.joystick.y0 > 255) {
      this.joystick.y0 = 255
    }
    this.machineInput?.setJoystickValues(this.joystick)
  }

  //--------------------------------------------------------
  // display source and paging UI support
  //--------------------------------------------------------

  public nextDisplaySource(reverse: boolean) {
    if (this.isPagedFormat()) {
      let nextSource: number
      if (reverse) {
        nextSource = (this.displaySource - 1) & 3
      } else {
        nextSource = (this.displaySource + 1) & 3
      }
      this.setDisplaySource(nextSource)
    }
  }

  public setDisplaySource(displaySource: DisplaySource) {
    this.displaySource = displaySource
    this.callSourceListener()
    this.update()
    this.paintCanvas.focus()
  }

  public setSourceListener(listener: (source: DisplaySource, isPaged: boolean, pageIndex: number) => void) {
    this.sourceListener = listener
    this.callSourceListener()
  }

  private callSourceListener() {
    if (this.sourceListener) {
      this.sourceListener(this.displaySource, this.isPagedFormat(), this.getPageIndex())
    }
  }

  private isPagedFormat(): boolean {
    const formatName = this.paintDisplay.format.name
    return formatName == "text40" ||
      formatName.startsWith("lores") ||
      formatName.startsWith("hires")
  }

  public getPageIndex(): number {
    if (this.displaySource == DisplaySource.Primary) {
      return 0
    } else if (this.displaySource == DisplaySource.Secondary) {
      return 1
    } else if (this.displaySource == DisplaySource.Visible) {
      return this.machineDisplay.getVisibleDisplayPage() ?? 0
    } else if (this.displaySource == DisplaySource.Active) {
      return this.machineDisplay.getActiveDisplayPage() ?? 0
    } else {
      return 0
    }
  }

  //--------------------------------------------------------

  private setTool(toolIndex: Tool, modifiers = 0, doubleClick = false) {
    this.paintDisplay.setTool(toolIndex, modifiers, doubleClick)
  }

  private onToolChanged(oldToolIndex: Tool, newToolIndex: Tool, modifiers: number) {

    const oldToolButton = <HTMLButtonElement>this.toolPalette.querySelector("#tool" + oldToolIndex)
    oldToolButton?.classList.remove("active")

    const newToolButton = <HTMLButtonElement>this.toolPalette.querySelector("#tool" + newToolIndex)
    newToolButton?.classList.add("active")

    this.updateCursor(modifiers)
  }

  private getTool(): Tool {
    return this.paintDisplay.getTool()
  }

  private setForeColor(colorIndex: number) {
    this.paintDisplay.setForeColor(colorIndex)
  }

  private setBackColor(colorIndex: number) {
    this.paintDisplay.setBackColor(colorIndex)
  }

  private onColorChanged(oldColor: number, newColor: number, isBack: boolean) {
    const activeClass = isBack ? "active-back" : "active-fore"
    const oldColorButton = <HTMLButtonElement>this.colorPalette.querySelector("#clr" + oldColor)
    oldColorButton?.classList.remove(activeClass)
    const newColorButton = <HTMLButtonElement>this.colorPalette.querySelector("#clr" + newColor)
    newColorButton?.classList.add(activeClass)
  }

  private getForeColor(): number {
    return this.paintDisplay.getForeColor()
  }

  public toggleEditMode(): boolean {
    this.isEditing = !this.isEditing
    if (this.isEditing) {
      this.paintCanvas.focus()
    }

    const screenDiv = <HTMLDivElement>this.displayGrid.querySelector("#screen-div")

    if (this.isEditing) {
      if (this.startWidth == undefined) {
        this.startWidth = screenDiv.clientWidth
        this.startHeight = screenDiv.clientHeight
      }
      if (this.editWidth == undefined) {
        this.editWidth = screenDiv.clientWidth
        this.editHeight = screenDiv.clientHeight
      }
    } else {
      this.editWidth = screenDiv.clientWidth
      this.editHeight = screenDiv.clientHeight
    }

    screenDiv.style.width = (this.isEditing ? this.editWidth : this.startWidth) + "px"
    screenDiv.style.height = (this.isEditing ? this.editHeight : this.startHeight) + "px"
    screenDiv.style.resize = this.isEditing ? "both" : "none"

    // TODO: add/remove on classList
    this.displayGrid.className = this.isEditing ? "editing" : ""
    this.toolPalette.className = this.isEditing ? "visible" : ""
    this.colorPalette.className = this.isEditing ? "visible" : ""
    this.xyPalette.className = this.isEditing ? "visible" : ""

    if (this.isEditing) {
      this.setTool(this.editTool)
      this.updateCursor(0)
    } else {
      this.editTool = this.getTool()
      this.updateCursor(0, Cursor.None)

      const displaySize = this.paintDisplay.format.displaySize
      this.paintDisplay.resizeDisplay(displaySize.width, displaySize.height)
      this.paintDisplay.setZoomLevel(0, this.mousePt)
      this.paintDisplay.selectNone()
    }

    return this.isEditing
  }

  update() {

    if (this.showPageTabs) {
      for (let i = 0; i < 2; i += 1) {
        let liElement = <HTMLLIElement>this.displayDiv.querySelector("#li" + i)
        let anchorElement = <HTMLAnchorElement>liElement.children[0]
        let liText = anchorElement.innerHTML
        if (liText.endsWith(")")) {
          liText = liText.substring(0, liText.length - 3)
        }
        if (i == 0) {
          let activePage = this.machineDisplay?.getActiveDisplayPage() ?? 0
          anchorElement.innerHTML = liText + `(${1 + activePage})`
        } else {
          let visiblePage = this.machineDisplay?.getVisibleDisplayPage() ?? 0
          anchorElement.innerHTML = liText + `(${1 + visiblePage})`
        }
      }
    }

    const newDisplayMode = this.machineDisplay.getDisplayMode() ?? ""
    if (newDisplayMode != this.displayMode) {
      this.displayMode = newDisplayMode
      const prevTool = this.paintDisplay.getTool()
      this.paintDisplay = new PaintDisplay(newDisplayMode, this.paintCanvas, this.machineDisplay)
      this.prepareDisplay()
      this.paintDisplay.setTool(prevTool)
    }
    this.paintDisplay.setPageIndex(this.getPageIndex())
    this.paintDisplay.updateFromMemory()
    this.callSourceListener()
  }

  private onToolRectChanged() {
    if (this.isEditing) {
      this.updateCoordinateInfo()
    } else {
      this.xyPalette.innerHTML = ""
    }
  }

  private updateCoordinateInfo(canvasPt?: Point) {
    const result = this.paintDisplay.getCoordinateInfo(canvasPt)
    if (!result.start) {
      this.xyPalette.innerHTML = ""
      return
    }

    const x1 = result.start.x
    const y1 = result.start.y
    const width = result.size?.width ?? 0
    const height = result.size?.height ?? 0

    let str = ""

    if (this.isGame && this.paintDisplay.format.name.startsWith("hires") && this.getTool() == Tool.Select) {
      str = `PictMoveTo ${x1};${y1}`
      if (result.size && (width != 0 || height != 0)) {
        const x2 = x1 + width
        const y2 = y1 + height
        str += "<br>"
        str += `PictRect ${x1.toString()};${y1.toString()};${(x2 - 1).toString()};${(y2 - 1).toString()}`
        const xb1 = Math.floor(x1 / 7)
        const xb2 = Math.floor((x2 + 6) / 7)
        str += "<br>"
        str += `PictClear ${xb1.toString()};${y1.toString()};${xb2.toString()};${y2.toString()}`
      }
    } else {
      if (result.end) {
        str = `X1: ${x1}, Y1: ${y1}`
        str += `<br>X2: ${result.end.x}, Y2: ${result.end.y}`
        if (result.size) {
          str += `<br>W: ${result.size.width}, H: ${result.size.height}`
        }
      } else {
        if (result.size && width && height) {
          str = `X1: ${x1}, Y1: ${y1}`
          str += `<br>X2: ${x1 + result.size.width - 1}, Y2: ${y1 + result.size.height - 1}`
          str += `<br>W: ${result.size.width}, H: ${result.size.height}`
        } else {
          str = `X: ${x1}, Y: ${y1}`
        }
      }
    }

    if (!result.end && width == 0 && height == 0) {
      const frameSize = this.paintDisplay.format.frameSize
      if (y1 >= 0 && y1 < frameSize.height && x1 >= 0 && x1 < frameSize.width) {
        let suffix = ""
        let address = this.paintDisplay.format.calcAddress(x1, y1, this.getPageIndex())
        const byteColumn = this.paintDisplay.format.calcByteColumn(x1)
        const formatName = this.paintDisplay.format.name
        if (formatName.startsWith("dlores") || formatName.startsWith("dhires")) {
          if (address >= 0x10000) {
            suffix = " aux"
            address -= 0x10000
          } else {
            suffix = " main"
          }
        }
        str += `<br>Address: $${address.toString(16).toUpperCase()}` + suffix
        str += `<br>Column:\xa0\xa0${byteColumn}`
      }
    }

    this.xyPalette.innerHTML = str
  }

  //----------------------------------------------------------------------------

  private setHoverElement(parent: HTMLElement, child: HTMLElement) {

    child.classList.add("help")

    parent.addEventListener("mousedown", () => {
      // clear long timer
      if (this.hoverLongTimerId) {
        clearTimeout(this.hoverLongTimerId)
        this.hoverLongTimerId = undefined
      }
      // clear short timer
      if (this.hoverShortTimerId) {
        clearTimeout(this.hoverShortTimerId)
        this.hoverShortTimerId = undefined
      }
      // hide div
      if (this.hoverVisibleDiv) {
        this.hoverVisibleDiv.style.visibility = "hidden"
        this.hoverVisibleDiv.style.opacity = "0"
        this.hoverVisibleDiv = undefined
      }
    })

    parent.addEventListener("pointerenter", () => {
      // clear long timer
      if (this.hoverLongTimerId) {
        clearTimeout(this.hoverLongTimerId)
        this.hoverLongTimerId = undefined
      }
      if (this.hoverShortTimerId) {
        clearTimeout(this.hoverShortTimerId)
        this.hoverShortTimerId = undefined
        // show hover div
        this.hoverVisibleDiv = child
        this.hoverVisibleDiv.style.visibility = "visible"
        this.hoverVisibleDiv.style.opacity = "1"
        return
      }
      // set long timer
      this.hoverLongTimerId = setTimeout(() => {
        // show hover div
        this.hoverVisibleDiv = child
        this.hoverVisibleDiv.style.visibility = "visible"
        this.hoverVisibleDiv.style.opacity = "1"
      }, 1000)
    })

    parent.addEventListener("pointerleave", () => {
      // clear long timer
      if (this.hoverLongTimerId) {
        clearTimeout(this.hoverLongTimerId)
        this.hoverLongTimerId = undefined
      }
      // if hover div visible
      if (this.hoverVisibleDiv) {
        // hide it
        this.hoverVisibleDiv.style.visibility = "hidden"
        this.hoverVisibleDiv.style.opacity = "0"
        this.hoverVisibleDiv = undefined
        // start short timer
        this.hoverShortTimerId = setTimeout(() => {
          // clear short timer
          this.hoverShortTimerId = undefined
        }, 100)
      }
    })
  }

  private prepareDisplay() {

    // build tool palette

    this.toolPalette.innerHTML = ""

    for (let i = 0; i < ToolIconNames.length; i += 1) {

      const toolButton = document.createElement("div")
      toolButton.classList.add("tool-btn")
      toolButton.id = "tool" + i
      toolButton.style.gridRow = `${Math.floor(i / 2) + 1}`
      toolButton.style.gridColumn = `${(i % 2) + 1}`

      const toolHelp = document.createElement("div")
      toolHelp.innerHTML = ToolHelp[i]
      toolHelp.classList.add("tool-help")
      toolButton.appendChild(toolHelp)

      const toolIcon = document.createElement("img")
      toolIcon.className = "tool-img"
      toolIcon.src = ToolIconNames[i]
      toolButton.appendChild(toolIcon)

      this.setHoverElement(toolButton, toolHelp)

      toolButton.onmousedown = (e: MouseEvent) => {
        e.preventDefault()
        this.setTool(i, getModifierKeys(e))
        this.paintCanvas.focus()
      }

      // NOTE: Chrome does not report double-click events if
      //  the control key is down.
      toolButton.ondblclick = (e: MouseEvent) => {
        this.setTool(i, getModifierKeys(e), true)
        this.paintCanvas.focus()
      }

      this.toolPalette.appendChild(toolButton)
    }

    this.toolPalette.onmousedown = (e: MouseEvent) => {
      e.preventDefault()
    }

    // build color palette based on display format

    const colorCount = this.paintDisplay.format.colorCount
    let foreColor = colorCount - 1
    const backColor = 0
    if (this.paintDisplay.format.name == "hires") {
      foreColor = colorCount / 2 - 1
    }
    this.paintDisplay.setForeColor(foreColor)
    this.paintDisplay.setBackColor(backColor)

    this.colorPalette.innerHTML = ""
    for (let i = 0; i < colorCount; i += 1) {

      const colorButton = document.createElement("div")
      colorButton.classList.add("color-btn")
      if (i == foreColor) {
        colorButton.classList.add("active-fore")
      }
      if (i == backColor) {
        colorButton.classList.add("active-back")
      }
      colorButton.id = `clr${i}`
      colorButton.style.gridRow = `${Math.floor(i / 8) + 1}`
      colorButton.style.gridColumn = `${(i % 8) + 1}`

      const colorSwatch = document.createElement("div")
      colorSwatch.classList.add("color-swatch")
      if (colorCount > 8) {
        colorSwatch.classList.add("small")
      }
      colorSwatch.style.backgroundColor = this.paintDisplay.getRgbColorString(i)
      colorButton.appendChild(colorSwatch)

      const colorHelp = document.createElement("div")
      colorHelp.innerHTML = ColorHelp
      colorHelp.classList.add("color-help")
      colorButton.appendChild(colorHelp)

      this.setHoverElement(colorButton, colorHelp)

      this.colorPalette.appendChild(colorButton)

      colorButton.onmousedown = (e: MouseEvent) => {
        e.preventDefault()
        if (e.altKey) {
          this.setBackColor(i)
        } else {
          this.setForeColor(i)
        }
        this.paintCanvas.focus()
      }
    }

    this.colorPalette.onmousedown = (e: MouseEvent) => {
      e.preventDefault()
    }

    document.onselectstart = (e: Event) => {
      if (document.activeElement == this.paintCanvas) {
        if (this.isEditing) {
          this.paintDisplay.selectAll(false)
        }
      }
    }

    // prepare paintDisplay callbacks

    this.paintDisplay.setHostHooks(this.hostHooks)

    this.paintDisplay.onToolChanged = (oldTool: Tool, newTool: Tool, modifiers: number) => {
      this.onToolChanged(oldTool, newTool, modifiers)
    }

    this.paintDisplay.onToolRectChanged = () => {
      this.onToolRectChanged()
    }

    this.paintDisplay.onColorChanged = (oldColor: number, newColor: number, isBack: boolean) => {
      this.onColorChanged(oldColor, newColor, isBack)
    }

    this.paintCanvas.oncut = (e: ClipboardEvent) => {
      this.paintDisplay.cutSelection(0)
    }

    this.paintCanvas.oncopy = (e: ClipboardEvent) => {
      this.paintDisplay.copySelection(0)
    }

    this.paintCanvas.onpaste = (e: ClipboardEvent) => {
      navigator.clipboard.readText().then(clipText => {
        if (this.isEditing) {
          this.paintDisplay.pasteSelection(clipText, this.mousePt)
        }
      })
    }

    this.paintCanvas.onkeydown = (e: KeyboardEvent) => {

      if (!this.isEditing) {
        if (e.key == "Meta") {
          if (e.code == "MetaLeft") {
            this.joystick.button0 = true
          } else if (e.code == "MetaRight") {
            this.joystick.button1 = true
          }
          this.updateJoystick()
        }
      }

      let curKey = e.key.toLowerCase()

      if (e.metaKey && curKey == "e") {
        if (this.allowToggleEdit) {
          this.toggleEditMode()
          e.preventDefault()
        }
        return
      }

      // ignore function keys here
      if (!this.isEditing) {
        if (e.key[0] == "F" && e.key.length > 1) {
          return
        }
      }

      if (!this.isEditing) {
        let appleCode = 0
        if (!e.ctrlKey) {
          let ascii40 = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ\[\\\]\^\_"
          let i = ascii40.indexOf(e.key)
          if (i >= 0) {
            appleCode = 0x40 + i
          } else {
            let ascii60 = "\`abcdefghijklmnopqrstuvwxyz\{\|\}\~"
            let i = ascii60.indexOf(e.key)
            if (i >= 0) {
              appleCode = 0x60 + i
            } else {
              let ascii20 = " \!\"\#\$\%\&\'\(\)\*\+\,\-\.\/0123456789\:\;\<\=\>\?"
              let i = ascii20.indexOf(e.key)
              if (i >= 0) {
                appleCode = 0x20 + i
              }
            }
          }
        }
        if (appleCode == 0) {
          let code = e.which
          if (code < 0x80) {
            if (e.ctrlKey) {
              if (code == 17) {
                code = 0  // ignore control key by itself
              } else {
                // NOTE: assuming lower case supported, so only forcing
                //  to upper case before applying control modifier
                if (code >= 0x61 && code <= 0x7a) {  // 'a' to 'z'
                    code -= 0x20  // 'a' - 'A'
                }
                if (code >= 0x40 && code < 0x60) {
                  code -= 0x40
                }
              }
            } else {
              switch (code) {
                case 37:
                  code = 8    // left arrow
                  break
                case 38:
                  code = 11   // up arrow
                  break
                case 39:
                  code = 21   // right arrow
                  break
                case 40:
                  code = 10   // down arrow
                  break
                case 16:      // shift
                case 18:      // option
                case 20:      // capslock
                  code = 0    // ignore
                  break
              }
            }
            if (e.key != "Meta") {
              appleCode = code
            }
          }
        }

        if (appleCode) {
          this.machineInput?.setKeyCode(appleCode)
          // eat everything (backspace, tab, escape, arrows)
          //  that goes to Apple 2
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }

      // isEditing true after this point

      if (e.metaKey) {
        if (curKey == "x") {
          if (!this.hostHooks) {
            this.paintDisplay.cutSelection(getModifierKeys(e))
            e.preventDefault()
          }
        } else if (curKey == "c") {
          if (!this.hostHooks) {
            this.paintDisplay.copySelection(getModifierKeys(e))
            e.preventDefault()
          }
        } else if (curKey == "v") {
          if (!this.hostHooks) {
            navigator.clipboard.readText().then(clipText => {
              if (this.isEditing) {
                this.paintDisplay.pasteSelection(clipText, this.mousePt)
              }
            })
          }
          e.preventDefault()
        } else if (curKey === "a") {
          // NOTE: do this even if hostHooks is present
          this.paintDisplay.selectAll(e.ctrlKey)
          e.preventDefault()
          e.stopPropagation()
        } else if (curKey === "z") {
          if (!this.hostHooks) {
            if (e.shiftKey) {
              this.paintDisplay.redo()
            } else {
              this.paintDisplay.undo()
            }
            e.preventDefault()
          }
        }
        return
      }

      let direction = -1
      if (e.key == "ArrowUp") {
        direction = 0
      } else if (e.key == "ArrowLeft") {
        direction = 1
      } else if (e.key == "ArrowDown") {
        direction = 2
      } else if (e.key == "ArrowRight") {
        direction = 3
      }
      if (direction >= 0) {
        this.paintDisplay.toolArrow(direction, getModifierKeys(e))
        // stop arrows from scrolling window
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (this.paintDisplay.getTool() == Tool.Text) {
        if (this.paintDisplay.inputText(e)) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }

      if (curKey == "h") {
        if (e.shiftKey) {
          this.paintDisplay.flipSelection(true, false)
        }
      } else if (curKey == "v") {
        if (e.shiftKey) {
          this.paintDisplay.flipSelection(false, true)
        }
      } else if (curKey == "p") {
        if (e.shiftKey) {
          this.paintDisplay.padSelection()
        }
      }

      if (curKey === "c") {
        if (e.shiftKey) {
          this.paintDisplay.copySelection(getModifierKeys(e))
          return
        }
        if (this.lastKey == "") {
          this.lastKey = curKey
          return
        }
      }

      if (this.lastKey === "c") {
        if (curKey == "x") {
          // toggle color between sets
          const foreColor = this.getForeColor()
          const flipValue = Math.floor(this.paintDisplay.format.colorCount / 2)
          this.setForeColor(foreColor ^ flipValue)
          this.lastKey = ""
          return
        }
      }

      let n = parseInt(curKey)
      if (n >= 1 && n <= 8) {
        // map 1,..,8 into levels 0,..,7
        n = Math.min(Math.max(n - 1, 0), this.paintDisplay.zoomMaxLevel)
        this.paintDisplay.setZoomLevel(n, this.mousePt)
        this.lastKey = ""
        return
      }

      if (curKey == "backspace") {
        this.paintDisplay.clearSelection(getModifierKeys(e))
        // TODO: possibly update cursor
      } else if (curKey == "s") {
        this.setTool(Tool.Select)
      } else if (curKey == "l") {
        this.setTool(Tool.Lasso)
      } else if (curKey == "t") {
        if (e.shiftKey) {
          this.paintDisplay.toggleTransparency()
        } else {
          this.setTool(Tool.Text)
        }
      } else if (curKey == "z") {
        this.setTool(Tool.Zoom)
      } else if (curKey == "e") {
        this.setTool(Tool.Eraser)
      } else if (curKey == "f") {
        this.setTool(Tool.Bucket)
      } else if (curKey == "tab") {
        if (this.getTool() == Tool.Dropper) {
          this.setTool(this.tabTool)
        } else {
          this.tabTool = this.getTool()
          this.setTool(Tool.Dropper)
        }
        e.preventDefault()
      } else if (curKey == "b") {
        this.setTool(Tool.Brush)
      } else if (curKey == ".") {
        this.setTool(Tool.Pencil)
      } else if (curKey == "/") {
        this.setTool(Tool.Line)
      } else if (curKey == "r") {
        if (e.shiftKey) {
          this.setTool(Tool.FrameRect)
        } else {
          this.setTool(Tool.FillRect)
        }
      } else if (curKey == "o") {
        if (e.shiftKey) {
          this.setTool(Tool.FrameOval)
        } else {
          this.setTool(Tool.FillOval)
        }
      } else if (curKey == "g") {
        this.paintDisplay.toggleGrid()
      } else if (curKey == "x") {
        if (e.shiftKey) {
          this.paintDisplay.xorSelection()
        } else {
          this.paintDisplay.xorFrame()
        }
      } else if (curKey == "!") {
        this.paintDisplay.optimize()
      } else if (curKey == "+") {
        this.showCrosshairs = !this.showCrosshairs
      }

      this.lastKey = ""
      this.updateCursor(getModifierKeys(e))
    }

    this.paintCanvas.onkeyup = (e: KeyboardEvent) => {
      if (!this.isEditing) {
        if (e.key == "Meta") {
          if (e.code == "MetaLeft") {
            this.joystick.button0 = false
          } else if (e.code == "MetaRight") {
            this.joystick.button1 = false
          }
          if (this.mousePt) {
            this.updateJoystick()
          }
        }
      } else {
        this.updateCursor(getModifierKeys(e))
      }
    }

    this.paintCanvas.onwheel = (e: WheelEvent) => {
      const delta: Point = { x: e.deltaX, y: e.deltaY }
      this.paintDisplay.scroll(this.mousePt ?? {x: 0, y: 0}, delta, getModifierKeys(e))
      e.preventDefault()
    }

    this.paintCanvas.onfocus = (e: FocusEvent) => {
      this.hasFocus = true
      if (!this.isEditing) {
        this.paintCanvas.style.cursor = "none"
      }
    }

    this.paintCanvas.onblur = (e: FocusEvent) => {
      this.hasFocus = false
      if (!this.isEditing) {
        this.paintCanvas.style.cursor = "default"
      }
    }

    this.paintCanvas.onpointerenter = (e: PointerEvent) => {
      this.mousePt = this.canvasFromClient(e)
      this.lastMousePt = this.mousePt
      if (this.isEditing) {
        this.updateCursor(getModifierKeys(e))
        this.updateCoordinateInfo(this.mousePt)
      } else {
        if (this.hasFocus) {
          this.resetJoystick()
        }
      }
    }

    this.paintCanvas.onpointerdown = (e: PointerEvent) => {
      this.lastMousePt = this.mousePt
      this.mousePt = this.canvasFromClient(e)
      // ignore click that puts element into focus
      if (!this.hasFocus) {
        this.focusClick = true
        if (!this.isEditing) {
          this.resetJoystick()
        }
        return
      }

      this.focusClick = false
      if (e.which == 1) {
        this.paintCanvas.setPointerCapture(e.pointerId)
        this.leftButtonIsDown = true
        this.joystick.button0 = true
        if (this.isEditing) {
          this.paintDisplay.toolDown(this.mousePt, getModifierKeys(e))
        }
      } else if (e.which == 3) {
        this.paintCanvas.setPointerCapture(e.pointerId)
        this.rightButtonIsDown = true
        this.joystick.button1 = true
        // if (this.isEditing) {
        //   this.paintDisplay.toolRightDown(this.mousePt, getModifierKeys(e))
        // }
      }
      if (this.isEditing) {
        this.updateCursor(getModifierKeys(e))
      } else {
        this.updateJoystick()
      }
    }

    this.paintCanvas.oncontextmenu = (e: MouseEvent) => {
      // suppress all right-click context menus
      return false
    }

    this.paintCanvas.onpointermove = (e: PointerEvent) => {
      this.lastMousePt = this.mousePt
      this.mousePt = this.canvasFromClient(e)
      if (this.isEditing) {
        this.updateCursor(getModifierKeys(e))
        this.updateCoordinateInfo(this.mousePt)
        if (this.leftButtonIsDown) {
          this.paintDisplay.toolMove(this.mousePt, getModifierKeys(e))
        // } else if (this.rightButtonIsDown) {
        //   this.paintDisplay.toolRightMove(this.mousePt, getModifierKeys(e))
        }
      } else {
        if (this.hasFocus) {
          this.updateJoystick()
        }
      }
    }

    this.paintCanvas.onpointerup = (e: PointerEvent) => {
      if (this.focusClick) {
        return
      }
      this.lastMousePt = this.mousePt
      this.mousePt = this.canvasFromClient(e)
      if (e.which == 1) {
        this.paintCanvas.releasePointerCapture(e.pointerId)
        this.leftButtonIsDown = false
        this.joystick.button0 = false
        if (this.isEditing) {
          this.paintDisplay.toolUp(this.mousePt, getModifierKeys(e))
        }
      } else if (e.which == 3) {
        this.paintCanvas.releasePointerCapture(e.pointerId)
        this.rightButtonIsDown = false
        this.joystick.button1 = false
        // if (this.isEditing) {
        //   this.paintDisplay.toolRightUp(this.mousePt, getModifierKeys(e))
        // }
      }
      if (this.isEditing) {
        this.updateCursor(getModifierKeys(e))
      } else if (this.hasFocus) {
        this.updateJoystick()
      }
    }

    this.paintCanvas.onpointerleave = (e: PointerEvent) => {
      this.leftButtonIsDown = false
      this.rightButtonIsDown = false
      this.joystick.button0 = false
      this.joystick.button1 = false
      if (this.isEditing) {
        this.mousePt = undefined
        this.lastMousePt = undefined
        this.updateCursor(0, Cursor.None)
        this.updateCoordinateInfo()
      } else {
        if (this.hasFocus) {
          this.updateJoystick()
        }
      }
    }

  } // end of prepareDisplay

  //----------------------------------------------------------------------------
}
