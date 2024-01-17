
//------------------------------------------------------------------------------

export type BlockData = {
  index: number
  data: Uint8Array
}

// *** change to type of (Dos33FileEntry | ProdosFileEntry) ***
  // *** but *AFTER* Dos33 code has been updated ***
export interface FileEntry {
  get name(): string
  get type(): string
  get auxType(): number
  getContents(): Uint8Array | undefined
}

enum StorageType {
  Seedling = 0x1,
  Sapling  = 0x2,
  Tree     = 0x3,
  Dir      = 0xD,
  SubDir   = 0xE,
  VolDir   = 0xF
}

export enum ProdosFileType {
  PTX = 0x03,    // Pascal text
  TXT = 0x04,    // ASCII, high bit clear
  BIN = 0x06,
  DIR = 0x0F,
  AWP = 0x1A,    // AppleWorks Word Processing
  BAS = 0xFC,
  VAR = 0xFD,
  REL = 0xFE,    // EDASM relocatable
  SYS = 0xFF
}

// *** share with Dos3.3? ***
enum ProdosError {
  BadFormat    = 1,
  BadReadIndex = 2,
  BadFreeIndex = 3,
  DiskFull     = 4,
  FileTooBig   = 5,
  Unsupported  = 6,
}

type ProdosDataProc = (block: BlockData, fileOffset: number) => boolean
type ProdosFileProc = (fileEntry: ProdosFileEntry) => boolean

//------------------------------------------------------------------------------

export class DiskImage {
  private data: Uint8Array
  private isReadOnly: boolean
  private changeMap = new Map<number, Uint8Array>()

  constructor(data: Uint8Array, isReadOnly: boolean) {
    this.data = data
    this.isReadOnly = isReadOnly
  }

  public getBlockCount() {
    return Math.floor(this.data.length / 512)
  }

  // used by Dos 3.3

  public readTrackSector(t: number, s: number): Uint8Array {
    let offset = (t * 16 + s) * 256
    if (this.isReadOnly) {
      return this.data.subarray(offset, offset + 256)
    }
    let data = this.changeMap.get(offset)
    if (!data) {
      data = this.data.subarray(offset, offset + 256)
      this.changeMap.set(offset, data)
    }
    return data
  }

  // used by Prodos

  public readBlock(index: number): Uint8Array {
    let offset = index * 512
    if (this.isReadOnly) {
      return this.data.subarray(offset, offset + 512)
    }
    let data = this.changeMap.get(offset)
    if (!data) {
      data = this.data.subarray(offset, offset + 512)
      this.changeMap.set(offset, data)
    }
    return data
  }

  // copy all changes cached in changeMap back to image data
  commitChanges() {
    if (!this.isReadOnly && this.changeMap.size > 0) {
      for (let [offset, data] of this.changeMap) {
        this.data.set(data, offset)
      }
      this.resetChanges()
    }
  }

  resetChanges() {
    if (!this.isReadOnly) {
      this.changeMap = new Map<number, Uint8Array>()
    }
  }
}

//------------------------------------------------------------------------------

class ProdosException {

  public error: ProdosError
  public message: string

  constructor(error: ProdosError, message?: string) {
    this.error = error
    this.message = message ?? ""
  }

  static BadFormat(message?: string) {
    return new ProdosException(ProdosError.BadFormat, message)
  }

  static BadReadIndex(message?: string) {
    return new ProdosException(ProdosError.BadReadIndex, message)
  }

  static BadFreeIndex(message?: string) {
    return new ProdosException(ProdosError.BadFreeIndex, message)
  }

  static DiskFull(message?: string) {
    return new ProdosException(ProdosError.DiskFull, message)
  }

  static FileTooBig(message?: string) {
    return new ProdosException(ProdosError.FileTooBig, message)
  }

  static Unsupported(message?: string) {
    return new ProdosException(ProdosError.Unsupported, message)
  }
}

//------------------------------------------------------------------------------

export class ProdosDateTime {
  year: number
  month: number
  day: number
  hours: number
  minutes: number

