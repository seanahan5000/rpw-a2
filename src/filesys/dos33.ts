
import { DiskImage, SectorData } from "./disk_image"
import { FileEntry, ProdosFileType, DiskFullError } from "./prodos"

// import { Dos33NoDosImage, Dos33Image } from "./dos33_image"

type Dos33DataProc = (sector: SectorData) => boolean
type Dos33FileProc = (fileEntry: Dos33FileEntry) => boolean

// *** be more "bullet proof" on .dsk files that aren't actually DOS 3.3

//------------------------------------------------------------------------------

export class Dos33VTOC {

  public data: Uint8Array

  // *** add reset method? ***
  //   vtoc[0x00] = 4     // matches real disks
  //   vtoc[0x01] = 17    // first catalog track
  //   vtoc[0x02] = 15    // first catalog sector
  //   vtoc[0x03] = 3     // DOS 3.3
  //   vtoc[0x06] = 254   // volume
  //   vtoc[0x27] = 122   // track/sector pairs per sector
  //   vtoc[0x30] = 18    // last track where sectors were allocated
  //   vtoc[0x31] = 1     // direction of allocation
  //   vtoc[0x34] = this.TracksPerDisk
  //   vtoc[0x35] = this.SectorsPerTrack
  //   vtoc[0x36] = this.BytesPerSector & 0xFF
  //   vtoc[0x37] = this.BytesPerSector >> 8

  constructor(sector: SectorData) {
    this.data = sector.data
  }

  public get catTrack(): number {
    return this.data[0x01]
  }

  public get catSector(): number {
    return this.data[0x02]
  }

  public get dosVersion(): number {
    return this.data[0x03]
  }

  public get volume(): number {
    return this.data[0x06]
  }

  public get tsPairsPerSector(): number {
    return this.data[0x27]
  }

  public get lastAllocTrack(): number {
    return this.data[0x30]
  }

  public set lastAllocTrack(value: number) {
    this.data[0x30] = value
  }

  // *** check how real code treats this -- just high bit? ***
  public get allocDirection(): number {
    return (this.data[0x31] & 0x80) ? -1 : 1
  }

  public set allocDirection(value: number) {
    this.data[0x31] = value < 0 ? 0xFF : 0x01
  }

  public get tracksPerDisk(): number {
    return this.data[0x34]
  }

  public get sectorsPerTrack(): number {
    return this.data[0x35]
  }

  public get bytesPerSector(): number {
    return this.data[0x36] + (this.data[0x37] << 8)
  }

  private changeAllocationBit(t: number, s: number, newBit: number): number {
    let offset = 0x38 + t * 4
    if (s < 8) {
      offset += 1
    }
    let mask = 1 << (s & 7)
    let previous = (this.data[offset] & mask) ? 1 : 0
    if (newBit == 0) {
      this.data[offset] &= ~mask
    } else {
      this.data[offset] |= mask
    }
    return previous
  }

  public allocateTrackSectorBit(track: number, sector: number): boolean {
    return this.changeAllocationBit(track, sector, 0) == 1
  }

  public freeTrackSectorBit(track: number, sector: number): boolean {
    return this.changeAllocationBit(track, sector, 1) == 0
  }
}

//------------------------------------------------------------------------------

export class Dos33FileEntry implements FileEntry {

  private volume: Dos33Volume
  private data: Uint8Array

  protected _name?: string
  protected _type?: string

  protected _auxType: number = 0
  protected byteLength: number = 0

  constructor(volume: Dos33Volume, sector: SectorData, offset: number, readExtra = true) {
    this.volume = volume
    this.data = sector.data.subarray(offset, offset + 0x23)
    if (readExtra) {
      if (this.type == "B" || this.type == "A" || this.type == "I") {
        const tsList = this.volume.readTrackSector(this.tslTrack, this.tslSector)
        const sector = this.volume.readTrackSector(tsList.data[0x0C], tsList.data[0x0D])
        if (this.type == "B") {
          this._auxType = sector.data[0] + (sector.data[1] << 8)
          this.byteLength = sector.data[2] + (sector.data[3] << 8)
        } else {
          // TODO: what should auxType be here?
          this._auxType = 0
          this.byteLength = sector.data[0] + (sector.data[1] << 8)
        }
      }
    }
  }

