
export type BlockData = {
  index: number
  data: Uint8Array
}

export type SectorData = {
  track: number
  index: number     // not "sector" to avoid "sector.sector"
  data: Uint8Array
}

//------------------------------------------------------------------------------

enum TwoMGFormat {
  Dos33  = 0,
  Prodos = 1,
  Nib    = 2
}

class TwoMGHeader {
  private data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data.subarray(0, 64)
  }

  public verify() {
    this.check(this.id == "2IMG",
      `Invalid .2mg id "${this.id}"`)
    this.check(this.headerSize == 64,
      `Unexpected .2mg header size: ${this.headerSize}`)
    this.check(this.versionNumber == 1,
      `Unexpected .2mg version number: ${this.versionNumber}`)
    if (this.imageFormat == TwoMGFormat.Dos33) {
      this.check(this.dataSize == 143360,
        `Unexpected .2mg DOS 3.3 data size: ${this.dataSize}`)
    } else if (this.imageFormat == TwoMGFormat.Prodos) {
      this.check(this.dataSize == this.prodosBlocks * 512,
        `.2mg data size ${this.dataSize} != prodos blocks * 512 ${this.prodosBlocks * 512}`)
    } else if (this.imageFormat == TwoMGFormat.Nib) {
      // TODO: more here
    } else {
      this.check(this.imageFormat == 1,
        `Unexpected .2mg image format: ${this.imageFormat}`)
    }
  }

  public get id(): string {
    const nameBytes = this.data.subarray(0, 4)
    return String.fromCharCode(...nameBytes)
  }

  public get creator(): string {
    const nameBytes = this.data.subarray(4, 8)
    return String.fromCharCode(...nameBytes)
  }

  public get headerSize(): number {
    return this.data[0x08] + (this.data[0x09] << 8)
  }

  public get versionNumber(): number {
    return this.data[0x0A] + (this.data[0x0B] << 8)
  }

  public get imageFormat(): number {
    return this.data[0x0C] + (this.data[0x0D] << 8) +
      (this.data[0x0E] << 16) + (this.data[0x0F] << 24)
  }

  public get dos33Flags(): number {
    return this.data[0x10] + (this.data[0x11] << 8) +
      (this.data[0x12] << 16) + (this.data[0x13] << 24)
  }

  public get dos33Locked(): boolean {
    return (this.data[0x13] & 0x80) != 0
  }

  public get dos33Volume(): number {
    if (this.data[0x11] & 0x01) {
      return this.data[0x10]
    }
    return 254
  }

  public get prodosBlocks(): number {
    return this.data[0x14] + (this.data[0x15] << 8) +
      (this.data[0x16] << 16) + (this.data[0x17] << 24)
  }

  public get dataOffset(): number {
    return this.data[0x18] + (this.data[0x19] << 8) +
      (this.data[0x1A] << 16) + (this.data[0x1B] << 24)
  }

  public get dataSize(): number {
    return this.data[0x1C] + (this.data[0x1D] << 8) +
      (this.data[0x1E] << 16) + (this.data[0x1F] << 24)
  }

  private check(test: boolean, message: string) {
    if (!test) {
      throw new Error(message)
    }
  }
}

//------------------------------------------------------------------------------

export class DiskImage {
  protected fullData: Uint8Array
  private diskData: Uint8Array
  protected workingData?: Uint8Array
  protected isReadOnly: boolean
  public isDos33: boolean
  private tmg?: TwoMGHeader

  constructor(typeName: string, data: Uint8Array, isReadOnly = false) {
    this.fullData = data
    this.diskData = this.fullData
    this.isReadOnly = isReadOnly
    this.isDos33 = false
    switch (typeName) {
      case "dsk":
      case "do":
        this.isDos33 = true
        break
      case "po":
      case "hdv":
        break
      case "2mg":
        this.tmg = new TwoMGHeader(this.fullData)
        this.tmg.verify()
        if (this.tmg.imageFormat == TwoMGFormat.Dos33) {
          this.isDos33 = true
          // TODO: should the volume's lock be respected here?
          this.isReadOnly = this.tmg.dos33Locked
        } else if (this.tmg.imageFormat == TwoMGFormat.Prodos) {
          // TODO: anything else?
        } else if (this.tmg.imageFormat == TwoMGFormat.Nib) {
          throw new Error(".2mg NIB files not supported")
        }
        const offset = this.tmg.dataOffset
        const length = this.tmg.dataSize
        this.diskData = this.fullData.subarray(offset, offset + length)
        break
      default:
        throw new Error(`Unknown disk volume type "${typeName}"`)
    }
  }

  public getBlockCount(): number {
    return Math.floor(this.diskData.length / 512)
  }

  // used by Dos 3.3

  public readTrackSector(t: number, s: number): SectorData {
    if (!this.isDos33) {
      throw new Error("readTrackSector not allowed on Prodos image")
    }

    if (!this.workingData) {
      this.workingData = this.snapWorkingData()
    }

    let offset = (t * 16 + s) * 256
    return { track: t, index: s, data: this.workingData.subarray(offset, offset + 256) }
  }

  // used by Prodos

  public readBlock(index: number): BlockData {
    if (this.isDos33) {
      throw new Error("readBlock not allowed on DOS 3.3 image")
    }

    if (!this.workingData) {
      this.workingData = this.snapWorkingData()
    }

    let offset = index * 512
    return { index, data: this.workingData.subarray(offset, offset + 512) }
  }

  private snapWorkingData(): Uint8Array {
    const data = new Uint8Array(this.diskData.length)
    data.set(this.diskData)
    return data
  }

  public commitChanges(): void {
    if (this.workingData) {
      if (!this.isReadOnly) {
        this.diskData.set(this.workingData)
      }
      this.workingData = undefined
    }
  }

  public revertChanges(): void {
    this.workingData = undefined
  }
}

//------------------------------------------------------------------------------
