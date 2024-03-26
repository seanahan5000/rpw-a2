
import { DiskImage, BlockData } from "./disk_image"
import { StorageType } from "./prodos"
import { ProdosVolume, ProdosFileEntry, ProdosVolSubDir, ProdosFileType } from "./prodos"

enum BlockState {
  FREE = 0,
  USED = 1,
  REFED = 2
}

export class VerifiedProdosVolume extends ProdosVolume {

  private blockStates: BlockState[] = []

  constructor(image: DiskImage, reformat: boolean) {
    super(image, reformat)
    // *** verify on construct? ***
  }

  public commitChanges(): void {
    this.verify()
    super.commitChanges()
  }

  public revertChanges(): void {
    super.revertChanges()
    // *** this will become excessive ***
    this.verify()
    super.revertChanges()
  }

  public verify() {
    try {
      this.verifyVolume()
    } catch (e: any) {
      console.log(e.message)
    }
  }

  private verifyVolume() {

    // NOTE: will be referenced in verifyVolSubDir
    const volBlock = this.readBlock(2)

    const totalBlocks = volBlock.data[0x29] + (volBlock.data[0x2A] << 8)
    this.checkWarn(totalBlocks == this.image.getBlockCount(),
      `Image size ${this.image.getBlockCount()} doesn't match totalBlocks ${totalBlocks}`)

    const bitmapBlocks = Math.ceil(totalBlocks / (512 * 8))
    const bitmapPointer = volBlock.data[0x27] + (volBlock.data[0x28] << 8)

    this.blockStates = new Array(totalBlocks).fill(BlockState.USED)
    let index = 0
    for (let blockIndex = 0; blockIndex < bitmapBlocks; blockIndex += 1) {
      const block = this.readBlock(bitmapPointer + blockIndex)
      for (let i = 0; i < 512; i += 1) {
        let mask = 0x80
        for (let j = 0; j < 8; j += 1) {
          if (block.data[i] & mask) {
            this.checkWarn(index < totalBlocks,
              `Block ${index} marked as free but outside totalBlocks range`)
            this.blockStates[index] = BlockState.FREE
          }
          mask >>= 1
          index += 1
        }
      }
    }

    this.checkWarn(this.blockStates[0] != BlockState.FREE, "Boot block 0 marked as free")
    this.checkWarn(this.blockStates[1] != BlockState.FREE, "Boot block 1 marked as free")
    this.blockStates[0] = BlockState.REFED
    this.blockStates[1] = BlockState.REFED

    for (let blockIndex = 0; blockIndex < bitmapBlocks; blockIndex += 1) {
      this.checkWarn(this.blockStates[bitmapPointer + blockIndex] != BlockState.FREE,
        `Bitmap block ${bitmapPointer + blockIndex} marked as free`)
      this.blockStates[bitmapPointer + blockIndex] = BlockState.REFED
    }

    this.verifyVolDir()

    for (let i = 0; i < totalBlocks; i += 1) {
      this.checkWarn(this.blockStates[i] != BlockState.USED,
        `Block ${i} marked as used but never referenced`)
    }
  }

  private verifyVolDir() {
    let curBlock = this.refReadBlock(2)
    const subDir = new ProdosVolSubDir(this, curBlock)
    this.progress(`Checking ${subDir.name}`)
    this.verifyVolSubDir(curBlock, subDir, StorageType.VolDir, undefined)
  }

  private verifySubDir(dirEntry: ProdosFileEntry) {
    let curBlock = this.refReadBlock(dirEntry.keyPointer)
    const subDir = new ProdosVolSubDir(this, curBlock)
    this.verifyVolSubDir(curBlock, subDir, StorageType.SubDir, dirEntry)
  }