  initialize(fileName: string, typeByte: ProdosFileType, auxType: number) {
    // default everything to zero
    for (let i = 0; i < 0x23; i += 1) {
      this.data[i] = 0
    }
    this.name = fileName
    this.typeByte = typeByte
    this.auxType = auxType
  }

  markDeleted() {
    this.data[0x20] = this.data[0x00]
    this.data[0x00] = 0xff
  }

  public get name() {
    if (!this._name) {
      let nameBytes = this.data.slice(0x03, 0x03 + 30)
      for (let i = 0; i < nameBytes.length; i += 1) {
        nameBytes[i] = nameBytes[i] & 0x7f
      }
      this._name = String.fromCharCode(...nameBytes).trim()
    }
    return this._name
  }

  public set name(value: string) {
    if (value.length > 30) {
      throw new Error(`Name is too long (30 characters max)`)
    }
    value = value.toUpperCase().padEnd(30, " ")
    let utf8Encode = new TextEncoder()
    let name30 = utf8Encode.encode(value)
    for (let i = 0; i < name30.length; i += 1) {
      this.data[0x3 + i] = name30[i] | 0x80
    }
    this._name = value
  }

  public get type() {
    // *** TODO: catch value with multiple bits set? ***
    if (!this._type) {
      let index = 0
      let value = this.typeByte
      // *** mask instead ***
      while (value != 0) {
        index += 1
        value >>= 1
      }
      this._type = "TIABSRXY?"[index]
    }
    return this._type
  }

  public get auxType() {
    // return this.data[0x1F] + (this.data[0x20] << 8)
    return this._auxType
  }

  public set auxType(value: number) {
    // *** this.data[0x1F] = value & 0xff
    // *** this.data[0x20] = value >> 8
    this._auxType = value
  }

  public get tslTrack(): number {
    return this.data[0x00]
  }

  public set tslTrack(value: number) {
    this.data[0x00] = value
  }

  public get tslSector(): number {
    return this.data[0x01]
  }

  public set tslSector(value: number) {
    this.data[0x01] = value
  }

  public get locked(): boolean {
    return (this.data[0x02] & 0x80) != 0
  }

  public set locked(lock: boolean) {
    if (lock) {
      this.data[0x02] |= 0x80
    } else {
      this.data[0x02] &= 0x7F
    }
  }

  public get typeByte(): number {
    return this.data[0x02] & 0x7F
  }

  public set typeByte(value: number) {
    this._type = undefined
    // *** throw on bad values? ***
    this.data[0x02] = (value & 0x7F) | (this.data[0x02] & 0x80)
  }

  public get sectorLength(): number {
    return this.data[0x21] + (this.data[0x22] << 8)
  }

  public set sectorLength(value: number) {
    this.data[0x21] = value & 0xff
    this.data[0x22] = value >> 8
  }

  getContents(): Uint8Array {
    // *** remove size/address? ***
    return this.volume.getFileContents(this)
  }

  setContents(contents: Uint8Array) {
    // *** add size/address? ***
    return this.volume.setFileContents(this, contents)
  }
}

//------------------------------------------------------------------------------

// fake directory that contains the volume root files
// *** redo this using initialize()? ***
export class Dos33VolFileEntry extends Dos33FileEntry {
  constructor(volume: Dos33Volume) {
    const sector = { track: 0, index: 9, data: new Uint8Array(0x27) }
    super(volume, sector, 0)
    this._name = ""
    this._type = "DIR"
  }
}

export class Dos33Volume {
  image: DiskImage

  readonly TracksPerDisk = 35
  readonly SectorsPerTrack = 16
  readonly BytesPerSector = 256

  constructor(image: DiskImage, reformat: boolean) {
    this.image = image
    if (reformat) {
      this.format(false)
    }
  }

  public commitChanges(): void {
    this.image.commitChanges()
  }

