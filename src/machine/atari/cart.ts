
import * as base64 from 'base64-js'
import { IMemory } from "../../shared/types"
import { base64FromUint8 } from "../machine"

//------------------------------------------------------------------------------

export abstract class Cart implements IMemory {

  abstract getMachineType(): string

  // TODO: subclasses will eventually need to
  //  save/restore RAM and bank switch status

  public getState(): any {
    return {}
  }

  public async flattenState(state: any): Promise<void> {
  }

  public setState(state: any): void {
  }

  public abstract readConst(address: number): number
  public abstract read(address: number, cycleCount: number): number
  public abstract write(address: number, value: number, cycleCount: number): void
  public abstract readRange(address: number, length: number): Uint8Array
  public abstract writeRange(address: number, data: Uint8Array | number[]): void
}

//------------------------------------------------------------------------------

class Cart2600 extends Cart {

  private data: Uint8Array
  protected bankOffset: number
  protected bankCount: number

  constructor(data: Uint8Array) {
    super()
    this.bankCount = Math.ceil(data.length / 0x1000)
    this.bankOffset = (this.bankCount - 1) * 0x1000
    const paddedLength = this.bankCount * 0x1000
    this.data = new Uint8Array(paddedLength).fill(0xee)
    this.data.set(data, paddedLength - data.length)
  }

  getMachineType(): string {
    return "atari2600"
  }

  public readConst(address: number): number {
    // TODO: don't bankswitch here
    return this.read(address, 0)
  }

  public read(address: number, cycleCount: number): number {
    address &= 0xfff
    if (cycleCount != 0) {
      this.checkBankSwitches(address)
    }
    address += this.bankOffset
    return this.data[address]
  }

  public write(address: number, value: number, cycleCount: number) {
  }

  public readRange(address: number, length: number): Uint8Array {
    address &= 0xfff
    // *** ignore bank offset? ***
    address += this.bankOffset
    return this.data.subarray(address, address + length)
  }

  public writeRange(address: number, data: Uint8Array | number[]): void {
    address &= 0xfff
    // *** ignore bank offset? ***
    address += this.bankOffset
    this.data.set(data, address)
  }

  protected checkBankSwitches(address: number) {
  }
}

class Cart2600_Fx extends Cart2600 {
  protected switchBase: number

  constructor(data: Uint8Array, switchBase: number) {
    super(data)
    this.switchBase = switchBase
  }

  protected override checkBankSwitches(address: number) {
    if (address >= this.switchBase && address <= 0xff9) {
      this.bankOffset = (address - this.switchBase) * 0x1000
    }
  }
}

class Cart2600_F8 extends Cart2600_Fx {
  constructor(data: Uint8Array) {
    super(data, 0xff8)
  }
}

class Cart2600_F6 extends Cart2600_Fx {
  constructor(data: Uint8Array) {
    super(data, 0xff6)
  }
}

class Cart2600_F4 extends Cart2600_Fx {
  constructor(data: Uint8Array) {
    super(data, 0xff4)
  }
}

function createCart2600(data: Uint8Array): Cart2600 | undefined {
  if (data.length <= 0x1000) {
    return new Cart2600(data)
  }
  if (data.length <= 0x2000) {
    return new Cart2600_F8(data)
  }
  if (data.length <= 0x4000) {
    return new Cart2600_F6(data)
  }
  if (data.length <= 0x8000) {
    return new Cart2600_F4(data)
  }
}

//------------------------------------------------------------------------------

// *** combine with audio channel ***

// do-nothing implemention
class Pokey implements IMemory {

  public readConst(address: number): number {
    return this.read(address, 0)
  }

  public read(address: number, cycleCount: number): number {
    return 0
  }

  public write(address: number, value: number, cycleCount: number) {
    // ***
  }

  public readRange(address: number, length: number): Uint8Array {
    return new Uint8Array()
  }

  public writeRange(address: number, data: Uint8Array | number[]): void {
  }

  public getState(): any {
    let state: any = {}
    // ***
    return state
  }

  public async flattenState(state: any): Promise<void> {
    // nothing to flatten?
  }

  public setState(state: any): void {
    // ***
  }
}

//------------------------------------------------------------------------------

// details found at https://7800.8bitdev.org/index.php/A78_Header_Specification

enum Controller {
  None         = 0,
  Joystick7800 = 1,
  LightGun     = 2,
  Paddle       = 3,
  TrakBall     = 4,
  Joystick2600 = 5,
  Driving2600  = 6,
  Keypad2600   = 7,
  MouseST      = 8,
  MouseAmiga   = 9,
  AtariVox     = 10,
  Snes2Atari   = 11,
  Mega7800     = 12
}