  constructor(date: number, time: number) {
    this.year = (date >> 9) + 1900
    this.month = (date >> 5) & 0xF
    this.day = date & 0x1F
    this.hours = (time >> 8) & 0x1F
    this.minutes = time & 0x3F
  }

  asDate(): string {
    const months = ["???",
      "JAN","FEB","MAR","APR","MAY","JUN",
      "JUL","AUG","SEP","OCT","NOV","DEC"]
    let str = this.day.toString().padStart(2, "\xa0")
    str += `-${months[this.month]}-`
    str += (this.year % 100).toString().padStart(2, "0")
    return str
  }

  asDateTime(): string {
    let str = this.asDate()
    str += " " + this.hours.toString().padStart(2, "\xa0")
    str += ":"
    str += this.minutes.toString().padStart(2, "0")
    return str
  }
}

//------------------------------------------------------------------------------

export class ProdosFileEntry implements FileEntry {

  private volume: ProdosVolume
  private entryData: Uint8Array

  // accessed by freeFile()
  public blockIndex: number
  public entryOffset: number

  private _name: string
  private _type: string

  // private creation: ProdosDateTime
  // private version: number
  // private minVersion: number
  // private access: number
  // private lastMod: ProdosDateTime
  // private headerPointer: number

  constructor(volume: ProdosVolume, block: BlockData, entryOffset: number) {
    this.volume = volume
    this.entryData = block.data.subarray(entryOffset, entryOffset + 0x27)
    this.blockIndex = block.index
    this.entryOffset = entryOffset

    let nameLength = this.entryData[0x0] & 0xf
    let nameBytes = []
    for (let i = 0; i < nameLength; i += 1) {
      nameBytes.push(this.entryData[0x1 + i])
    }
    this._name = String.fromCharCode(...nameBytes)

    this._type = ProdosFileType[this.typeByte]
    if (!this._type) {
      this._type = "$" + this.typeByte.toString(16).toUpperCase().padStart(2, "0")
    }

    // *** do what with these? ***
    // let creationDate = this.entryData[0x18] + (this.entryData[0x19] << 8)
    // let creationTime = this.entryData[0x1A] + (this.entryData[0x1B] << 8)
    // this.creation = new ProdosDateTime(creationDate, creationTime)
    // this.version = this.entryData[0x1C]
    // this.minVersion = this.entryData[0x1D]
    // this.access = this.entryData[0x1E]
    // let lastModDate = this.entryData[0x21] + (this.entryData[0x22] << 8)
    // let lastModTime = this.entryData[0x23] + (this.entryData[0x24] << 8)
    // this.lastMod = new ProdosDateTime(lastModDate, lastModTime)
    // this.headerPointer = this.entryData[0x25] + (this.entryData[0x26] << 8)
  }

  public get name() {
    return this._name
  }

  public get type() {
    return this._type
  }

  public get auxType() {
    return this.entryData[0x1F] + (this.entryData[0x20] << 8)
  }

  public get storageType() {
    return this.entryData[0x00] >> 4
  }

  public set storageType(value: number) {
    this.entryData[0x00] = (value << 4) | (this.entryData[0x00] & 0x0F)
  }

  public get typeByte() {
    return this.entryData[0x10]
  }

  public get keyPointer() {
    return this.entryData[0x11] + (this.entryData[0x12] << 8)
  }

  public set keyPointer(value: number) {
    this.entryData[0x11] = value & 0xff
    this.entryData[0x12] = value >> 8
  }

  public get blocksInUse() {
    return this.entryData[0x13] + (this.entryData[0x14] << 8)
  }

  public set blocksInUse(value: number) {
    this.entryData[0x13] = value & 0xff
    this.entryData[0x14] = value >> 8
  }

  public get eof() {
    return this.entryData[0x15] + (this.entryData[0x16] << 8) + (this.entryData[0x17] << 16)
  }

  public set eof(value: number) {
    this.entryData[0x15] = value & 0xff
    this.entryData[0x16] = (value >> 8) & 0xff
    this.entryData[0x17] = value >> 16
  }