  public revertChanges(): void {
    this.image.revertChanges()
  }

  public verify(): void {
  }

  public readTrackSector(t: number, s: number): SectorData {
    if (t == 0 && s == 0) {
      throw new Error(`Reading track 0 sector 0 not allowed`)
    }
    const sector = this.image.readTrackSector(t, s)
    if (!sector.data) {
      throw new Error(`Failed to read track ${t} sector ${s}`)
    }
    return sector
  }

  protected readVTOC(): Dos33VTOC {
    return new Dos33VTOC(this.readTrackSector(17, 0))
  }

  // caller is responsible for reverting changes beforehand, if necessary
  format(isBootable: boolean): void {
    // zero all sectors
    for (let t = 0; t < this.TracksPerDisk; t += 1) {
      for (let s = 0; s < this.SectorsPerTrack; s += 1) {
        let sector = this.image.readTrackSector(t, s)
        sector.data.fill(0)
      }
    }

    // initialize empty VTOC
    let vtoc = this.readTrackSector(17, 0)
    vtoc.data[0x00] = 4     // matches real disks
    vtoc.data[0x01] = 17    // first catalog track
    vtoc.data[0x02] = 15    // first catalog sector
    vtoc.data[0x03] = 3     // DOS 3.3
    vtoc.data[0x06] = 254   // volume
    vtoc.data[0x27] = 122   // track/sector pairs per sector
    vtoc.data[0x30] = 18    // last track where sectors were allocated
    vtoc.data[0x31] = 1     // direction of allocation
    vtoc.data[0x34] = this.TracksPerDisk
    vtoc.data[0x35] = this.SectorsPerTrack
    vtoc.data[0x36] = this.BytesPerSector & 0xFF
    vtoc.data[0x37] = this.BytesPerSector >> 8

    for (let t = 0; t < this.TracksPerDisk; t += 1) {
      // mark first 3 tracks as allocated for DOS
      if (isBootable && t < 3) {
        continue
      }
      // mark track 17 as allocated for catalog
      if (t == 17) {
        continue
      }
      vtoc.data[0x38 + t * 4 + 0] = 0xFF
      vtoc.data[0x38 + t * 4 + 1] = 0xFF

      // track 0 sector 0 is always allocated, even if non-bootable
      if (t == 0 && !isBootable) {
        vtoc.data[0x38 + t * 4 + 1] = 0xFE
      }
    }

    // initialize catalog sectors
    for (let s = this.SectorsPerTrack - 1; s > 1; s -= 1) {
      let sector = this.readTrackSector(17, s)
      sector.data[0x01] = 17
      sector.data[0x02] = s - 1
    }

    // initialize boot image
    // let t = 0
    // let s = 0
    // let srcOffset = 0
    // let bootData = isBootable ? Dos33Image : Dos33NoDosImage
    // while (srcOffset < bootData.length) {
    //   let copySize = Math.min(this.BytesPerSector, bootData.length - srcOffset)
    //   let sector = this.readTrackSector(t, s)
    //   sector.set(bootData.subarray(srcOffset, srcOffset + copySize))
    //   srcOffset += this.BytesPerSector
    //   s += 1
    //   if (s == this.SectorsPerTrack) {
    //     s = 0
    //     t += 1
    //   }
    // }

    this.commitChanges()
  }

  // NOTE: does not throw error on file not found
  public findFileEntry(pathName: string): FileEntry | undefined {

    const parent = new Dos33VolFileEntry(this)
    if (pathName == "") {
      return parent
    }

    let file: FileEntry | undefined
    this.forEachAllocatedFile(parent, (fileEntry: FileEntry) => {
      if (fileEntry.name == pathName) {
        if (fileEntry instanceof Dos33FileEntry) {
          file = fileEntry
          return false
        }
      }
      return true
    })

    return file
  }

