
import { AtariMachine } from "./atari"
import { DisplayView } from "../../display/display_view"
import { MachineView, IconView, IconImages } from "../machine_view"
import * as Views from "../machine_view"

import { Point, Joystick } from "../../shared/types"
import { IInputEventHandler } from "../../shared/types"
import { EmulatorParams, Emulator, Machine } from "../machine"

//------------------------------------------------------------------------------

const AtariIconImages: string[] = [
  require("../../../media/icon-select-up.svg"),
  require("../../../media/icon-select-down.svg"),
  require("../../../media/icon-cart.svg")
]

//------------------------------------------------------------------------------

class AtariView extends MachineView {

  constructor(
      parent: HTMLElement,
      machine: Machine,
      displayView: DisplayView,
      clickHook?: (type: string) => void) {
    super(parent, machine, displayView, clickHook)

    // this.topDiv.classList.add("atari2600")

    this.addView(new RepowerIconView(this))
    this.addView(new CartIconView(this))
    this.addView(new SelectResetIconView(this, 0))
    this.addView(new SelectResetIconView(this, 1))
    this.addView(new Views.PauseIconView(this))
    this.addView(new Views.SoundIconView(this))
    this.addView(new Views.PaintIconView(this))
    this.addView(new Views.SnapshotIconView(this))
    this.addView(new Views.PrevNextIconView(this, 0))
    this.addView(new Views.PrevNextIconView(this, 1))
  }
}

//------------------------------------------------------------------------------

class CartIconView extends IconView {

  constructor(machineView: MachineView) {
    super(machineView)

    this.iconDiv.style.width = "90px"

    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault()
      if (this.machineView.clickHook) {
        this.machineView.clickHook("cart")
      } else {
        this.onCartClick(e)
        this.displayView.focus()
      }
    })

    this.iconImage.src = AtariIconImages[2]
    this.iconHelp.textContent = "(empty)"
    // *** show cart name?
    // *** else, draw name in cart directly

    this.enableDragAndDrop(0)
  }

  override async onDrop(index: number, e: DragEvent) {
    if (e.dataTransfer) {
      for (const item of Array.from(e.dataTransfer.items)) {
        const fsHandle = await (item as any).getAsFileSystemHandle()
        if (fsHandle) {
          const cart = await this.openCartFile(fsHandle)
          if (cart) {
            if (this.machine instanceof AtariMachine) {
              this.machine.setCartImage(cart, true)
            }
            break
          }
        }
      }
    }
  }

  // NOTE: only used for standalone development work in browser
  private async onCartClick(drivee: MouseEvent) {
    let obj: any = (window as any)
    if (obj) {
      if (typeof obj?.showOpenFilePicker === 'function') {
        try {
          const pickerOpts = {
            types: [{
              description: "Carts",
              accept: {
                // TODO: other file types?
                "carts/*": [".a78",".bin"]
              }
            }],
            multiple: false
          }
          const fileList = await obj.showOpenFilePicker(pickerOpts)
          if (fileList.length > 0) {
            const cart = await this.openCartFile(fileList[0])
            if (cart) {
              if (this.machine instanceof AtariMachine) {
                this.machine.setCartImage(cart, true)
              }
              return
            }
          }
        } catch (e) {
          return // cancel
        }
      }
    }
  }

  // handle dragged-and-dropped file
  // *** return cartridge object instead *** (FileCartImage?)
  private async openCartFile(fsHandle: FileSystemHandle): Promise<Uint8Array | undefined> {
    if (fsHandle.kind == "directory") {
      return
    }
    const fileHandle: FileSystemFileHandle = <FileSystemFileHandle>fsHandle
    const fileName: string = fsHandle.name
    let suffix = ""
    const n = fileName.lastIndexOf(".")
    if (n > 0) {
      suffix = fileName.substring(n + 1).toLowerCase()
    }
    // TODO: other file types?
    if (suffix == "a78" || suffix == "bin") {
      const dataBlob = await fileHandle.getFile()
      const dataArray = await dataBlob.arrayBuffer()
      const data = new Uint8Array(dataArray)
      return data
    }
  }
}

//------------------------------------------------------------------------------

class SelectResetIconView extends IconView {