  getContents(): Uint8Array | undefined {
    return this.volume.getFileContents(this)
  }

  // *** setContents() ???

  // *** immediate after every operation? ***
  writeBack() {
    const block = this.volume.readBlock(this.blockIndex)
    block.data.set(this.entryData, this.entryOffset)
  }

  // *** readEachFileBlock?
}

//------------------------------------------------------------------------------

export class ProdosVolSubDir {

  private volume: ProdosVolume
  private entryData: Uint8Array

  private _name: string

  // private creation: ProdosDateTime
  // private version: number
  // private minVersion: number
  // private access: number
  // private fileCount: number     // ***

  // sub-directory
  // private parentPointer = -1
  // private parentEntNum = -1
  // private parentEntLen = -1

  constructor(volume: ProdosVolume, keyBlock: BlockData) {
    this.volume = volume
    this.entryData = keyBlock.data.subarray(0x04, 0x04 + 0x27)

    let nameLength = this.entryData[0x0] & 0xf
    let nameBytes = []
    for (let i = 0; i < nameLength; i += 1) {
      nameBytes.push(this.entryData[0x1 + i])
    }
    this._name = String.fromCharCode(...nameBytes)

    // this.storageType = entry[0x4] >> 4
    // *** check for correct storageType ***

    // *** do what with these? ***
    // let creationDate = this.entryData[0x18] + (this.entryData[0x19] << 8)
    // let creationTime = this.entryData[0x1A] + (this.entryData[0x1B] << 8)
    // this.creation = new ProdosDateTime(creationDate, creationTime)
    // this.version = this.entryData[0x1C]
    // this.minVersion = this.entryData[0x1D]
    // this.access = this.entryData[0x1E]
    // this.fileCount = this.entryData[0x21]
    // if (this.storageType == StorageType.SubDir) {
    //   this.parentPointer = this.entryData[0x23] + (this.entryData[0x24] << 8)
    //   this.parentEntNum = this.entryData[0x25]
    //   this.parentEntLen = this.entryData[0x26]
    // }
  }

  public get name() {
    return this._name
  }

  // TODO: set name()

  public get storageType() {
    return this.entryData[0x0] >> 4
  }

  public get entryLength() {
    return this.entryData[0x1F]
  }

  public get entriesPerBlock() {
    return this.entryData[0x20]
  }

  // TODO: fileCount

  public get bitmapPointer() {
    if (this.storageType != StorageType.VolDir) {
      throw "Invalid operation"
    }
    return this.entryData[0x23] + (this.entryData[0x24] << 8)
  }

  public get totalBlocks() {
    if (this.storageType != StorageType.VolDir) {
      throw "Invalid operation"
    }
    return this.entryData[0x25] + (this.entryData[0x26] << 8)
  }

  writeBack() {
    // *** save back into image ***
  }

  // *** newEntry
  // *** deleteEntry
    // *** update mod date in both cases

  // *** addFile
  // *** addSubDir
  // *** forEachAllocatedFile?
}

//------------------------------------------------------------------------------

// fake directory containing the volume root file
export class ProdosVolFileEntry extends ProdosFileEntry {
  constructor(volume: ProdosVolume, block: BlockData) {
    super(volume, block, -1)
    this.keyPointer = block.index
  }
}

export class ProdosVolume {

  readonly blockSize = 512
  readonly volumeHeaderBlock = 2
  protected image: DiskImage
  protected volSubDir: ProdosVolSubDir    // *** don't keep around?
  public volFileEntry: ProdosFileEntry

  constructor(image: DiskImage) {
    this.image = image

    // *** share this code ***

    let block = this.readBlock(this.volumeHeaderBlock)
    this.volSubDir = new ProdosVolSubDir(this, block)
    // *** maybe just pull out interesting fields? ***

    // fake block for creating volFileEntry
    block = { index: this.volumeHeaderBlock, data: new Uint8Array(this.blockSize) }
    this.volFileEntry = new ProdosVolFileEntry(this, block)
  }