  private allocateSector(): SectorData {
    let vtoc = this.readVTOC()
    let firstTrack = vtoc.lastAllocTrack
    let track = firstTrack
    let forwardDone = false
    let backwardDone = false
    while (true) {
      for (let s = this.SectorsPerTrack; --s >= 0; ) {
        if (vtoc.allocateTrackSectorBit(track, s)) {
          vtoc.lastAllocTrack = track
          let sector = this.readTrackSector(track, s)
          sector.data.fill(0)
          return sector
        }
      }
      track = (track + vtoc.allocDirection) & 0xff
      if (track == this.TracksPerDisk) {
        forwardDone = true
        vtoc.allocDirection = -1
        track = 16
      } else if (track == 0xff) {
        backwardDone = true
        vtoc.allocDirection = 1
        track = 18
      }
      if (forwardDone && backwardDone && track == firstTrack) {
        throw new DiskFullError()
      }
    }
  }

  public preprocessName(name: string): string {
    name = name.toUpperCase()
    // *** do a truncate to 31? ***
    return name
  }

  // *** ProdosFileType doesn't work here ***
  public createFile(parent: FileEntry, fileName: string, type: ProdosFileType, auxType: number): FileEntry {

    // TODO: validate/limit fileName *** also done in set name ***

    // *** verify that file doesn't already exist ***
    return this.allocateFile(<Dos33FileEntry>parent, fileName, type, auxType)
  }

  private allocateFile(parent: Dos33FileEntry, fileName: string, type: ProdosFileType, auxType: number): FileEntry {
    const fileEntry = this.allocFileEntry(parent)
    fileEntry.initialize(fileName, type, auxType)

    const tsList = this.allocateSector()
    fileEntry.tslTrack = tsList.track
    fileEntry.tslSector = tsList.index

    const dataSector = this.allocateSector()
    tsList.data[0xc + 0 * 2] = dataSector.track
    tsList.data[0xd + 0 * 2] = dataSector.index

    fileEntry.sectorLength = 2
    return fileEntry
  }

  private allocFileEntry(parent: Dos33FileEntry): Dos33FileEntry {
    let vtoc = this.readVTOC()
    let catTrack = vtoc.catTrack
    let catSector = vtoc.catSector
    while (true) {
      let cat = this.readTrackSector(catTrack, catSector)
      let offset = 0x0B
      do {
        // look for never used (0x00) or deleted (0xff)
        if (cat.data[offset + 0] == 0x00 || cat.data[offset + 0] == 0xff) {
          const readExtra = false
          let fileEntry = new Dos33FileEntry(this, cat, offset, readExtra)
          return fileEntry
        }
        offset += 0x23
      } while (offset < 0xff)

      catTrack = cat.data[1]
      catSector = cat.data[2]
      if (catTrack == 0 && catSector == 0) {
        throw new Error("Catalog full")
      }
    }
  }

  forEachAllocatedFile(parent: FileEntry, fileProc: Dos33FileProc): void {
    const vtoc = this.readVTOC()
    let catTrack = vtoc.catTrack
    let catSector = vtoc.catSector
    while (true) {
      const cat = this.readTrackSector(catTrack, catSector)
      let offset = 0x0b
      do {
        // skip never used (0x00) or deleted (0xff)
        if (cat.data[offset + 0] != 0x00 && cat.data[offset + 0] != 0xff) {
          let fileEntry = new Dos33FileEntry(this, cat, offset)
          if (!fileProc(fileEntry)) {
            return
          }
        }
        offset += 0x23
      } while (offset < 0xff)

      catTrack = cat.data[1]
      catSector = cat.data[2]
      if (catTrack == 0 && catSector == 0) {
        break
      }
    }
  }

  public deleteFile(parent: FileEntry, file: FileEntry): void {
    const fileEntry = <Dos33FileEntry>file
    this.writeEachFileSector(fileEntry, (sector: SectorData): boolean => {
      return false
    })
    const vtoc = this.readVTOC()
    const tslTrack = fileEntry.tslTrack
    const tslSector = fileEntry.tslSector
    const tsList = this.readTrackSector(tslTrack, tslSector)
    const fileTrack = tsList.data[0x0c + 0 * 2]
    const fileSector = tsList.data[0x0D + 0 * 2]
    vtoc.freeTrackSectorBit(fileTrack, fileSector)
    vtoc.freeTrackSectorBit(tslTrack, tslSector)
    fileEntry.markDeleted()
  }

