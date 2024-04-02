
import { DiskImage, BlockData } from "./disk_image"

//------------------------------------------------------------------------------

export interface FileEntry {
  get name(): string
  get type(): FileType
  get auxType(): number
  getContents(): Uint8Array
  setContents(contents: Uint8Array): void
}

export enum StorageType {
  Seedling = 0x1,
  Sapling  = 0x2,
  Tree     = 0x3,
  Dir      = 0xD,
  SubDir   = 0xE,
  VolDir   = 0xF
}

export enum FileType {
  TXT = 0x04,
  BIN = 0x06,
  DIR = 0x0F,
  AWP = 0x1A,    // AppleWorks Word Processing
  INT = 0xFA,
  BAS = 0xFC,
  REL = 0xFE,    // EDASM relocatable (R in DOS 3.3)
  SYS = 0xFF,

  // fake types only used for DOS 3.3 support
  S   = 0x100,    // often used by game cracks
  X   = 0x101,    // ("New A" renamed to avoid confusion with BASIC files)
  Y   = 0x102     // ("New B" renamed to avoid confusion with BIN files)
                  // used by LISA for source files
}

type ProdosDataProc = (block: BlockData, fileOffset: number) => boolean
type ProdosFileProc = (fileEntry: ProdosFileEntry) => boolean