  public format(volumeName: string) {
    this.resetChanges()
    const blockCount = this.image.getBlockCount()

    // 0-1: boot loader
    // 2: volume directory key block
    // 3-5: more directory blocks
    // 6: volume bitmap

    let block = this.readBlock(2)
    block.data.fill(0)

//  block.data[0x00] = 0            // link to prev
//  block.data[0x01] = 0
    block.data[0x02] = 3            // link to next
//  block.data[0x03] = 0

    // init volume directory header
    block.data[0x04] = 0xF0         // STORAGE_TYPE
    const nameLength = Math.max(volumeName.length, 15)
    block.data[0x04] |= nameLength  // NAME_LENGTH
    for (let i = 0; i < nameLength; i += 1) {
      block.data[0x05 + i] = volumeName.charCodeAt(i)
    }
//  block.data[0x1C] = 0            // CREATION (date)
//  block.data[0x1D] = 0
//  block.data[0x1E] = 0            // CREATION (time)
//  block.data[0x1F] = 0
//  block.data[0x20] = 0            // VERSION
//  block.data[0x21] = 0            // MIN_VERSION
    block.data[0x22] = 0xC3         // ACCESS
    block.data[0x23] = 0x27         // ENTRY_LENGTH
    block.data[0x24] = 0x0D         // ENTRIES_PER_BLOCK
//  block.data[0x25] = 0            // FILE_COUNT
    block.data[0x27] = 6            // BIT_MAP_POINTER
//  block.data[0x28] = 0
    block.data[0x29] = blockCount   // TOTAL_BLOCKS
//  block.data[0x2A] = 0

    // link directory blocks
    for (let i = 3; i <= 5; i += 1) {
      block = this.readBlock(i)
      block.data.fill(0)
      block.data[0x00] = i - 1      // link to prev
//    block.data[0x01] = 0
      if (i < 5) {
        block.data[0x02] = i + 1    // link to next
//      block.data[0x03] = 0
      }
    }

    // init volume bitmap
    block = this.readBlock(6)
    block.data.fill(0)
    const byteCount = Math.floor(blockCount / 8)
    block.data[0] = 0x01
    for (let i = 1; i < byteCount; i += 1) {
      block.data[i] = 0xFF
    }

    // rebuild volumeDirEntry
    block = this.readBlock(this.volumeHeaderBlock)
    this.volSubDir = new ProdosVolSubDir(this, block)
    // *** maybe just pull out interesting fields? ***
  }

  public commitChanges() {
    this.image.commitChanges()
  }

  public resetChanges() {
    this.image.resetChanges()
  }

  public findFileEntry(pathName: string) : ProdosFileEntry | undefined {
    let dirFileEntry: ProdosFileEntry | undefined
    while (pathName.length) {

      let subName: string | undefined
      const n = pathName.indexOf("/")
      if (n >= 0) {
        subName = pathName.substring(0, n)
        pathName = pathName.substring(n + 1)
      } else {
        subName = pathName
        pathName = ""
      }

      let matchEntry: ProdosFileEntry | undefined
      this.forEachAllocatedFile((fileEntry: FileEntry) => {
        if (fileEntry.name == subName) {
          if (pathName != "") {
            // ignore non-directory in mid-path
            if (fileEntry.type != "DIR") {
              return true
            }
          }
          if (fileEntry instanceof ProdosFileEntry) {
            matchEntry = fileEntry
            return false
          }
        }
        return true
      }, dirFileEntry)

      if (!matchEntry) {
        return
      }
      dirFileEntry = matchEntry
    }
    return dirFileEntry
  }