  public renameFile(parent: FileEntry, file: FileEntry, newName: string): void {
    const fileEntry = <Dos33FileEntry>file
    if (file.name != newName) {
      // NOTE: VSCode also does duplicate checking but it may not
      //  correctly deal with magic suffixes.
      // TODO: magic suffixes should all be done by now
      if (this.fileExists(parent, newName)) {
        throw new Error("File exists with that name")
      }
      fileEntry.name = newName
    }
  }

  private fileExists(parent: FileEntry, fileName: string): boolean {
    let nameExists = false
    this.forEachAllocatedFile(parent, (fileEntry: FileEntry) => {
      if (fileEntry.name == fileName) {
        nameExists = true
        return false
      }
      return true
    })
    return nameExists
  }

  public getFileContents(entry: FileEntry): Uint8Array {
    let fileEntry = entry as Dos33FileEntry
    let length = 0
    let outData: number[] = []
    this.readEachFileSector(fileEntry, (sector: SectorData): boolean => {
      let copySize = sector.data.length
      let srcOffset = 0
      if (length == 0) {
        if (fileEntry.type == "B" || fileEntry.type == "Y") {
          // TODO: maybe no address for Y type file?
          fileEntry.auxType = sector.data[srcOffset + 0] + ((sector.data[srcOffset + 1]) << 8)
          srcOffset += 2
          copySize -= 2
        }
        if (fileEntry.type.match(/[BAIY]/)) {
          length = sector.data[srcOffset + 0] + ((sector.data[srcOffset + 1]) << 8)
          srcOffset += 2
          copySize -= 2
        }
      }
      let inData = Array.from(sector.data)
      if (fileEntry.type == "T") {
        for (let i = 0; i < copySize; i += 1) {
          if (inData[i] == 0) {
            outData = outData.concat(inData.slice(0, i))
            length += i
            return false
          }
        }
        length += copySize
      }
      let remaining = length - outData.length
      if (copySize > remaining) {
        copySize = remaining
      }
      outData = outData.concat(inData.slice(srcOffset, srcOffset + copySize))
      return true
    })
    if (length != outData.length) {
      throw new Error("Invalid file length")
    }
    return new Uint8Array(outData)
  }

  private readEachFileSector(fileEntry: Dos33FileEntry, dataProc: Dos33DataProc): void {
    let tslTrack = fileEntry.tslTrack
    let tslSector = fileEntry.tslSector
    const vtoc = this.readVTOC()
    const pairsPerTsl = vtoc.tsPairsPerSector
    let index = 0
    while (true) {
      let tsList = this.readTrackSector(tslTrack, tslSector)
      index += 1
      for (let i = 0; i < pairsPerTsl; i += 1) {
        //*** TODO: this isn't working here
        //  EDASM.OBJ catalog entry says it's 7 (0x600 + TSList) sectors long,
        //  but the file itself says it's 0x66c bytes long
        //
        // if (index == fileEntry.sectorLength) {
        //   return
        // }
        let t = tsList.data[0x0c + i * 2]
        let s = tsList.data[0x0d + i * 2]
        let sector = this.readTrackSector(t, s)
        if (!dataProc(sector)) {
          return
        }
        index += 1
        //*** TODO: reconcile with comment above
        // *** index >= ?
        if (index >= fileEntry.sectorLength) {
          return
        }
      }
      tslTrack = tsList.data[0x01]
      tslSector = tsList.data[0x02]
      if (tslTrack == 0 && tslSector == 0) {
        //*** ran out of track/sectors
        break
      }
    }
  }