  private verifyVolSubDir(curBlock: BlockData, subDir: ProdosVolSubDir, storageType: StorageType, dirEntry?: ProdosFileEntry) {

    this.check(subDir.storageType == storageType,
      `Expected storageType ${storageType}, got ${subDir.storageType}`)
    this.check(subDir.name.length > 0, "Empty name")
    // TODO: check creation date/time
    // ignore subDir.version
    this.check(subDir.minVersion == 0x00,
      `Unsupported minVersion ${subDir.minVersion}`)
    this.check((subDir.access & 0x1C) == 0x00,
      `Unsupported access value 0x${subDir.access.toString(16)}`)
    this.check(subDir.entryLength == 0x27,
      `Unsupported entryLength ${subDir.entryLength}`)
    this.check(subDir.entriesPerBlock == 0x0D,
      `Unsupported entriesPerBlock ${subDir.entriesPerBlock}`)

    if (storageType == StorageType.SubDir && dirEntry) {

      this.check(subDir.specialType == 0x75 || subDir.specialType == 0x76,
        `SubDir magic value of 0x75 expected at data[0x14], got 0x${subDir.specialType.toString(16)}`)

      this.check(subDir.parentPointer == dirEntry.blockIndex,
        `Bad dir.parentPointer: expected ${subDir.parentPointer}, saw ${dirEntry.blockIndex}`)

      const entryIndex = dirEntry.getEntryIndex()
      this.check(subDir.parentEntry == entryIndex,
        `Bad dir.parentEntry: expected ${subDir.parentEntry}, saw ${entryIndex}`)

      this.check(subDir.parentEntryLength == 0x27,
        `Unsupported parentEntryLength ${subDir.parentEntryLength}`)
    }

    let dirBlockCount = 1
    let sawPrevIndex = 0
    let fileCount = 0
    let entryOffset = 4 + 0x27
    while (true) {

      let prevIndex = curBlock.data[0x00] + (curBlock.data[0x01] << 8)
      this.check(prevIndex == sawPrevIndex,
        `Bad dir block linkage: expected prevIndex == ${prevIndex}, saw ${sawPrevIndex}`)

      while (entryOffset + 0x27 <= curBlock.data.length) {
        if (curBlock.data[entryOffset + 0x00] != 0x00) {
          // *** progress?
          // *** validate all name characters ***
          const fileEntry = new ProdosFileEntry(this, curBlock, entryOffset)
          this.verifyFileDir(subDir, fileEntry)
          fileCount += 1
        }
        entryOffset += 0x27
      }

      const nextIndex = curBlock.data[0x02] + (curBlock.data[0x03] << 8)
      if (!nextIndex) {
        break
      }

      sawPrevIndex = curBlock.index
      curBlock = this.refReadBlock(nextIndex)
      dirBlockCount += 1
      entryOffset = 4
    }

    this.check(fileCount == subDir.fileCount,
      `Bad fileCount: expected ${subDir.fileCount} but counted ${fileCount}`)

    if (dirEntry) {
      this.check(dirBlockCount == dirEntry.blocksUsed,
        `Bad dir.blocksUsed: expected ${dirEntry.blocksUsed} but counted ${dirBlockCount}`)
    }
  }

  private verifyFileDir(parentSubDir: ProdosVolSubDir, file: ProdosFileEntry) {
    this.progress(`Checking ${file.name}`)

    this.check(file.name.length > 0, "Empty name")
    // TODO: check creation date/time
    // ignore file.version
    this.check(file.minVersion == 0x00,
      `Unsupported minVersion ${file.minVersion}`)
    this.check((file.access & 0x18) == 0x00,
      `Unsupported access value 0x${file.access.toString(16)}`)
    this.check(file.headerPointer == parentSubDir.keyPointer,
      `Bad file to parent link: expected ${parentSubDir.keyPointer}, saw ${file.headerPointer}`)
    // TODO: check lastMod date/time

    if (file.storageType == StorageType.Dir) {
      this.check(file.typeByte == ProdosFileType.DIR,
        `Bad type in directory: expected ${ProdosFileType.DIR}, saw ${file.typeByte}`)
      // *** this.check(file.eof == 0x000000)     // TODO: correct for directories? *** 0x400 (2 blocks?)
      // *** this.check(file.auxType == 0x0000)   // TODO: correct for directories? *** 0x2000
      this.verifySubDir(file)
      return
    }

    // TODO: inspect file.auxType for expected values?

    const keyBlock = this.refReadBlock(file.keyPointer)
    if (file.storageType == StorageType.Seedling) {
      this.check(file.eof <= 512,
        `Bad eof: expected <= 512, saw ${file.eof}`)
      this.check(file.blocksUsed == 1,
        `Bad blocksUsed count: expected ${file.blocksUsed}, counted ${file.blocksUsed}`)
      return
    }

    let masterIndexBlock: BlockData | undefined
    let mibIndex: number
    let indexBlock: BlockData | undefined
    let ibIndex: number

    if (file.storageType == StorageType.Tree) {
      masterIndexBlock = keyBlock
      mibIndex = 0
      ibIndex = 256
    } else if (file.storageType == StorageType.Sapling) {
      mibIndex = 256
      indexBlock = keyBlock
      ibIndex = 0
    } else {
      this.check(false, `Unexpected file storageType ${file.storageType}`)
      return
    }

    let fileOffset = 0
    let lastData = 0
    let blocksUsed = 1
    while (true) {
      if (ibIndex == 256) {
        if (mibIndex == 256) {
          break
        }
        if (!masterIndexBlock) {
          this.check(false, "Missing masterIndexBlock?")  // should be impossible
          return
        }
        const index = masterIndexBlock.data[mibIndex] + (masterIndexBlock.data[mibIndex + 256] << 8)
        mibIndex += 1
        if (!index) {
          fileOffset += this.blockSize * 256
          continue
        }
        indexBlock = this.refReadBlock(index)
        blocksUsed += 1
        ibIndex = 0
      }
      if (indexBlock) {
        const index = indexBlock.data[ibIndex] + (indexBlock.data[ibIndex + 256] << 8)
        if (index) {
          this.refReadBlock(index)
          lastData = fileOffset
          blocksUsed += 1
        }
        fileOffset += this.blockSize
        ibIndex += 1
      }
    }

    this.check(lastData <= file.eof,
      `File.eof ${file.eof} is before last seen data at ${lastData}`)

    this.check(blocksUsed == file.blocksUsed,
      `Bad blocksUsed count: expected ${file.blocksUsed}, counted ${blocksUsed}`)
  }