enum Cart7800Type {
  ROM         = 0,
  Pokey       = 1,
  SuperGame   = 2,
  SG_Pokey    = 3,
  SG_RAM      = 4,
  SG9         = 5,
  MRAM        = 6,
  Absolute    = 7,
  Activision  = 8,
  HSC         = 9,
  XBoard      = 10,
  XM          = 11,
  MegaCart    = 12,
  VersaBoard  = 0x10,

  P450_Pokey  = 0x20,

  // P450        = 14,
  // P450_Pokey  = 15,
  // P450_SG_RAM = 16,
  // P450_SG9    = 17,
  // P450_VB     = 18
}

// #define A78_POKEY0450 0x20

// // Here, we take the feature attribute from .xml (i.e. the PCB name) and we assign a unique ID to it
// static const a78_slot slot_list[] =
// {
// 	{ A78_TYPE0,      "a78_rom" },
// 	{ A78_TYPE1,      "a78_pokey" },
// 	{ A78_TYPE2,      "a78_sg" },
// 	{ A78_TYPE3,      "a78_sg_pokey" },
// 	{ A78_TYPE6,      "a78_sg_ram" },
// 	{ A78_TYPEA,      "a78_sg9" },
// 	{ A78_TYPE8,      "a78_mram" },
// 	{ A78_ABSOLUTE,   "a78_abs" },
// 	{ A78_ACTIVISION, "a78_act" },
// 	{ A78_HSC,        "a78_hsc" },
// 	{ A78_XB_BOARD,   "a78_xboard" },
// 	{ A78_XM_BOARD,   "a78_xm" },
// 	{ A78_MEGACART,   "a78_megacart" },
// 	{ A78_VERSABOARD, "a78_versa" },
// 	{ A78_TYPE0_POK450, "a78_p450_t0" },
// 	{ A78_TYPE1_POK450, "a78_p450_t1" },
// 	{ A78_TYPE6_POK450, "a78_p450_t6" },
// 	{ A78_TYPEA_POK450, "a78_p450_ta" },
// 	{ A78_VERSA_POK450, "a78_p450_vb" }
// };

// enum
// {
// 	A78_TYPE0 = 0,      // standard 8K/16K/32K games, no bankswitch
// 	A78_TYPE1,          // as TYPE0 + POKEY chip on the PCB
// 	A78_TYPE2,          // Atari SuperGame pcb (8x16K banks with bankswitch)
// 	A78_TYPE3,          // as TYPE1 + POKEY chip on the PCB
// 	A78_TYPE6,          // as TYPE1 + RAM IC on the PCB
// 	A78_TYPEA,          // Alien Brigade, Crossbow (9x16K banks with diff bankswitch)
// 	A78_TYPE8,          // Rescue on Fractalus, as TYPE0 + 2K Mirror RAM IC on the PCB
// 	A78_ABSOLUTE,       // F18 Hornet
// 	A78_ACTIVISION,     // Double Dragon, Rampage
// 	A78_HSC,            // Atari HighScore cart
// 	A78_XB_BOARD,       // A7800 Expansion Board (it shall more or less apply to the Expansion Module too, but this is not officially released yet)
// 	A78_XM_BOARD,       // A7800 XM Expansion Module (theoretical specs only, since this is not officially released yet)
// 	A78_MEGACART,               // Homebrew by CPUWIZ, consists of SuperGame bank up to 512K + 32K RAM banked
// 	A78_VERSABOARD = 0x10,      // Homebrew by CPUWIZ, consists of SuperGame bank up to 256K + 32K RAM banked
// 	// VersaBoard variants configured as Type 1/3/A or VersaBoard + POKEY at $0450
// 	A78_TYPE0_POK450 = 0x20,
// 	A78_TYPE1_POK450 = 0x21,
// 	A78_TYPE6_POK450 = 0x24,
// 	A78_TYPEA_POK450 = 0x25,
// 	A78_VERSA_POK450 = 0x30
// };

class Cart7800 extends Cart implements IMemory {

  private data: Uint8Array
  private ram?: Uint8Array
  private pokey?: Pokey
  private curBank: number

  private headerVersion: number = 0
  private name: string = ""
  private romSize: number = 0
  private cartType = Cart7800Type.ROM

  private controller1 = Controller.Joystick7800
  private controller2 = Controller.Joystick7800
  private tvFormatRegion: number = 0
  private saveDevice: number = 0
  private xmAtachment: number = 0

  private v4MapperId: number = 0
  private v4MapperOptions: number = 0
  private v4Audio: number = 0
  private v4Interrupt: number = 0