  public forEachAllocatedFile(fileProc: ProdosFileProc, dirFileEntry?: ProdosFileEntry) {
    let volSubDir: ProdosVolSubDir | undefined
    let prevBlock = 0
    let nextBlock = dirFileEntry ? dirFileEntry.keyPointer : this.volumeHeaderBlock

    // *** use volSubDir.fileCount? ***

    while (nextBlock) {
      let curBlock = nextBlock
      let blockData = this.readBlock(curBlock)
      // skip prev/next links
      let entryOffset = 4
      if (!volSubDir) {
        volSubDir = new ProdosVolSubDir(this, blockData)
        if (volSubDir.entryLength != 0x27) {
          throw "Unsupported directory entry length"
        }
        // skip volume header
        entryOffset += 0x27
      }
      prevBlock = blockData.data[0x0] + (blockData.data[0x1] << 8)
      nextBlock = blockData.data[0x2] + (blockData.data[0x3] << 8)
      while (entryOffset + volSubDir.entryLength <= blockData.data.length) {
        if (blockData.data[entryOffset + 0x00] != 0x00) {
          let fileEntry = new ProdosFileEntry(this, blockData, entryOffset)
          if (fileEntry.storageType != 0) {
            if (!fileProc(fileEntry)) {
              return
            }
          }
        }
        entryOffset += volSubDir.entryLength
      }
    }
  }

  private allocateBlock(): BlockData {
    const bitBlockIndex = this.volSubDir.bitmapPointer
    const blockData = this.image.readBlock(bitBlockIndex)
    let index = 0
    while (index < this.volSubDir.totalBlocks) {
      for (let i = 0; i < this.blockSize; i += 1) {
        if (blockData[i] == 0) {
          index += 8
          continue
        }
        let mask = 0x80
        for (let j = 0; j < 8; j += 1) {
          if (blockData[i] & mask) {
            // *** error if outside actual volume size? ***
            blockData[i] &= ~mask
            const newBlock = this.image.readBlock(index)
            newBlock.fill(0)
            return { index, data: newBlock }
          }
          mask >>= 1
          index += 1
        }
      }
    }
    throw ProdosException.DiskFull()
  }

  public freeFile(entry: FileEntry): boolean {
    let fileEntry = entry as ProdosFileEntry
    if (!this.setFileContents(entry, new Uint8Array(0))) {
      return false
    }
    this.freeBlock(fileEntry.keyPointer)
    // *** write entry back first/instead? ***
    let blockData = this.readBlock(fileEntry.blockIndex)
    blockData.data[fileEntry.entryOffset + 0x0] = 0
    return true
  }

  public getFileContents(entry: FileEntry): Uint8Array | undefined {
    let fileEntry = entry as ProdosFileEntry
    const length = fileEntry.eof
    const fileData = new Uint8Array(length)
    try {
      this.readEachFileBlock(fileEntry, (blockData: BlockData, fileOffset: number) => {
        fileData.set(blockData.data, fileOffset)
        return true
      })
    } catch (e) {
      return
    }
    return fileData
  }

  private readEachFileBlock(fileEntry: ProdosFileEntry, dataProc: ProdosDataProc) {
    let keyBlock = this.readBlock(fileEntry.keyPointer)
    let length = fileEntry.eof
    let fileOffset = 0

    if (fileEntry.storageType == StorageType.Seedling) {
      const data = length < this.blockSize ? keyBlock.data.subarray(0, length) : keyBlock.data
      const dataBlock = { index: keyBlock.index, data: data }
      dataProc(dataBlock, fileOffset)
      return
    }

    let masterIndexBlock: BlockData | undefined
    let mibIndex: number
    let indexBlock: BlockData | undefined
    let ibIndex: number

    if (fileEntry.storageType == StorageType.Tree) {
      masterIndexBlock = keyBlock
      mibIndex = 0
      ibIndex = 256
    } else if (fileEntry.storageType == StorageType.Sapling) {
      mibIndex = 256
      indexBlock = keyBlock
      ibIndex = 0
    } else {
      throw ProdosException.BadFormat()
    }

    while (length > 0) {
      if (ibIndex == 256) {
        if (!masterIndexBlock) {
          throw ProdosException.BadFormat()
        }
        if (mibIndex == 256) {
          throw ProdosException.BadFormat()
        }
        const index = masterIndexBlock.data[mibIndex] + (masterIndexBlock.data[mibIndex + 256] << 8)
        mibIndex += 1
        if (!index) {
          fileOffset += this.blockSize * 256
          length -= this.blockSize * 256
          continue
        }
        indexBlock = this.readBlock(index)
        ibIndex = 0
      }
      if (indexBlock) {
        const index = indexBlock.data[ibIndex] + (indexBlock.data[ibIndex + 256] << 8)
        if (index) {
          const dataBlock = this.readBlock(index)
          if (length < this.blockSize) {
            dataBlock.data = dataBlock.data.subarray(0, length)
          }
          dataProc(dataBlock, fileOffset)
        }
        fileOffset += this.blockSize
        length -= this.blockSize
        ibIndex += 1
      }
    }
  }