  private refReadBlock(index: number): BlockData {
    this.refBlock(index)
    return this.readBlock(index)
  }

  private refBlock(index: number) {

    // range check index
    this.check(index >= 0 && index < this.blockStates.length,
      `block index ${index} out of range`)

    // check for free block
    this.check(this.blockStates[index] != BlockState.FREE,
      `block ${index} is marked as free but referenced`)

    // check for already referenced
    this.check(this.blockStates[index] == BlockState.USED,
      `block ${index} already referenced`)

    // mark as now referenced
    this.blockStates[index] = BlockState.REFED
  }

  private check(test: boolean, message: string) {
    if (!test) {
      throw new Error(message)
    }
  }

  private checkWarn(test: boolean, message: string) {
    if (!test) {
      console.log(message)
    }
  }

  private progress(message: string) {
    // console.log(message)
  }
}



// *** test making many files and directories and then deleting them

function testProdos() {

  // *** iterate through volume sizes to catch all bitmap sizes ***
  // *** test larger jumps up/down in size ***

  const diskImage = new DiskImage("hdv", new Uint8Array(0x1FFFE00), false)
  const volume = new VerifiedProdosVolume(diskImage, true)

  const parent = volume.findFileEntry("")
  if (!parent) {
    return
  }

  const file = volume.createFile(parent, "TEST_FILE", ProdosFileType.BIN, 0x2000)
  let direction = 1
  let fileSize = 0x100
  const maxFileSize = 0x0ffffff

  while (true) {
    const inData = new Uint8Array(fileSize)

    let value = 0
    for (let i = 0; i < inData.length; i += 1) {
      inData[i] = value++
      // let value change phase wrt block
      if (value == 255) {
        value = 0
      }
    }

    file.setContents(inData)
    volume.verify()

    const outData = file.getContents()
    if (outData.length != fileSize) {
      console.log("error")
    }

    for (let i = 0; i < inData.length; i += 1) {
      if (inData[i] != outData[i]) {
        console.log("error")
        break
      }
    }

    if (direction > 0) {
      if (fileSize < 0x100000) {
        fileSize += 0x1100
      } else {
        fileSize += 0x100100
      }
      if (fileSize > maxFileSize) {
        fileSize = maxFileSize
        direction = -1
      }
    } else {
      if (fileSize == 0) {
        break
      }
      if (fileSize < 0x100000) {
        fileSize -= 0x1100
      } else {
        fileSize -= 0x100100
      }
      if (fileSize < 0) {
        fileSize = 0
      }
    }
  }
}

// testProdos()    // ***

// *** TESTING: create files and dirs using Prodos, compare result against this
  // *** start with same empty .po image in both cases

// *** stress test creating/deleting/moving files and directories


// *** dragging ALIENS folder from TFDEMO.PO to empty TEST.PO fails

// *** dragging long file name file from DOS 3.3 to Prodos leaves stub file

// *** dragging AUTOMATION.PIC 3.3 -> Prodos leaves file that doesn't open

// *** create directory at volume root still has problems -- shows up in other volumes ***

// *** prune directory block after all files in it are deleted

//------------------------------------------------------------------------------

// track parallel dir/file tree
// track pass number
  // do random dir/file create/rename/delete
  // compare tree against image
// after N iterations
  // delete all files
  // check final state

// stress files (DOS 3.3)
  // create file of random size/name
    // if disk full, delete random file
    // verify after every operation
  // after looping, delete all remaining files
  // confirm final size/state

// stress files/dirs (Prodos)
  // create a random directory

//------------------------------------------------------------------------------

import * as fs from 'fs'
import { VerifiedDos33Volume } from "./test_dos33"

function processFile(fileName: string) {
  const n = fileName.lastIndexOf(".")
  if (n >= 0) {
    const suffix = fileName.substring(n + 1).toLowerCase()
    if (suffix == "dsk" || suffix == "do" || suffix == "po" || suffix == "2mg" || suffix == "hdv") {
      // console.log("Processing " + fileName)
      const diskData = fs.readFileSync(fileName)
      try {
        const diskImage = new DiskImage(suffix, diskData, false)
        if (diskImage.isDos33) {
          const volume = new VerifiedDos33Volume(diskImage, false)
        } else {
          const volume = new VerifiedProdosVolume(diskImage, false)
        }
      } catch (e: any) {
        console.log("Processing " + fileName)
        console.log("  ### " + e.message)
      }
      return
    }
  }
  // console.log("Ignored " + fileName)
}

function processDir(dirName: string) {
  const files = fs.readdirSync(dirName)
  for (let file of files) {
    const fileName = dirName + "/" + file
    if (fs.lstatSync(fileName).isDirectory()) {
      processDir(fileName)
    } else {
      processFile(fileName)
    }
  }
}

// processDir("/Users/sean/dev/test_apple_ii")

//------------------------------------------------------------------------------
