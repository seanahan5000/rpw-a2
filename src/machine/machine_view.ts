
import { Machine } from "./machine"
import { DisplayView } from "../display/display_view"

//------------------------------------------------------------------------------

// https://www.svgrepo.com/collection/adwaita-tiny-circular-icons
export const IconImages: string[] = [
  require("../../media/icon-reboot.svg"),
  require("../../media/icon-speaker-off.svg"),
  require("../../media/icon-speaker-on.svg"),
  require("../../media/icon-screenshot.svg"),
  require("../../media/icon-paint.svg"),
  require("../../media/icon-pause.svg"),
  require("../../media/icon-resume.svg"),
  require("../../media/icon-previous.svg"),
  require("../../media/icon-next.svg")
]

//------------------------------------------------------------------------------
// MARK: Icon

export class IconView {

  protected machine: Machine
  protected displayView: DisplayView

  public iconDiv: HTMLDivElement
  protected iconImage: HTMLImageElement
  protected iconHelp: HTMLDivElement

  constructor(protected machineView: MachineView) {

    this.machine = machineView.machine
    this.displayView = machineView.displayView

    this.iconDiv = <HTMLDivElement>document.createElement("div")
    this.iconDiv.classList.add("machine-icon")
    this.machineView.topDiv.appendChild(this.iconDiv)

    this.iconImage = <HTMLImageElement>document.createElement("img")
    this.iconDiv.appendChild(this.iconImage)

    this.iconHelp = document.createElement("div")
    this.iconHelp.classList.add("machine-help")

    this.iconDiv.appendChild(this.iconHelp)
    this.machineView.setHoverElement(this.iconDiv, this.iconHelp)

    this.iconDiv.addEventListener("pointerenter", () => {
      if (!this.iconDiv.classList.contains("drag")) {
        this.iconDiv.classList.add("hilite")
      }
    })

    this.iconDiv.addEventListener("pointerleave", () => {
      this.iconDiv.classList.remove("hilite")
    })
  }

  protected enableDragAndDrop(id: number) {

    this.iconDiv.addEventListener("dragenter", (e: DragEvent) => {
      e.preventDefault()
      this.iconDiv.classList.add("drag")
    })

    this.iconDiv.addEventListener("dragover", (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      this.iconDiv.classList.add("drag")
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "link"
      }
    })

    this.iconDiv.addEventListener("dragleave", (e: DragEvent) => {
      this.iconDiv.classList.remove("drag")
    })

    this.iconDiv.addEventListener("dragend", (e: DragEvent) => {
      this.iconDiv.classList.remove("drag")
    })

    this.iconDiv.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault()
      this.iconDiv.classList.remove("drag")
      this.onDrop(id, e)
    })
  }

  protected async onDrop(id: number, e: DragEvent) {
    this.machineView.displayView.focus()
  }
}

//------------------------------------------------------------------------------
// MARK: Snapshot

export class SnapshotIconView extends IconView {

  constructor(machineView: MachineView) {
    super(machineView)

    this.iconDiv.addEventListener("mousedown", async (e: MouseEvent) => {
      e.preventDefault()

      const pngBlob = await this.displayView.takeSnapshot()
      const pngUrl = URL.createObjectURL(pngBlob)
      const a = document.createElement('a')
      a.href = pngUrl
      a.download = "screenshot.png"
      a.click()
      setTimeout(() => URL.revokeObjectURL(pngUrl), 1500)

      this.displayView.focus()
    })

    this.iconImage.src = IconImages[3]
    this.iconHelp.textContent = "Snapshot display as .png"
  }
}

//------------------------------------------------------------------------------
// MARK: Sound

export class SoundIconView extends IconView {

  constructor(machineView: MachineView) {
    super(machineView)

    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault()
      this.machine.soundEnabled = !this.machine.soundEnabled
      this.iconImage.src = IconImages[this.machine.soundEnabled ? 2 : 1]
      this.displayView.focus()
    })

    this.iconImage.src = IconImages[1]
    this.iconHelp.textContent = "Enable/disable sound output"
  }
}

//------------------------------------------------------------------------------
// MARK: Paint

export class PaintIconView extends IconView {

