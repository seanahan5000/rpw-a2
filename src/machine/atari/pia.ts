
export class Pia {

  private outa!: number
  private ddra!: number
  private outb!: number
  private ddrb!: number
  private timerRegs: number[] = new Array(4)
  private timerScale!: number
  private timerStartCycle!: number
  private timerStartValue!: number
  private timerCurValue!: number

  constructor() {
    this.reset()
  }

  public reset() {
    this.outa = 0xff
    this.ddra = 0
    this.outb = 0xff
    this.ddrb = 0
    this.timerRegs.fill(0xEE)
    this.timerScale = 10    // 1024
    this.timerStartCycle = 0
    this.timerStartValue = 0
    this.timerCurValue = 0
  }

  public getState(): any {
    let state: any = {}
    state.outa = this.outa
    state.ddra = this.ddra
    state.outb = this.outb
    state.ddrb = this.ddrb
    state.timerRegs = this.timerRegs
    state.timerScale = this.timerScale
    state.timerStartCycle = this.timerStartCycle
    state.timerStartValue = this.timerStartValue
    state.timerCurValue = this.timerCurValue
    return state
  }

  public setState(state: any) {
    this.outa = state.outa
    this.ddra = state.ddra
    this.outb = state.outb
    this.ddrb = state.ddrb
    this.timerRegs = state.timerRegs
    this.timerScale = state.timerScale
    this.timerStartCycle = state.timerStartCycle
    this.timerStartValue = state.timerStartValue
    this.timerCurValue = state.timerCurValue
  }

  // *** this too when updating emulation? ***
  public update(cycleCount: number) {
    const deltaValue = (cycleCount - this.timerStartCycle) >> this.timerScale
    this.timerCurValue = Math.max(this.timerStartValue - deltaValue, 0)
  }

  // *** update emulation first? ***
  public getJoysticks(): number {
    return this.outa
  }

  public setJoysticks(joysticks: number) {
    this.outa = joysticks
  }

  public getSwitches(): number {
    return this.outb
  }

  public setSwitches(switches: number) {
    this.outb = switches
  }
  // *** update emulation first? ***

  public read(address: number, cycleCount: number): number {
    // if (!(address & 0x200)) {
    //   return this.ram[address & 0x7f]
    // }

    // *** update emulation first? ***

    // const isConst = cycleCount == 0
    switch (address & 7) {
      case 0:   // swcha (joystick)
        return this.outa
      case 1:   // swacnt (port direction)
        return this.ddra
      case 2:   // swchb (switches)
        return this.outb
      case 3:   // swbcnt (port direction)
        // *** "hardwired as input"
        return this.ddrb
      case 4:   // intim (timer output)
      case 6:
        if (cycleCount != 0) {
          this.update(cycleCount)
        }
        return this.timerCurValue
      case 5:   // interrupt status
      case 7:
        return 0xEE // ***
    }

    return 0xEE   // ***
  }

  // *** fold this into normal read but with an extra parameter
  public readConst(address: number): number {
    return this.read(address, 0) // ***
  }

  private timerScales = [ 0, 3, 6, 10 ]

  public write(address: number, value: number, cycleCount: number) {
    // if (!(address & 0x200)) {
    //   this.ram[address & 0x7f] = value
    //   return
    // }

    // *** update emulation first? ***

    if (address & 0x04) {
      if (address & 0x10) {
        const index = address & 3
        this.timerScale = this.timerScales[index]
        this.timerRegs[index] = value
        this.timerStartCycle = cycleCount
        this.timerStartValue = value
        this.timerCurValue = value
      } else {
        // *** edge detect?
      }
    } else {
      switch (address & 3) {
        case 0:
          // this.outa = value
          // *** pin state?
          break
        case 1:
          this.ddra = value
          // *** pin state?
          break
        case 2:
          // *** "hardwired as input"
          // this.outb = value
          break
        case 3:
          this.ddrb = value
          break
      }
    }
  }
}