  public setFileContents(entry: FileEntry, contents: Uint8Array): void {
    let fileEntry = entry as Dos33FileEntry

    const header: number[] = []
    if (fileEntry.type == "B" || fileEntry.type == "Y") {
      // TODO: maybe no address for Y type file?
      header.push(fileEntry.auxType & 0xff)
      header.push((fileEntry.auxType >> 8) & 0xff)
    }
    if (fileEntry.type.match(/[BAIY]/)) {
      header.push(contents.length & 0xff)
      header.push((contents.length >> 8) & 0xff)
    }

    let data = contents
    if (header.length > 0) {
      data = new Uint8Array(header.length + contents.length)
      data.set(header)
      data.set(contents, header.length)
    }

    let dataOffset = 0
    this.writeEachFileSector(fileEntry, (sector: SectorData): boolean => {
      let copySize = Math.min(sector.data.length, data.length - dataOffset)
      sector.data.fill(0)
      sector.data.set(data.subarray(dataOffset, dataOffset + copySize))
      dataOffset += copySize
      return dataOffset < data.length
    })
  }

  // NOTE: this doesn't not correctly handle non-sequential text files
  private writeEachFileSector(fileEntry: Dos33FileEntry, dataProc: Dos33DataProc): void {
    const vtoc = this.readVTOC()
    const pairsPerTsl = vtoc.tsPairsPerSector
    let moreData = true

    let tslTrack = fileEntry.tslTrack
    let tslSector = fileEntry.tslSector
    let sectorCount = fileEntry.sectorLength
    let prevList: SectorData | undefined
    let tsList = this.readTrackSector(tslTrack, tslSector)
    let tsIndex = 0

    while (true) {

      // overwriting or growing data
      if (moreData) {

        if (tsIndex == pairsPerTsl) {
          tslTrack = tsList.data[0x1]
          tslSector = tsList.data[0x2]
          if (tslTrack == 0 && tslSector == 0) {
            // add another tsList sector
            let nextList = this.allocateSector()
            sectorCount += 1
            tsList.data[0x1] = nextList.track
            tsList.data[0x2] = nextList.index
            prevList = tsList
            tsList = nextList
          } else {
            tsList = this.readTrackSector(tslTrack, tslSector)
          }
          tsIndex = 0
        }

        let dataSector: SectorData
        const t = tsList.data[0x0c + tsIndex * 2]
        const s = tsList.data[0x0d + tsIndex * 2]
        if (t == 0 && s == 0) {
          // add another data sector
          dataSector = this.allocateSector()
          sectorCount += 1
          tsList.data[0x0c + tsIndex * 2] = dataSector.track
          tsList.data[0x0d + tsIndex * 2] = dataSector.index
        } else {
          dataSector = this.readTrackSector(t, s)
        }
        tsIndex += 1
        moreData = dataProc(dataSector)
        continue
      }

      // shrinking data

      // at end of tslSector?
      if (tsIndex == pairsPerTsl) {

        tslTrack = tsList.data[0x1]
        tslSector = tsList.data[0x2]

        // is indexBlock mostly/completely empty?
        if (prevList) {
          let anyUsed = false
          for (let i = 0; i < pairsPerTsl; i += 1) {
            const t = tsList.data[0x0c + i * 2]
            const s = tsList.data[0x0d + i * 2]
            if (t != 0 || s != 0) {
              anyUsed = true
              break
            }
          }
          if (!anyUsed) {
            // unlink and free current tsList
            prevList.data[0x1] = tslTrack
            prevList.data[0x2] = tslSector
            vtoc.freeTrackSectorBit(tsList.track, tsList.index)
            sectorCount -= 1
          }
        }

        if (tslTrack == 0 && tslSector == 0) {
          break
        }

        prevList = tsList
        tsList = this.readTrackSector(tslTrack, tslSector)
        tsIndex = 0
      }

      // free next sector in tsList, if any
      const t = tsList.data[0x0c + tsIndex * 2]
      const s = tsList.data[0x0d + tsIndex * 2]
      if (t != 0 || s != 0) {
        vtoc.freeTrackSectorBit(t, s)
        sectorCount -= 1
        tsList.data[0x0c + tsIndex * 2] = 0
        tsList.data[0x0d + tsIndex * 2] = 0
      }
      tsIndex += 1
    }

    fileEntry.sectorLength = sectorCount
  }
}

//------------------------------------------------------------------------------