  constructor(data: Uint8Array) {
    super()

    if (this.readHeader(data)) {
      data = data.subarray(0x80)
    } else {
      this.headerVersion = -1
    }

    const paddedLength = 9 * 0x4000
    this.data = new Uint8Array(paddedLength).fill(0xee)
    let setOffset = paddedLength - data.length
    this.data.set(data, setOffset)
    this.curBank = 6

    // TODO: make this work for CartType >= MRAM

    if ((this.cartType & ~Cart7800Type.P450_Pokey) == Cart7800Type.SG_RAM) {
      this.ram = new Uint8Array(0x4000)
    }

    if (this.cartType == Cart7800Type.Pokey ||
        this.cartType == Cart7800Type.SG_Pokey ||
        (this.cartType & Cart7800Type.P450_Pokey)) {
      this.pokey = new Pokey()
    }
  }

  getMachineType(): string {
    return "atari7800"
  }

  public isValid(): boolean {
    return this.headerVersion != -1
  }

  public isSupported(): boolean {

    // no new mapper modes
    if (this.headerVersion >= 4) {
      return false
    }

    // TODO: no PAL right now
    if (this.tvFormatRegion & 1) {
      return false
    }

    // TODO: only SuperGame switching for now
    if ((this.cartType & ~Cart7800Type.P450_Pokey) >= Cart7800Type.MRAM) {
      return false
    }
    return true
  }

  private readHeader(data: Uint8Array): boolean {
    let nameEnd = 0x10
    while (data[nameEnd] == 0) {
      nameEnd -= 1
    }
    const decoder = new TextDecoder()
    const consoleType = decoder.decode(data.subarray(0x01, nameEnd + 1))
    if (consoleType.trimEnd() != "ATARI7800") {
      return false
    }
    const idStr = decoder.decode(data.subarray(0x64, 0x80))
    if (idStr != "ACTUAL CART DATA STARTS HERE") {
      return false
    }

    this.headerVersion = data[0]
    nameEnd = 48
    while (data[nameEnd] == 0) {
      nameEnd -= 1
    }
    this.name = decoder.decode(data.subarray(0x11, nameEnd + 1)).trimEnd()
    this.romSize = (data[0x31] << 24) | (data[0x32] << 16) | (data[0x33] << 8) | (data[0x34] << 0)
    this.cartType = this.chooseCartType((data[0x35] << 8) | data[0x36])
    this.controller1 = data[0x37]
    this.controller2 = data[0x38]
    this.tvFormatRegion = data[0x39]
    this.saveDevice = data[0x3A]
    this.xmAtachment = data[0x3B]

    if (this.headerVersion >= 4) {
      this.v4MapperId = data[0x40]
      this.v4MapperOptions = data[0x41]
      this.v4Audio = (data[0x42] << 8) | data[0x43]
      this.v4Interrupt = (data[0x44] << 8) | data[0x45]
    }
    return true
  }

  private chooseCartType(cartBits: number): Cart7800Type {

    // bit cleaning logic from MAME
    switch (cartBits & 0x3d) {
      case 0x05:
        cartBits &= ~0x01 // disable Pokey
        break
      case 0x09:
        cartBits &= ~0x01 // disable Pokey
        break
      case 0x11:
        cartBits &= ~0x01 // disable Pokey
        break
      case 0x21:
        cartBits &= ~0x01 // disable Pokey
        break
      case 0x0c:
        cartBits &= ~0x04 // disable RAM
        break
      case 0x14:
        cartBits &= ~0x04 // disable RAM
        break
      case 0x24:
        cartBits &= ~0x04 // disable RAM
        break
      case 0x18:
        cartBits &= ~0x08 // disable bank 0 ROM
        break
      case 0x28:
        cartBits &= ~0x08 // disable bank 0 ROM
        break
      case 0x30:
        cartBits &= ~0x10 // disable bank 6 ROM
        break
    }

    if ((cartBits & 0x3c) && !(cartBits & 0x02)) {
      cartBits |= 0x02  // enable SuperGame bank switching
    }

    if ((cartBits & 0xff00) == 0x0100 && (cartBits & 0xff)) {
      cartBits &= 0xff00  // activation, so disable bank switching
    }
    if ((cartBits & 0xff00) == 0x0200 && (cartBits & 0xff)) {
      cartBits &= 0xff00  // absolute, so disable bank switching
    }
    if ((cartBits & 0xff00) > 0x0300 && (cartBits & 0xff)) {
      cartBits &= 0x00ff  // unknown, so disable high bits
    }

    let cartType = Cart7800Type.ROM

    switch (cartBits & 0x002e) {
      case 0x0000:
        cartType = (cartBits & 1) ? Cart7800Type.Pokey : Cart7800Type.ROM
        break
      case 0x0002:
        cartType = (cartBits & 1) ? Cart7800Type.SG_Pokey : Cart7800Type.SuperGame
        break
      case 0x0006:
        cartType = Cart7800Type.SG_RAM    // *** check this
        break
      case 0x000a:
        cartType = Cart7800Type.SG9       // *** check this
        break
      case 0x0022:
      case 0x0026:
        if (this.romSize > 0x40000) {
          cartType = Cart7800Type.MegaCart
        } else {
          cartType = Cart7800Type.VersaBoard
        }
        break
    }

    if (cartBits & 0x0040) {
      if (cartType != Cart7800Type.SuperGame) {
        cartType &= ~Cart7800Type.SuperGame
        cartType += Cart7800Type.P450_Pokey
      }
    }

    if ((cartBits & 0xff00) == 0x0100) {
      cartType = Cart7800Type.Activision
    } else if ((cartBits & 0xff00) == 0x0200) {
      cartType = Cart7800Type.Absolute
    } else if (cartBits & 0x0080) {
      cartType = Cart7800Type.MRAM
    }

    return cartType
  }