  public setFileContents(entry: FileEntry, contents: Uint8Array): boolean {
    let fileEntry = entry as ProdosFileEntry
    try {
      this.writeEachFileSector(fileEntry, (block: BlockData, fileOffset: number): boolean => {
        let copySize = Math.min(block.data.length, contents.length - fileOffset)
        block.data.fill(0)
        block.data.set(contents.subarray(fileOffset, fileOffset + copySize))
        return fileOffset + copySize < contents.length
      })
    } catch (e) {
      return false
    }
    fileEntry.eof = contents.length
    fileEntry.writeBack()
    return true
  }

  // *** maybe don't modify fileEntry until successful? ***

  private writeEachFileSector(fileEntry: ProdosFileEntry, dataProc: ProdosDataProc) {
    let moreData = true
    let fileOffset = 0
    let masterIndexBlock: BlockData | undefined
    let mibIndex = 0
    let indexBlock: BlockData | undefined
    let ibIndex = 0

    if (fileEntry.storageType == StorageType.Seedling) {

      const dataBlock = this.readBlock(fileEntry.keyPointer)
      moreData = dataProc(dataBlock, fileOffset)
      fileOffset += dataBlock.data.length
      if (!moreData) {
        return
      }

      // promote seedling to sapling
      let newDataBlock = this.allocateBlock()
      fileEntry.blocksInUse += 1
      newDataBlock.data.set(dataBlock.data)

      // dataBlock becomes the indexBlock, to maintain block ordering
      indexBlock = { data: dataBlock.data, index: fileEntry.keyPointer }
      indexBlock.data.fill(0)
      indexBlock.data[0] = newDataBlock.index & 0xff
      indexBlock.data[0 + 256] = newDataBlock.index >> 8
      ibIndex = 1
      fileEntry.storageType = StorageType.Sapling
    } else {
      let index = fileEntry.keyPointer
      if (fileEntry.storageType == StorageType.Tree) {
        masterIndexBlock = this.readBlock(index)
        index = masterIndexBlock.data[0] + (masterIndexBlock.data[0 + 256] << 8)
        mibIndex = 1
      } else if (fileEntry.storageType != StorageType.Sapling) {
        throw ProdosException.BadFormat()
      }
      indexBlock = this.readBlock(index)
      ibIndex = 0
    }

    while (true) {

      // overwriting or growing data
      if (moreData) {

        // is index block full?
        if (ibIndex == 256) {
          // possibly promote Sapling to Tree
          if (!masterIndexBlock) {
            masterIndexBlock = this.allocateBlock()
            fileEntry.blocksInUse += 1
            masterIndexBlock.data[0] = indexBlock.index & 0xff
            masterIndexBlock.data[0 + 256] = indexBlock.index >> 8
            fileEntry.storageType = StorageType.Tree
            mibIndex = 1
          } else if (mibIndex == 256) {
            throw ProdosException.FileTooBig()
          }

          // add or read another indexBlock
          const index = masterIndexBlock.data[mibIndex] + (masterIndexBlock.data[mibIndex + 256] << 8)
          if (!index) {
            indexBlock = this.allocateBlock()
            fileEntry.blocksInUse += 1
            masterIndexBlock.data[mibIndex] = indexBlock.index & 0xff
            masterIndexBlock.data[mibIndex + 256] = indexBlock.index >> 8
            mibIndex += 1
          } else {
            indexBlock = this.readBlock(index)
          }
          ibIndex = 0
        }

        // add or read another dataBlock
        let dataBlock: BlockData
        const index = indexBlock.data[ibIndex] + (indexBlock.data[ibIndex + 256] << 8)
        if (!index) {
          dataBlock = this.allocateBlock()
          fileEntry.blocksInUse += 1
          indexBlock.data[ibIndex] = dataBlock.index & 0xff
          indexBlock.data[ibIndex + 256] = dataBlock.index >> 8
        } else {
          dataBlock = this.readBlock(index)
        }
        ibIndex += 1
        moreData = dataProc(dataBlock, fileOffset)
        fileOffset += dataBlock.data.length
        continue
      }

      // shrinking data

      // at end of index block?
      if (ibIndex == 256) {

        // is indexBlock mostly/completely empty?
        let usedCount = this.countUsed(indexBlock)

        if (masterIndexBlock) {
          // remove completely empty indexBlock from masterIndexBlock
          if (usedCount == 0) {
            this.freeBlock(indexBlock.index)
            fileEntry.blocksInUse -= 1
            masterIndexBlock.data[mibIndex - 1] = 0
            masterIndexBlock.data[mibIndex - 1 + 256] = 0
          }

          let index = 0
          while (mibIndex < 256) {
            index = masterIndexBlock.data[mibIndex] + (masterIndexBlock.data[mibIndex + 256] << 8)
            mibIndex += 1
            if (index) {
              break
            }
          }
          if (index) {
            indexBlock = this.readBlock(index)
            ibIndex = 0
            continue
          }

          // is masterIndexBlock mostly empty?
          usedCount = this.countUsed(masterIndexBlock)
          if (usedCount <= 1) {
            // NOTE: usedCount of 0 not possible in tree masterIndexBlock

            // demote tree -> sapling
            index = masterIndexBlock.data[0] + (masterIndexBlock.data[0 + 256] << 8)
            indexBlock = this.readBlock(index)
            this.freeBlock(masterIndexBlock.index)
            fileEntry.blocksInUse -= 1
            fileEntry.keyPointer = indexBlock.index
            fileEntry.storageType = StorageType.Sapling

            // update used count and fall through for possible sapling -> seedling
            usedCount = this.countUsed(indexBlock)
          }
        }

        if (usedCount <= 1) {
          // NOTE: usedCount of 0 not possible in sapling indexBlock

          // demote sapling -> seedling
          fileEntry.keyPointer = indexBlock.data[0] + (indexBlock.data[0 + 256] << 8)
          fileEntry.storageType = StorageType.Seedling
          this.freeBlock(indexBlock.index)
          fileEntry.blocksInUse -= 1
          return
        }

        if (ibIndex == 256) {
          return
        }
      }

      // free next block in indexBlock, if any
      const index = indexBlock.data[ibIndex] + (indexBlock.data[ibIndex + 256] << 8)
      if (index) {
        this.freeBlock(index)
        fileEntry.blocksInUse -= 1
        indexBlock.data[ibIndex] = 0
        indexBlock.data[ibIndex + 256] = 0
      }
      ibIndex += 1
    }
  }

  private countUsed(block: BlockData): number {
    let usedCount = 0
    for (let i = 0; i < 256; i += 1) {
      if (block.data[i] || block.data[i + 256]) {
        usedCount += 1
        if (usedCount > 1) {
          break
        }
      }
    }
    return usedCount
  }

  public readBlock(index: number): BlockData {
    const block = { index, data: this.image.readBlock(index) }
    if (!block.data) {
      throw ProdosException.BadReadIndex()
    }
    return block
  }

  private freeBlock(index: number) {
    // 512 bytes * 8 blocks (9 + 3 bits)
    const bitBlockIndex = this.volSubDir.bitmapPointer + (index >> 12)
    const blockData = this.image.readBlock(bitBlockIndex)
    if (!blockData) {
      throw ProdosException.BadFreeIndex()
    }
    // *** check for index that's too large for volume size ***
    blockData[index >> 3] |= 0x80 >> (index & 7)
  }
}

//------------------------------------------------------------------------------