  constructor(machineView: MachineView, index: number) {
    super(machineView)

    this.iconDiv.style.width = "24px"

    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault()
      this.iconImage.src = AtariIconImages[1]
      if (this.machine instanceof AtariMachine) {
        let switches = this.machine.getSwitches()
        switches &= (index == 0) ? ~0x02 : ~0x01
        this.machine.setSwitches(switches)
      }
      this.displayView.focus()
    })

    this.iconDiv.addEventListener("mouseup", (e: MouseEvent) => {
      this.iconImage.src = AtariIconImages[0]
      if (this.machine instanceof AtariMachine) {
        let switches = this.machine.getSwitches()
        switches |= (index == 0) ? 0x02 : 0x01
        this.machine.setSwitches(switches)
      }
    })

    this.iconImage.src = AtariIconImages[0]
    this.iconHelp.textContent = index == 0 ? "Select (F1)" : "Reset (F2)"
  }
}

//------------------------------------------------------------------------------

class RepowerIconView extends IconView {

  constructor(machineView: MachineView) {
    super(machineView)

    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      // NOTE: preventDefault here and below prevent focus change
      e.preventDefault()
      this.machine.reset(false)
      if (!e.ctrlKey) {
        this.machine.clock.start()
      }
      this.displayView.focus()
    })
    this.iconImage.src = IconImages[0]
    this.iconHelp.innerHTML = "Power cycle console<br>(Control key to stop CPU)"
  }
}

//------------------------------------------------------------------------------

export class AtariEmulator extends Emulator {

  private atariMachine!: AtariMachine
  private atariInput!: AtariInput
  private atariView: AtariView

  constructor(
      parent: HTMLElement | undefined,
      params: EmulatorParams,
      clickHook?: (type: string) => void) {

    super(parent, params)

    const displayView = new DisplayView(this.topDiv, this.atariMachine.displayClock, this.atariInput)
    this.machine.setView(displayView)

    this.atariView = new AtariView(this.topDiv, this.atariMachine, displayView, clickHook)
    this.atariView.setVisible(true)

    this.startMachine(params)
  }

  protected createMachine(params: EmulatorParams): Machine {
    this.atariMachine = new AtariMachine()
    this.atariInput = new AtariInput(this.atariMachine)
    return this.atariMachine
  }
}

//------------------------------------------------------------------------------

// Up     Up arrow, Keypad 8              Y
// Down   Down arrow, Keypad 2            H
// Left   Left arrow, Keypad 4            G
// Right  Right arrow, Keypad 6           J
// Fire   Left Control, Space, Keypad 5   F

// Paddle A Turn Left   Left arrow                      G
// Paddle A Turn Right  Right arrow                     J
// Paddle A Fire        Left Control, Space, Keypad 5   F
// Paddle B Turn Left   Up arrow                        Y
// Paddle B Turn Right  Down arrow	                    H
// Paddle B Fire        Right Control, 4	              6

class AtariInput implements IInputEventHandler {

  private mousePt?: Point
  private lastMousePt?: Point

  constructor(private machine: AtariMachine) {
  }

  public setMousePt(mousePt?: Point, lastMousePt?: Point): void {
    this.mousePt = mousePt
    this.lastMousePt = lastMousePt
  }

  public onkeydown(e: KeyboardEvent): void {

    if (e.key[0] == "F" && e.key.length > 1) {
      let switches = this.machine.getSwitches()
      switch (e.key[1]) {
        case "1":   // select
          switches &= ~0x02
          break
        case "2":   // reset
          switches &= ~0x01
          break
        case "3":   // color
          switches |= 0x08
          break
        case "4":   // BW
          switches &= ~0x08
          break
        case "5":   // left difficulty A
          switches &= ~0x40
          break
        case "6":   // left difficulty B
          switches |= 0x40
          break
        case "7":   // right difficulty A
          switches &= ~0x80
          break
        case "8":   // right difficulty B
          switches |= 0x80
          break
        default:
          return
      }
      this.machine.setSwitches(switches)
      e.preventDefault()
      e.stopPropagation()
      return
    }

    if (!e.ctrlKey && !e.metaKey) {
      let joysticks = this.machine.getJoysticks()
      switch (e.key.toLowerCase()) {
        case "arrowup":
          joysticks &= ~0x10
          break
        case "arrowdown":
          joysticks &= ~0x20
          break
        case "arrowleft":
          joysticks &= ~0x40
          break
        case "arrowright":
          joysticks &= ~0x80
          break
        case "z":
          this.machine.setInput(0, 0x7F)
          break
        case "x":
          this.machine.setInput(1, 0x7F)
          break
        case " ":
          this.machine.setInput(4, 0x7F)
          break
        case "y":
          joysticks &= ~0x01
          break
        case "h":
          joysticks &= ~0x02
          break
        case "g":
          joysticks &= ~0x04
          break
        case "j":
          joysticks &= ~0x08
          break
        case "n":
          this.machine.setInput(2, 0x7F)
          break
        case "m":
          this.machine.setInput(3, 0x7F)
          break
        case "f":
          this.machine.setInput(5, 0x7F)
          break
        default:
          return
      }
      this.machine.setJoysticks(joysticks)
      e.preventDefault()
      e.stopPropagation()
    }
  }