  public readConst(address: number): number {
    return this.read(address, 0)
  }

  public read(address: number, cycleCount: number): number {

    const offset = address & 0x3fff

    if (address >= 0xc000) {
      return this.data[(7 + 1) * 0x4000 + offset]
    }
    if (address >= 0x8000) {
      return this.data[(this.curBank + 1) * 0x4000 + offset]
    }
    if (address >= 0x4000) {
      if (this.ram) {
        return this.ram[offset]
      }
      const type = this.cartType & ~Cart7800Type.P450_Pokey
      if (this.pokey) {     // *** check for pokey4000 versus pokey0450
        return this.pokey.read(offset & 0x0f, cycleCount)
      }
      if (type == Cart7800Type.ROM) {
        return this.data[(5 + 1) * 0x4000 + offset]
      }
      if (type == Cart7800Type.SG9) {
        return this.data[0 * 0x4000 + offset]
      }
      // NOTE: Some simple supergame carts (ace of aces, etc.)
      //  implicitly expect bank 6 at 0x4000, so do that
      //  here for compatibility.
      return this.data[(6 + 1) * 0x4000 + offset]
    }
    return 0xee
  }

  public write(address: number, value: number, cycleCount: number) {
    if (address >= 0xc000) {
      return
    }
    if (address >= 0x8000) {
      if (this.cartType != Cart7800Type.ROM) {
        this.curBank = value & 7
      }
      return
    }
    const offset = address & 0x3fff
    if (address >= 0x4000) {
      if (this.ram) {
        this.ram[offset] = value
        return
      }
      if (this.pokey) {
        this.pokey.write(offset & 0x0f, value, cycleCount)
        return
      }
    }
  }

  public readRange(address: number, length: number): Uint8Array {
    return this.data.subarray(address, address + length)
  }

  public writeRange(address: number, data: Uint8Array | number[]): void {
    this.data.set(data, address)
  }

  public getState(): any {
    let state: any = {}
    state.curBank = this.curBank
    if (this.ram) {
      state.ramBytes = new Uint8Array(this.ram)
    }
    if (this.pokey) {
      state.pokey = this.pokey.getState()
    }
    return state
  }

  public async flattenState(state: any): Promise<void> {
    if (state.ramBytes) {
      state.ramString = await base64FromUint8(state.ramBytes)
      delete state.ramBytes
    }
    if (this.pokey && state.pokey) {
      this.pokey.flattenState(state.pokey)
    }
  }

  public setState(state: any): void {
    this.curBank = state.curBank
    if (state.ramString) {
      this.ram = base64.toByteArray(state.ramString)
    } else if (state.ramBytes) {
      this.ram = new Uint8Array(state.ramBytes)
    }
    if (this.pokey && state.pokey) {
      this.pokey.setState(state.pokey)
    }
  }
}

//------------------------------------------------------------------------------

export function createCart(data: Uint8Array): Cart {
  const cart7800 = new Cart7800(data)
  if (!cart7800.isValid()) {
    const cart2600 = createCart2600(data)
    if (cart2600) {
      return cart2600
    }
    throw Error("Invalid cartridge")
  }
  if (!cart7800.isSupported()) {
    throw Error("Unsupported cartridge type")
  }
  return cart7800
}

//------------------------------------------------------------------------------