  constructor(machineView: MachineView) {
    super(machineView)

    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault()
      // TODO: call clickHook for snapshot instead?
      // if (machineView.clickHook) {
      //   machineView.clickHook("paint")
      // } else {
        const isEditing = this.displayView.toggleEditMode()
        this.machineView.topDiv.style.marginLeft = isEditing ? "72px" : "0px"
      // }
      this.displayView.focus()
    })
    this.iconImage.src = IconImages[4]
    // this.iconHelp.textContent = "Snapshot screen for editing"
    this.iconHelp.textContent = "Edit display"
  }
}

//------------------------------------------------------------------------------
// MARK: Pause

export class PauseIconView extends IconView {

  constructor(machineView: MachineView) {
    super(machineView)

    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault()
      if (this.machine.clock.isRunning) {
        this.machine.clock.stop("requested")
      } else {
        this.machine.clock.start()
      }
      this.iconImage.src = IconImages[this.machine.clock.isRunning ? 5 : 6]
      this.displayView.focus()
    })

    this.machine.clock.on("start", () => {
      this.iconImage.src = IconImages[5]
      this.displayView.focus()
    })

    this.machine.clock.on("stop", () => {
      this.iconImage.src = IconImages[6]
    })

    this.iconImage.style.scale = "80%"
    this.iconImage.src = IconImages[this.machine.clock.isRunning ? 5 : 6]
    this.iconHelp.textContent = "Pause/resume"
  }
}

//------------------------------------------------------------------------------
// MARK: PrevNext

export class PrevNextIconView extends IconView {

  constructor(machineView: MachineView, index: number) {
    super(machineView)

    const next = (index == 1)
    let firstTimerId: NodeJS.Timeout | undefined
    let repeatTimerId: NodeJS.Timeout | undefined
    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault()
      const largeStep = e.metaKey
      if (this.machine.advanceState(next, largeStep)) {
        this.machine.clock.stop("requested")
      }
      firstTimerId = setTimeout(() => {
        repeatTimerId = setInterval(() => {
          if (this.machine.advanceState(next, largeStep)) {
            this.machine.clock.stop("requested")
          }
        }, 100)
      }, 500)
    })

    this.iconDiv.addEventListener("mouseup", (e: MouseEvent) => {
      clearTimeout(firstTimerId)
      clearInterval(repeatTimerId)
    })

    this.iconImage.src = IconImages[next ? 8 : 7]
    this.updateStepInfo(next)

    this.machine.clock.on("start", () => {
      this.updateStepInfo(next)
    })

    this.machine.clock.on("stop", () => {
      this.updateStepInfo(next)
    })
  }

  private updateStepInfo(forward: boolean) {
    const isRunning = this.machine.clock.isRunning
    let helpText = `${forward ? "Next" : "Previous"} snapshot`
    if (!isRunning) {
      const result = this.machine.getStateInfo()
      if (result.count > 0) {
        helpText += ` [${result.index}/${result.count}]`
      }
    }
    helpText += "<br>(Command key to jump 60)"
    this.iconHelp.innerHTML = helpText
  }
}

//------------------------------------------------------------------------------
// MARK: Machine

export class MachineView {

  public topDiv: HTMLDivElement
  public machine: Machine
  public displayView: DisplayView
  public clickHook?: (type: string) => void

  constructor(
      parent: HTMLElement,
      machine: Machine,
      displayView: DisplayView,
      clickHook?: (type: string) => void) {

    this.machine = machine
    this.displayView = displayView
    this.clickHook = clickHook

    this.topDiv = <HTMLDivElement>document.createElement("div")
    this.topDiv.classList.add("machine-div")
    parent.appendChild(this.topDiv)
  }

  protected addView(view: IconView) {
  }

  public setVisible(visible: boolean) {
    this.topDiv.style.display = visible ? "block" : "none"
  }

  public update(isRunning: boolean) {
    // TODO: update non-drive info
  }

  private hoverShortTimerId?: NodeJS.Timeout
  private hoverLongTimerId?: NodeJS.Timeout
  private hoverVisibleDiv?: HTMLElement

  public setHoverElement(parent: HTMLElement, child: HTMLElement) {

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
      if (parent.classList.contains("drag")) {
        parent.classList.add("hilite")
      }

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
}

//------------------------------------------------------------------------------