  public onkeyup(e: KeyboardEvent): void {

    if (e.key[0] == "F" && e.key.length > 1) {
      let switches = this.machine.getSwitches()
      switch (e.key[1]) {
        case "1":
          switches |= 0x02
          break
        case "2":
          switches |= 0x01
          break
        default:
          return
      }
      this.machine.setSwitches(switches)
      e.preventDefault()
      e.stopPropagation()
      return
    }

    if (!e.ctrlKey && !e.metaKey) {
      let joysticks = this.machine.getJoysticks()
      switch (e.key.toLowerCase()) {
        case "arrowup":
          joysticks |= 0x10
          break
        case "arrowleft":
          joysticks |= 0x40
          break
        case "arrowdown":
          joysticks |= 0x20
          break
        case "arrowright":
          joysticks |= 0x80
          break
        case "z":
          this.machine.setInput(0, 0xFF)
          break
        case "x":
          this.machine.setInput(1, 0xFF)
          break
        case " ":
          this.machine.setInput(4, 0xFF)
          break
        case "y":
          joysticks |= 0x01
          break
        case "g":
          joysticks |= 0x04
          break
        case "h":
          joysticks |= 0x02
          break
        case "j":
          joysticks |= 0x08
          break
        case "n":
          this.machine.setInput(2, 0xFF)
          break
        case "m":
          this.machine.setInput(3, 0xFF)
          break
        case "f":
          this.machine.setInput(5, 0xFF)
          return
      }
      this.machine.setJoysticks(joysticks)
    }
  }

  public onpointerenter(e: PointerEvent, hasFocus: boolean): void {
    if (hasFocus) {
      this.resetJoystick()
    }
  }

  public onpointerdown(e: PointerEvent, reset: boolean): void {
    if (reset) {
      this.resetJoystick()
    } else {
      // if (e.which == 1) {
      //   this.joystick.button0 = true
      // } else if (e.which == 3) {
      //   this.joystick.button1 = true
      // }
      this.updateJoystick()
    }
  }

  public onpointermove(e: PointerEvent, hasFocus: boolean): void {
    if (hasFocus) {
      this.updateJoystick()
    }
  }

  public onpointerup(e: PointerEvent, hasFocus: boolean): void {
    // if (e.which == 1) {
    //   this.joystick.button0 = false
    // } else if (e.which == 3) {
    //   this.joystick.button1 = false
    // }
    if (hasFocus) {
      this.updateJoystick()
    }
  }

  public onpointerleave(e: PointerEvent, hasFocus: boolean): void {
    // this.joystick.button0 = false
    // this.joystick.button1 = false
    if (hasFocus) {
      this.updateJoystick()
    }
  }

  private resetJoystick() {
    // this.joystick.x0 = (this.mousePt?.x ?? 0) < 280 ? 0 : 255
    // this.joystick.y0 = (this.mousePt?.y ?? 0) < 192 ? 0 : 255
    // this.joystick.button0 = false
    // this.joystick.button1 = false
  }

  private updateJoystick() {
    if (!this.mousePt || !this.lastMousePt) {
      return
    }
    // this.joystick.x0 += (this.mousePt.x - this.lastMousePt.x)
    // if (this.joystick.x0 < 0) {
    //   this.joystick.x0 = 0
    // } else if (this.joystick.x0 > 255) {
    //   this.joystick.x0 = 255
    // }
    // this.joystick.y0 += (this.mousePt.y - this.lastMousePt.y)
    // if (this.joystick.y0 < 0) {
    //   this.joystick.y0 = 0
    // } else if (this.joystick.y0 > 255) {
    //   this.joystick.y0 = 255
    // }
    // this.appleMachine.setJoystickValues(this.joystick)
  }
}

//------------------------------------------------------------------------------