export class DiskFullError extends Error {
  constructor() {
    super("Disk full")
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

function getNameBytes(name: string): number[] {
  if (name.length > 15) {
    throw new Error(`Name is too long (15 characters max)`)
  }
  const nameBytes: number[] = new Array(15).fill(0)
  for (let i = 0; i < name.length; i += 1) {
    const c = name.charCodeAt(i)
    // TODO: further restrict char codes?
    if (c > 0xff) {
      throw new Error(`Name "${name}" has invalid character (ch: ${i})`)
    }
    nameBytes[i] = c
  }
  return nameBytes
}

//------------------------------------------------------------------------------

export class ProdosFileEntry implements FileEntry {

  private volume: ProdosVolume
  public blockIndex: number
  private blockOffset: number     // offset within block (not this.data)
  private data: Uint8Array

  protected _name?: string

  constructor(volume: ProdosVolume, block: BlockData, offset: number) {
    this.volume = volume
    this.blockIndex = block.index
    this.blockOffset = offset

    this.data = block.data.subarray(offset, offset + 0x27)
  }

  initialize(fileName: string, typeByte: FileType, auxType: number): void {

    // default everything to zero
    this.data.fill(0)

    if (typeByte == FileType.DIR) {
      this.storageType = StorageType.Dir
    } else {
      this.storageType = StorageType.Seedling
    }

    this.name = fileName
    this.typeByte = typeByte
    this.auxType = auxType
    this.access = 0xC3        // delete, rename, write, and read

    // NOTE: caller must set keyPointer, blocksUsed, eof, headerPointer
  }

  public copyFrom(srcFile: ProdosFileEntry) {
    this.data.set(srcFile.data)

    // caller must fix up headerPointer
    this.headerPointer = 0
  }

  // NOTE: caller needs to free blocks, unchain directories, etc.
  public markDeleted() {
    // NOTE: don't decrement blocksUsed -- leave entry intact
    this.data[0x0] = 0x00
  }

  public getEntryIndex(): number {
    const entryIndex = (this.blockOffset - 0x04) / 0x27 + 1
    if (entryIndex != Math.floor(entryIndex)) {
      throw new Error(`Unexpected entryOffset of ${this.blockOffset}`)
    }
    return entryIndex
  }

  public get name(): string {
    if (!this._name) {
      let nameLength = this.data[0x0] & 0xf
      let nameBytes = []
      for (let i = 0; i < nameLength; i += 1) {
        nameBytes.push(this.data[0x1 + i])
      }
      this._name = String.fromCharCode(...nameBytes)
    }
    return this._name
  }

  public set name(value: string) {
    const nameBytes = getNameBytes(value)
    this.data[0x0] &= 0xF0
    this.data[0x0] |= value.length
    for (let i = 0; i < nameBytes.length; i += 1) {
      this.data[0x1 + i] = nameBytes[i]
    }
    this._name = value
  }

  public get type(): FileType {
    return this.typeByte
  }

  public get typeByte(): number {
    return this.data[0x10]
  }

  public set typeByte(value: number) {
    this.data[0x10] = value
  }

  public get auxType(): number {
    return this.data[0x1F] + (this.data[0x20] << 8)
  }

  public set auxType(value: number) {
    this.data[0x1F] = value & 0xff
    this.data[0x20] = value >> 8
  }

  public get storageType(): number {
    return this.data[0x00] >> 4
  }

  public set storageType(value: number) {
    this.data[0x00] = (value << 4) | (this.data[0x00] & 0x0F)
  }

  public get keyPointer(): number {
    return this.data[0x11] + (this.data[0x12] << 8)
  }

  public set keyPointer(value: number) {
    this.data[0x11] = value & 0xff
    this.data[0x12] = value >> 8
  }

  public get blocksUsed(): number {
    return this.data[0x13] + (this.data[0x14] << 8)
  }

  public set blocksUsed(value: number) {
    this.data[0x13] = value & 0xff
    this.data[0x14] = value >> 8
  }

  public get eof(): number {
    return this.data[0x15] + (this.data[0x16] << 8) + (this.data[0x17] << 16)
  }

  public set eof(value: number) {
    this.data[0x15] = value & 0xff
    this.data[0x16] = (value >> 8) & 0xff
    this.data[0x17] = value >> 16
  }

  public get creation(): ProdosDateTime {
    const creationDate = this.data[0x18] + (this.data[0x19] << 8)
    const creationTime = this.data[0x1A] + (this.data[0x1B] << 8)
    return new ProdosDateTime(creationDate, creationTime)
  }

  public get version(): number {
    return this.data[0x1C]
  }

  public get minVersion(): number {
    return this.data[0x1D]
  }

  public get access(): number {
    return this.data[0x1E]
  }

  private set access(value: number) {
    this.data[0x1E] = value
  }

  public get locked(): boolean {
    return this.access == 0x21
  }

  public get lastMod(): ProdosDateTime {
    const lastModDate = this.data[0x21] + (this.data[0x22] << 8)
    const lastModTime = this.data[0x23] + (this.data[0x24] << 8)
    return new ProdosDateTime(lastModDate, lastModTime)
  }

  public get headerPointer(): number {
    return this.data[0x25] + (this.data[0x26] << 8)
  }

  public set headerPointer(value: number) {
    this.data[0x25] = value & 0xff
    this.data[0x26] = value >> 8
  }

  getContents(): Uint8Array {
    return this.volume.getFileContents(this)
  }

  setContents(contents: Uint8Array): void {
    return this.volume.setFileContents(this, contents)
  }
}

//------------------------------------------------------------------------------

export class ProdosVolSubDir {

  private volume: ProdosVolume
  public keyPointer: number
  private data: Uint8Array

  private _name?: string

  constructor(volume: ProdosVolume, block: BlockData, verify: boolean = true) {
    this.volume = volume
    this.keyPointer = block.index
    this.data = block.data.subarray(0x04, 0x04 + 0x27)

    if (verify) {
      const isVolumeHeader = (block.index == 2)
      const type = this.storageType
      if (isVolumeHeader) {
        // NOTE: Many images don't have the storage type correctly set to
        //  StorageType.VolDir (0xF) so just ignore it here.
        // if (type != StorageType.VolDir) {
        //   throw new Error(`Invalid volume/subDir storageType ${type}`)
        // }
      } else {
        if (type != StorageType.SubDir) {
          throw new Error(`Invalid subDir storageType ${type}`)
        }
      }
    }
  }

  // only used for sub-directories, not volume
  public initialize(fileName: string, parentBlockIndex: number, entryIndex: number): void {

    this.data.fill(0)
    this.name = fileName
    this.storageType = StorageType.SubDir

    this.access = 0xC3        // delete, rename, write, and read

    this.data[0x1F] = 0x27         // entryLength
    this.data[0x20] = 0x0D         // entriesPerBlock

    // set magic file typeByte for a sub-directory
    this.data[0x10] = 0x75

    this.parentPointer = parentBlockIndex
    this.data[0x25] = entryIndex   // parentEntry
    this.data[0x26] = 0x27         // parentEntryLength
  }

  public get name(): string {
    if (!this._name) {
      let nameLength = this.data[0x0] & 0xf
      let nameBytes = []
      for (let i = 0; i < nameLength; i += 1) {
        nameBytes.push(this.data[0x1 + i])
      }
      this._name = String.fromCharCode(...nameBytes)
    }
    return this._name
  }

  public set name(value: string) {
    const nameBytes = getNameBytes(value)
    this.data[0x0] &= 0xF0
    this.data[0x0] |= value.length
    for (let i = 0; i < nameBytes.length; i += 1) {
      this.data[0x1 + i] = nameBytes[i]
    }
    this._name = value
  }

  public get storageType(): number {
    return this.data[0x0] >> 4
  }

  public set storageType(value: number) {
    this.data[0x00] = (value << 4) | (this.data[0x00] & 0x0F)
  }

  // magic value that's normally 0x75 or 0x76
  public get specialType(): number {
    return this.data[0x10]
  }

  // let creationDate = this.data[0x18] + (this.data[0x19] << 8)
  // let creationTime = this.data[0x1A] + (this.data[0x1B] << 8)
  // this.creation = new ProdosDateTime(creationDate, creationTime)

  public get version(): number {
    return this.data[0x1C]
  }

  public get minVersion(): number {
    return this.data[0x1D]
  }

  public get access(): number {
    return this.data[0x1E]
  }

  private set access(value: number) {
    this.data[0x1E] = value
  }

  public get entryLength(): number {
    return this.data[0x1F]
  }

  public get entriesPerBlock(): number {
    return this.data[0x20]
  }

  public get fileCount(): number {
    return this.data[0x21]
  }

  public set fileCount(value: number) {
    this.data[0x21] = value
  }

  // NOTE: For volumes, storageType might be several different values
  //  so compare against StorageType.SubDir, not StorageType.VolDir

  public get parentPointer(): number {
    if (this.storageType != StorageType.SubDir) {
      throw new Error("Invalid operation: parentPointer not valid in volDir")
    }
    return this.data[0x23] + (this.data[0x24] << 8)
  }

  public set parentPointer(value: number) {
    if (this.storageType != StorageType.SubDir) {
      throw new Error("Invalid operation: parentPointer not valid in volDir")
    }
    this.data[0x23] = value & 0xff
    this.data[0x24] = value >> 8
  }

  public get parentEntry(): number {
    if (this.storageType != StorageType.SubDir) {
      throw new Error("Invalid operation: parentEntry not valid in volDir")
    }
    return this.data[0x25]
  }

  public set parentEntry(value: number) {
    if (this.storageType != StorageType.SubDir) {
      throw new Error("Invalid operation: parentEntry not valid in volDir")
    }
    this.data[0x25] = value
  }

  public get parentEntryLength(): number {
    if (this.storageType != StorageType.SubDir) {
      throw new Error("Invalid operation: parentEntryLength not valid in volDir")
    }
    return this.data[0x26]
  }

  public get bitmapPointer(): number {
    if (this.storageType == StorageType.SubDir) {
      throw new Error("Invalid operation: bitmapPointer not valid in subDir")
    }
    return this.data[0x23] + (this.data[0x24] << 8)
  }

  public get totalBlocks(): number {
    if (this.storageType == StorageType.SubDir) {
      throw new Error("Invalid operation: totalBlocks not valid in subDir")
    }
    return this.data[0x25] + (this.data[0x26] << 8)
  }
}

//------------------------------------------------------------------------------

// fake directory that contains the volume root files
// *** redo this using initialize()? ***
export class ProdosVolFileEntry extends ProdosFileEntry {
  constructor(volume: ProdosVolume, block: BlockData) {
    super(volume, block, 0)
    this.keyPointer = block.index
    // TODO: should name come from volume?
    this._name = ""
    this.typeByte = FileType.DIR
  }
}

export class ProdosVolume {

  readonly blockSize = 512
  readonly volumeHeaderBlock = 2
  protected image: DiskImage
  private totalBlocks: number
  private bitmapPointer: number
  private bitmapBlocks: number
  public volFileEntry: ProdosFileEntry

  constructor(image: DiskImage, format: boolean = false) {
    this.image = image
    if (format) {
      this.format("UNTITLED")
    }

    this.totalBlocks = image.getBlockCount()
    this.bitmapBlocks = Math.ceil(this.totalBlocks / (512 * 8))

    // *** share this code ***

    let block = this.readBlock(this.volumeHeaderBlock)
    const volSubDir = new ProdosVolSubDir(this, block, !format)

    // TODO: For now, be strict and require the image size exactly match the volume size.
    //  This causes many Asimov images to fail, so more investigation work is needed.
    if (volSubDir.totalBlocks != this.totalBlocks) {
      throw new Error(`Image size ${this.totalBlocks} doesn't match totalBlocks ${volSubDir.totalBlocks} in header`)
    }
    this.bitmapPointer = volSubDir.bitmapPointer

    // fake block for creating volFileEntry
    block = { index: this.volumeHeaderBlock, data: new Uint8Array(this.blockSize) }
    this.volFileEntry = new ProdosVolFileEntry(this, block)
  }

  // caller is responsible for reverting changes beforehand, if necessary
  public format(volumeName: string): void {
    const blockCount = this.image.getBlockCount()
    if (blockCount > 65535) {
      throw new Error("Maximum block count of 65535 exceeded")
    }

    // 0-1: boot loader
    // 2: volume directory key block
    // 3-5: more directory blocks
    // 6+: volume bitmap

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
    block.data[0x29] = blockCount & 0xff  // TOTAL_BLOCKS
    block.data[0x2A] = blockCount >> 8

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

    const bitmapBlocks = Math.ceil(blockCount / (512 * 8))
    let byteCount = Math.ceil(blockCount / 8)
    let bitCount = blockCount & 7
    for (let i = 0; i < bitmapBlocks; i += 1) {
      block = this.readBlock(6 + i)
      block.data.fill(0)

      const count = Math.min(byteCount, 512)
      for (let j = 0; j < count; j += 1) {
        block.data[j] = 0xFF
      }
      byteCount -= count

      if (i == 0) {

        // allocate boot blocks
        this.clearBit(0, block.data)
        this.clearBit(1, block.data)

        // allocate volume directory blocks
        for (let j = 2; j <= 5; j += 1) {
          this.clearBit(j, block.data)
        }

        // allocate volume bitmap blocks
        for (let j = 0; j < bitmapBlocks; j += 1) {
          this.clearBit(6 + j, block.data)
        }
      } else if (i + 1 == bitmapBlocks) {
        if (bitCount) {
          for (let j = bitCount; j < 8; j += 1) {
            this.clearBit((count - 1) * 8 + j, block.data)
          }
        }
      }
    }

    this.totalBlocks = blockCount
    this.bitmapPointer = 6
    this.commitChanges()
  }

  private clearBit(bit: number, bytes: Uint8Array): void {
    bytes[bit >> 3] &= ~(0x80 >> (bit & 7))
  }

  public commitChanges(): void {
    this.image.commitChanges()
  }

  public revertChanges(): void {
    this.image.revertChanges()
  }

  public verify(): void {
  }

  public deleteFile(parent: FileEntry, file: FileEntry, recurse: boolean): void {
    if (file.type == FileType.DIR) {
      if (!recurse) {
        const parentSubDir = this.getSubDir(parent)
        if (parentSubDir.fileCount > 0) {
          throw new Error("Can't delete non-empty directory")
        }
      }
    }
    this.freeFileEntry(parent as ProdosFileEntry, file as ProdosFileEntry)
  }

  private freeFileEntry(parent: ProdosFileEntry, file: ProdosFileEntry): void {
    if (file.type == FileType.DIR) {
      // delete all child files
      this.forEachAllocatedFile(file, (child: FileEntry) => {
        const childEntry = child as ProdosFileEntry
        this.freeFileEntry(file, childEntry)
        return true
      })
      // unchain and free directory blocks
      let curBlockIndex = 0
      let nextBlockIndex = file.keyPointer
      while (nextBlockIndex) {
        curBlockIndex = nextBlockIndex
        const curBlock = this.readBlock(curBlockIndex)
        nextBlockIndex = curBlock.data[0x02] + (curBlock.data[0x03] << 8)
        this.freeBlock(curBlockIndex)
      }
    } else {
      this.setFileContents(file, new Uint8Array(0))
      this.freeBlock(file.keyPointer)
    }

    file.markDeleted()
    const parentSubDir = this.getSubDir(parent)
    parentSubDir.fileCount -= 1
    // TODO: update modification date in parentSubDir

    // TODO: should subDir be scanned for/pruned of empty blocks?
  }

  public renameFile(parent: FileEntry, file: FileEntry, newName: string): void {
    const fileEntry = <ProdosFileEntry>file

    if (parent.type != FileType.DIR) {
      throw new Error("parent is not a directory")
    }

    if (file.name != newName) {

      // NOTE: VSCode also does duplicate checking but it may not
      //  correctly deal with magic suffixes.
      // TODO: magic suffixes should all be done by now
      if (this.fileExists(parent, newName)) {
        throw new Error("File/directory exists with that name")
      }

      if (file.type == FileType.DIR) {
        // if renaming a directory, all need to rename it in its subDir block
        const subBlock = this.readBlock(fileEntry.keyPointer)
        const volSubDir = new ProdosVolSubDir(this, subBlock)
        volSubDir.name = newName
      }
      fileEntry.name = newName
    }
  }

  // NOTE: This does not check for the case of a folder being copied into itself.
  //  VSCode catches that case externally.  Would need to add a check here if ever
  //  operating outside VSCode extension.
  public copyDir(dstParentDir: ProdosFileEntry, srcVolume: ProdosVolume, srcDir: ProdosFileEntry) {
    const dstDir = <ProdosFileEntry>this.createFile(dstParentDir, srcDir.name, FileType.DIR, 0x0000)
    srcVolume.forEachAllocatedFile(srcDir, (fileEntry: ProdosFileEntry) => {
      if (fileEntry.type == FileType.DIR) {
        this.copyDir(dstDir, srcVolume, fileEntry)
      } else {
        const dstFile = this.createFile(dstDir, fileEntry.name, fileEntry.typeByte, fileEntry.auxType)
        const srcContents = fileEntry.getContents()
        dstFile.setContents(srcContents)
      }
      return true
    })
  }

  public moveFile(file: FileEntry, dstDir: FileEntry): void {
    const srcFile = <ProdosFileEntry>file

    if (dstDir.type != FileType.DIR) {
      throw new Error("destination is not a directory")
    }

    // make sure file name isn't already used at destination
    // *** maybe let allocateFile do this? ***
    if (this.fileExists(dstDir, file.name)) {
      throw new Error("File/directory exists in destination")
    }

    const dstFile = this.allocFileEntry(<ProdosFileEntry>dstDir)
    dstFile.copyFrom(srcFile)
    dstFile.headerPointer = (<ProdosFileEntry>dstDir).keyPointer

    if (dstFile.type == FileType.DIR) {
      // relink volSubDir back to new fileEntry
      let block = this.readBlock(dstFile.keyPointer)
      let volSubDir = new ProdosVolSubDir(this, block)
      volSubDir.parentPointer = dstFile.blockIndex
      volSubDir.parentEntry = dstFile.getEntryIndex()
      dstFile.headerPointer = (<ProdosFileEntry>dstDir).keyPointer
    }

    // decrement file count in srcFile parent subDir
    // TODO: update modification date in srcSubDir
    const block = this.readBlock(srcFile.headerPointer)
    const srcSubDir = new ProdosVolSubDir(this, block)
    srcSubDir.fileCount -= 1

    // clear file entry in its source location
    srcFile.markDeleted()
  }

  // NOTE: does not throw error on file not found
  public findFileEntry(pathName: string): FileEntry | undefined {
    let parent: ProdosFileEntry | undefined
    let file: ProdosFileEntry | undefined

    file = this.volFileEntry
    while (pathName.length > 0) {
      parent = file
      file = undefined

      let subName: string | undefined
      const n = pathName.indexOf("/")
      if (n >= 0) {
        subName = pathName.substring(0, n)
        pathName = pathName.substring(n + 1)
      } else {
        subName = pathName
        pathName = ""
      }

      this.forEachAllocatedFile(parent, (fileEntry: FileEntry) => {
        if (fileEntry.name == subName) {
          if (pathName != "") {
            // *** ignore non-directory in mid-path
            if (fileEntry.type != FileType.DIR) {
              // *** throw error? ***
              return true
            }
          }
          if (fileEntry instanceof ProdosFileEntry) {
            file = fileEntry
            return false
          }
        }
        return true
      })

      if (!file) {
        break
      }
    }
    return file
  }

  // *** VSCode checks for duplicate directories, but we should too
  // *** pass in/handle overwrite? ***
  // *** directories different?
  public createFile(parent: FileEntry, fileName: string, type: FileType, auxType: number): FileEntry {

    // TODO: validate/limit fileName *** also done in set name ***

    // *** verify that file doesn't already exist ***
    return this.allocateFile(<ProdosFileEntry>parent, fileName, type, auxType)
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

  // Find/create a free file entry and initialize it to all zeroes
  //  (it doesn't become allocated until caller initializes fields)

  private allocFileEntry(parent: ProdosFileEntry): ProdosFileEntry {
    let curBlock = this.readBlock(parent.keyPointer)
    let volSubDir = new ProdosVolSubDir(this, curBlock)
    if (volSubDir.entryLength != 0x27) {
      throw new Error(`Unsupported directory entry length of ${volSubDir.entryLength}`)
    }

    let fileEntry: ProdosFileEntry | undefined
    let entryOffset = 4 + 0x27
    while (true) {
      while (entryOffset + volSubDir.entryLength <= curBlock.data.length) {
        if (curBlock.data[entryOffset + 0x00] == 0x00) {
          for (let i = 0; i < 0x27; i += 1) {
            curBlock.data[entryOffset + i] = 0
          }
          fileEntry = new ProdosFileEntry(this, curBlock, entryOffset)
          volSubDir.fileCount += 1
          break
        }
        entryOffset += volSubDir.entryLength
      }
      if (fileEntry) {
        break
      }
      const nextBlockIndex = curBlock.data[0x2] + (curBlock.data[0x3] << 8)
      if (nextBlockIndex) {
        curBlock = this.readBlock(nextBlockIndex)
      } else {
        // chain a new directory block
        const nextBlock = this.allocateBlock()
        parent.blocksUsed += 1
        curBlock.data[0x02] = nextBlock.index & 0xff
        curBlock.data[0x03] = nextBlock.index >> 8
        nextBlock.data[0x00] = curBlock.index & 0xff
        nextBlock.data[0x01] = curBlock.index >> 8
        curBlock = nextBlock
      }
      entryOffset = 4
    }

    return fileEntry
  }

  private allocateFile(parent: ProdosFileEntry, fileName: string, type: FileType, auxType: number): FileEntry {

    const fileEntry = this.allocFileEntry(parent)
    fileEntry.initialize(fileName, type, auxType)
    fileEntry.headerPointer = parent.keyPointer

    const keyBlock = this.allocateBlock()
    fileEntry.keyPointer = keyBlock.index
    fileEntry.blocksUsed += 1

    if (type == FileType.DIR) {
      // NOTE: don't verify in ProdosVolSubDir before initializing it
      const subDir = new ProdosVolSubDir(this, keyBlock, false)
      const entryIndex = fileEntry.getEntryIndex()
      subDir.initialize(fileName, fileEntry.blockIndex, entryIndex)
    }

    return fileEntry
  }

  // NOTE: This needs to work correctly even when files are being deleted
  //  from within the callback function.
  public forEachAllocatedFile(parent: FileEntry | undefined, fileProc: ProdosFileProc) {
    if (!parent) {
      parent = this.volFileEntry
    }
    let curBlock = this.readBlock((<ProdosFileEntry>parent).keyPointer)
    let volSubDir = new ProdosVolSubDir(this, curBlock)
    if (volSubDir.entryLength != 0x27) {
      throw new Error(`Unsupported directory entry length of ${volSubDir.entryLength}`)
    }

    let entryOffset = 4 + 0x27
    let fileIndex = 0
    // copy this before it gets modified by a delete
    const fileCount = volSubDir.fileCount
    while (true) {
      while (entryOffset + volSubDir.entryLength <= curBlock.data.length) {
        if (curBlock.data[entryOffset + 0x00] != 0x00) {
          let fileEntry = new ProdosFileEntry(this, curBlock, entryOffset)
          if (!fileProc(fileEntry)) {
            return true
          }
          fileIndex += 1
          if (fileIndex >= fileCount) {
            break
          }
        }
        entryOffset += volSubDir.entryLength
      }
      if (fileIndex >= fileCount) {
        break
      }
      const nextBlockIndex = curBlock.data[0x2] + (curBlock.data[0x3] << 8)
      if (!nextBlockIndex) {
        break
      }
      curBlock = this.readBlock(nextBlockIndex)
      entryOffset = 4
    }
  }

  private getSubDir(file: FileEntry): ProdosVolSubDir {
    const fileEntry = file as ProdosFileEntry
    if (fileEntry.type != FileType.DIR) {
      throw new Error("getSubDir only valid on directory")
    }
    const keyBlock = this.readBlock(fileEntry.keyPointer)
    return new ProdosVolSubDir(this, keyBlock)
  }

  public getFileContents(file: FileEntry): Uint8Array {
    let fileEntry = file as ProdosFileEntry
    const length = fileEntry.eof
    const fileData = new Uint8Array(length)
    this.readEachFileBlock(fileEntry, (blockData: BlockData, fileOffset: number) => {
      fileData.set(blockData.data, fileOffset)
      return true
    })
    return fileData
  }

  private readEachFileBlock(fileEntry: ProdosFileEntry, dataProc: ProdosDataProc): void {
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
      throw new Error(`Unknown storage type ${fileEntry.storageType}`)
    }

    while (length > 0) {
      if (ibIndex == 256) {
        if (mibIndex == 256) {
          break
        }
        if (!masterIndexBlock) {
          throw new Error("Missing master index block")  // should be impossible
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

  public setFileContents(entry: FileEntry, contents: Uint8Array): void {
    let fileEntry = entry as ProdosFileEntry
    this.writeEachFileSector(fileEntry, (block: BlockData, fileOffset: number): boolean => {
      let copySize = Math.min(block.data.length, contents.length - fileOffset)
      block.data.fill(0)
      block.data.set(contents.subarray(fileOffset, fileOffset + copySize))
      return fileOffset + copySize < contents.length
    })
    fileEntry.eof = contents.length
  }

  private writeEachFileSector(fileEntry: ProdosFileEntry, dataProc: ProdosDataProc): void {
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

      // promote seedling -> sapling
      let newDataBlock = this.allocateBlock()
      fileEntry.blocksUsed += 1
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
        throw new Error(`Unexpected storage type ${fileEntry.storageType}`)
      }
      indexBlock = this.readBlock(index)
      ibIndex = 0
    }

    while (true) {

      // overwriting or growing data
      if (moreData) {

        // is index block full?
        if (ibIndex == 256) {
          // possibly promote sapling -> tree
          if (!masterIndexBlock) {
            masterIndexBlock = this.allocateBlock()
            fileEntry.blocksUsed += 1
            masterIndexBlock.data[0] = indexBlock.index & 0xff
            masterIndexBlock.data[0 + 256] = indexBlock.index >> 8
            fileEntry.keyPointer = masterIndexBlock.index
            fileEntry.storageType = StorageType.Tree
            mibIndex = 1
          } else if (mibIndex == 256) {
            throw new Error("File too big")
          }

          // add or read another indexBlock
          const index = masterIndexBlock.data[mibIndex] + (masterIndexBlock.data[mibIndex + 256] << 8)
          if (!index) {
            indexBlock = this.allocateBlock()
            fileEntry.blocksUsed += 1
            masterIndexBlock.data[mibIndex] = indexBlock.index & 0xff
            masterIndexBlock.data[mibIndex + 256] = indexBlock.index >> 8
          } else {
            indexBlock = this.readBlock(index)
          }
          mibIndex += 1
          ibIndex = 0
        }

        // add or read another dataBlock
        let dataBlock: BlockData
        const index = indexBlock.data[ibIndex] + (indexBlock.data[ibIndex + 256] << 8)
        if (!index) {
          dataBlock = this.allocateBlock()
          fileEntry.blocksUsed += 1
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
        let usedCount = this.countUsedIndexes(indexBlock)

        if (masterIndexBlock) {
          // remove completely empty indexBlock from masterIndexBlock
          if (usedCount == 0) {
            this.freeBlock(indexBlock.index)
            fileEntry.blocksUsed -= 1
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
          usedCount = this.countUsedIndexes(masterIndexBlock)
          if (usedCount <= 1) {
            // NOTE: usedCount of 0 not possible in tree masterIndexBlock

            // demote tree -> sapling
            index = masterIndexBlock.data[0] + (masterIndexBlock.data[0 + 256] << 8)
            indexBlock = this.readBlock(index)
            this.freeBlock(masterIndexBlock.index)
            fileEntry.blocksUsed -= 1
            fileEntry.keyPointer = indexBlock.index
            fileEntry.storageType = StorageType.Sapling

            // update used count and fall through for possible sapling -> seedling
            usedCount = this.countUsedIndexes(indexBlock)
          }
        }

        if (usedCount <= 1) {
          // NOTE: usedCount of 0 not possible in sapling indexBlock

          // demote sapling -> seedling
          fileEntry.keyPointer = indexBlock.data[0] + (indexBlock.data[0 + 256] << 8)
          fileEntry.storageType = StorageType.Seedling
          this.freeBlock(indexBlock.index)
          fileEntry.blocksUsed -= 1
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
        fileEntry.blocksUsed -= 1
        indexBlock.data[ibIndex] = 0
        indexBlock.data[ibIndex + 256] = 0
      }
      ibIndex += 1
    }
  }

  private countUsedIndexes(block: BlockData): number {
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

  private allocateBlock(): BlockData {
    let index = 0
    for (let blockIndex = 0; blockIndex < this.bitmapBlocks; blockIndex += 1) {
      const bitBlockIndex = this.bitmapPointer + blockIndex
      const block = this.readBlock(bitBlockIndex)
      for (let i = 0; i < this.blockSize; i += 1) {
        if (block.data[i] == 0) {
          index += 8
          continue
        }
        let mask = 0x80
        for (let j = 0; j < 8; j += 1) {
          if (index >= this.totalBlocks) {
            throw new DiskFullError()
          }
          if (block.data[i] & mask) {
            block.data[i] &= ~mask
            const newBlock = this.readBlock(index)
            newBlock.data.fill(0)
            return newBlock
          }
          mask >>= 1
          index += 1
        }
      }
    }
    throw new DiskFullError()
  }

  public freeBlock(index: number): void {
    if (index >= this.totalBlocks) {
      throw new Error(`freeBlock of ${index} out of range`)
    }

    // 4 bits (16 blocks of bitmap)
    // 9 bits (512 bytes in bitmap block)
    // 3 bits (8 bits per byte)
    const blockIndex = (index >> 12)
    const byteIndex = (index >> 3) & 0x1FF
    const bitIndex = (index & 7)

    const bitBlockIndex = this.bitmapPointer + blockIndex
    const blockData = this.readBlock(bitBlockIndex)
    blockData.data[byteIndex] |= 0x80 >> bitIndex
  }

  public readBlock(index: number): BlockData {
    if (index == 0) {
      throw new Error(`Reading block 0 not allowed`)
    }
    const block = this.image.readBlock(index)
    if (!block.data) {
      throw new Error(`Failed to read block ${index}`)
    }
    return block
  }
}

//------------------------------------------------------------------------------
