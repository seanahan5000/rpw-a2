import * as fs from 'fs'
import * as vscode from 'vscode'
import * as path from 'path'
import { DiskImage, SectorOrder, TwoMGHeader } from "../filesys/disk_image"
import { FileEntry, ProdosVolume, ProdosFileEntry, FileType } from "../filesys/prodos"
import { Dos33Volume } from '../filesys/dos33'

import { VerifiedProdosVolume } from "../filesys/test_prodos"
import { VerifiedDos33Volume } from "../filesys/test_dos33"
import { ViewMerlin, ViewLisa2 } from '../data_viewers'

// TODO: mark volumes that fail validation as read-only

//------------------------------------------------------------------------------

type Volume = Dos33Volume | ProdosVolume

type FileCacheEntry = {
  fileData: Uint8Array,
  convertedData: Uint8Array
}

type FileInfo = {
  name: string,
  type: FileType,
  auxType: number
}

//------------------------------------------------------------------------------

class FileDiskImage extends DiskImage {

  private path: string

  constructor(path: string, ext: string, data: Uint8Array, readOnly = false) {
    super(ext, data, readOnly)
    this.path = path
  }

  commitChanges() {
    if (this.workingData) {
      super.commitChanges()
      if (!this.isReadOnly) {
        fs.writeFileSync(this.path, this.fullData)
      }
    }
  }
}

//------------------------------------------------------------------------------

function createVolume(volumeUri: vscode.Uri, isReadOnly: boolean): Volume {

  const config = vscode.workspace.getConfiguration("rpwa2.filesystem")
  const verifiedVolume = config.get<boolean>("verify", true)

  const pathName = volumeUri.path
  let volumeName = path.posix.basename(volumeUri.path)
  const n = pathName.lastIndexOf(".")
  if (n < 0) {
    throw vscode.FileSystemError.FileNotFound(volumeUri)
  }
  const ext = pathName.slice(n + 1).toLowerCase()
  volumeName = pathName.slice(0, n)
  let reformat = false
  let diskData: Uint8Array

  diskData = fs.readFileSync(pathName)
  if (diskData.length == 0) {
    let newSize = 0
    // TODO: add settings for default sizes?
    if (ext == "dsk" || ext == "do") {
      newSize = 143360
    } else if (ext == "po") {
      newSize = 0xC8000         // 800K floppy
    } else if (ext == "2mg") {
      newSize = 0x168000 + 64   // 1.2M floppy
    } else if (ext == "hdv") {
      newSize = 0x1FFFE00       // 32M hard disk
    } else {
      throw new Error(`Unknown disk volume type "${ext}"`)
    }
    diskData = new Uint8Array(newSize)
    if (ext == "2mg") {
      const tmg = new TwoMGHeader(diskData)
      tmg.format()
    }
    reformat = true
  }

  let volume: Volume
  const diskImage = new FileDiskImage(pathName, ext, diskData, isReadOnly)

  if (diskImage.imageOrder == SectorOrder.Unknown) {

    const dosOrders   = [ SectorOrder.Dos33, SectorOrder.Prodos, SectorOrder.Prodos, SectorOrder.Unknown ]
    const imageOrders = [ SectorOrder.Dos33, SectorOrder.Dos33,  SectorOrder.Prodos, SectorOrder.Unknown ]

    for (let i = 0; i < dosOrders.length; i += 1) {
      diskImage.revertChanges()
      diskImage.dosOrder = dosOrders[i]
      diskImage.imageOrder = imageOrders[i]
      if (diskImage.dosOrder == SectorOrder.Dos33) {
        if (Dos33Volume.CheckImage(diskImage)) {
          break
        }
      } else if (diskImage.dosOrder == SectorOrder.Prodos) {
        if (ProdosVolume.CheckImage(diskImage)) {
          break
        }
      } else {
        throw new Error(`Unknown disk volume sector order`)
      }
    }
  }

  if (diskImage.dosOrder == SectorOrder.Dos33) {
    if (verifiedVolume) {
      volume = new VerifiedDos33Volume(diskImage, reformat)
    } else {
      volume = new Dos33Volume(diskImage, reformat)
    }
  } else {
    if (verifiedVolume) {
      volume = new VerifiedProdosVolume(diskImage, reformat)
    } else {
      volume = new ProdosVolume(diskImage, reformat)
    }
  }

  // TODO: after reformat, add UNTITLED.PIC file?

  volume.verify()
  // TODO: is if verify fails, force image to readOnly?
  return volume
}

//------------------------------------------------------------------------------

export class Apple2FileSystem implements vscode.FileSystemProvider {

  private volumes = new Map<string, Volume>()

  private bufferedEvents: vscode.FileChangeEvent[] = []
  private fireSoonTimer?: NodeJS.Timer
  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event

  public watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
    // ignore, fires for all changes
    return new vscode.Disposable(() => { })
  }

  private fireSoon(...events: vscode.FileChangeEvent[]): void {
    // TODO: option to fire immediately -- at least for testing?
    this.bufferedEvents.push(...events)
    if (this.fireSoonTimer) {
      clearTimeout(this.fireSoonTimer)
    }
    this.fireSoonTimer = setTimeout(() => {
      this.emitter.fire(this.bufferedEvents)
      this.bufferedEvents = []
    }, 5)
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    let volume: Volume | undefined
    try {
      const volumeUri = vscode.Uri.parse(uri.query)
      volume = this.volumes.get(volumeUri.path)
      if (!volume) {
        // TODO: get readOnly state from actual image file?
        const isReadOnly = false
        volume = createVolume(volumeUri, isReadOnly)
        this.volumes.set(volumeUri.path, volume)
      }

      const fileName = path.posix.basename(uri.path)
      const dirName = this.getDirName(uri)
      if (dirName == "" && fileName == "") {
        const { ctime, mtime, size } = await vscode.workspace.fs.stat(volumeUri)
        return { type: vscode.FileType.Directory, ctime, mtime, size }
      }

      const parentDir = this.mustFindParentDir(volume, uri)
      const file = this.mustFindFileOrDir(volume, parentDir, uri)

      // TODO: get time information from actual files
      const ctime = Date.now()
      const mtime = Date.now()
      let size = 0
      if (file.type == FileType.DIR) {
        return { type: vscode.FileType.Directory, ctime, mtime, size }
      } else {
        const contents = file.getContents()
        const fileStat: vscode.FileStat = { type: vscode.FileType.File, ctime, mtime, size: contents.length }
        // NOTE: Using fileStat.permissions = vscode.FilePermission.Readonly
        //  her is too restrictive prevents deleting/moving files, in addition
        //  to preventing editing.
        return fileStat
      }
    } catch (e: any) {
      volume?.revertChanges()
      throw e
    }
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    let volume: Volume | undefined
    try {
      volume = this.getVolume(uri)
      const dir = this.mustFindDir(volume, uri)
      const entries: [string, vscode.FileType][] = []
      volume.forEachAllocatedFile(dir, (fileEntry: FileEntry) => {
        const fileName = this.getFullFileName(fileEntry)
        if (fileEntry.type == FileType.DIR) {
          entries.push([fileName, vscode.FileType.Directory])
        } else {
          entries.push([fileName, vscode.FileType.File])
        }
        return true
      })
      // NOTE: no need to commitChanges on read-only operation
      return entries
    } catch (e: any) {
      volume?.revertChanges()
      throw e
    }
  }

  public createDirectory(uri: vscode.Uri): void | Thenable<void> {
    let volume: Volume | undefined
    try {
      volume = this.getVolume(uri)
      if (volume instanceof Dos33Volume) {
        throw new Error("Not allowed on a Dos 3.3 volume")
      }

      const parentDir = this.mustFindParentDir(volume, uri)
      let file = this.mayFindFileOrDir(volume, parentDir, uri)
      if (file) {
        // TODO: should create on existing directory be ignored?
        vscode.FileSystemError.FileExists(uri)
      }

      const baseName = path.posix.basename(uri.path)
      volume.createFile(parentDir, baseName, FileType.DIR, 0x0000)
      volume.commitChanges()

      const dirName = uri.with({ path: path.posix.dirname(uri.path) })
      this.fireSoon(
        { type: vscode.FileChangeType.Changed, uri: dirName },
        { type: vscode.FileChangeType.Created, uri: uri }
      )
    } catch (e: any) {
      volume?.revertChanges()
      throw e
    }
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    let volume: Volume | undefined
    try {
      volume = this.getVolume(uri)
      const file = this.mustFindFile(volume, uri)
      const fileData = volume.getFileContents(file)
      const config = vscode.workspace.getConfiguration("rpwa2.filesystem.convert")

      let convertedData: Uint8Array | undefined
      if (file.type == FileType.TXT) {
        if (file.name.toUpperCase().endsWith(".S")) {
          if (config.get<boolean>("merlin", true)) {
            const newStr = ViewMerlin.asText(fileData, false)
            const utf8Encode = new TextEncoder()
            convertedData = utf8Encode.encode(newStr)
          }
        } else {
          if (config.get<boolean>("txt", true)) {
            convertedData = new Uint8Array(fileData.length)
            for (let i = 0; i < fileData.length; i += 1) {
              // TODO: mask instead of flip high bits?
              convertedData[i] = fileData[i] ^ 0x80
            }
          }
        }
      } else if (file.type == FileType.Y && file.auxType == 0x1800) {
        if (config.get<boolean>("lisa2", true)) {
          const newStr = ViewLisa2.asText(fileData, false)
          const utf8Encode = new TextEncoder()
          convertedData = utf8Encode.encode(newStr)
        }
      }

      let fileCache: Map<string, FileCacheEntry> = (volume as any).fileCache
      if (convertedData) {
        if (!fileCache) {
          fileCache = new Map<string, FileCacheEntry>();
          (volume as any).fileCache = fileCache
        }
        fileCache.set(uri.path, { fileData, convertedData })
        return convertedData
      } else {
        fileCache?.delete(uri.path)
        return fileData
      }
    } catch (e: any) {
      volume?.revertChanges()
      throw e
    }
  }

  public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {

    // TODO: could NoPermissions handle disk full?

    let volume: Volume | undefined
    try {
      volume = this.getVolume(uri)
      const parentDir = this.mustFindParentDir(volume, uri)
      let file = this.mayFindFileOrDir(volume, parentDir, uri)
      if (file) {
        if (file.type == FileType.DIR) {
          throw vscode.FileSystemError.FileIsADirectory(uri)
        }
        if (options.overwrite) {

          // for now, only allow writing .PIC files
          if (!uri.path.toUpperCase().endsWith(".PIC")) {
            throw Error("Write of read-only file attempted")
          }

          volume.setFileContents(file, content)
          volume.commitChanges()
          uri = this.renameUri(uri, file)
          // TODO: fire a deleted/created instead?
        } else {
          throw vscode.FileSystemError.FileExists(uri)
        }
      } else if (options.create) {

        // NOTE: Undo on a file delete will call here to recreate the file,
        //  so allow writing of fileData if the contents matches known
        //  converted data cached on file read.

        const fileCache: Map<string, FileCacheEntry> = (volume as any).fileCache
        const cacheEntry = fileCache?.get(uri.path)
        if (cacheEntry) {
          // compare contents against cached convertedData
          let match = false
          if (cacheEntry.convertedData.length == content.length) {
            match = true
            for (let i = 0; i < content.length; i += 1) {
              if (cacheEntry.convertedData[i] != content[i]) {
                match = false
                break
              }
            }
          }
          if (!match) {
            throw Error("Writing data of unknown source")
          }
          content = cacheEntry.fileData
        }

        const fileInfo = this.getCleanFileName(volume, uri)

        // an empty file is assumed to be a HIRES .PIC
        if (content.length == 0) {
          content = new Uint8Array(0x1ff8)
          fileInfo.type = FileType.BIN
          fileInfo.auxType = 0x2000
        }

        file = volume.createFile(parentDir, fileInfo.name, fileInfo.type, fileInfo.auxType)
        volume.setFileContents(file, content)
        volume.commitChanges()

        uri = this.renameUri(uri, file)
        this.fireSoon({ type: vscode.FileChangeType.Created, uri })
      } else {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      // *** dir changed? ***
      this.fireSoon({ type: vscode.FileChangeType.Changed, uri })
    } catch (e: any) {
      volume?.revertChanges()
      throw e
    }
  }

  public delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
    let volume: Volume | undefined
    try {
      volume = this.getVolume(uri)
      const parentDir = this.mustFindParentDir(volume, uri)
      const file = this.mustFindFileOrDir(volume, parentDir, uri)

      // REVIEW: When recursively deleting directory contents,
      //  do change events need to be fired for every file deleted
      //  or will VSCode handle that?
      volume.deleteFile(parentDir, file, options.recursive)
      volume.commitChanges()

      // TODO: force rescan of directory so delete files are removed

      const dirName = uri.with({ path: path.posix.dirname(uri.path) })
      this.fireSoon(
        { type: vscode.FileChangeType.Changed, uri: dirName },
        { type: vscode.FileChangeType.Deleted, uri: uri }
      )
    } catch (e: any) {
      volume?.revertChanges()
      throw e
    }
  }

  public rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
    let oldVolume: Volume | undefined
    let newVolume: Volume | undefined
    try {
      oldVolume = this.getVolume(oldUri)
      newVolume = this.getVolume(newUri)

      // TODO: check new name for auxType information
      // TODO: look at options.overwrite

      const oldDirName = this.getDirName(oldUri)
      const oldParentDir = this.mustFindParentDir(oldVolume, oldUri)
      const oldFile = this.mustFindFileOrDir(oldVolume, oldParentDir, oldUri)

      const newDirName = this.getDirName(newUri)
      const newInfo = this.getCleanFileName(newVolume, newUri)
      let newName = newInfo.name

      // move/rename file within volume
      if (newVolume == oldVolume) {

        // is path the same for both old and new?
        if (oldDirName == newDirName) {
          // simple rename
          oldVolume.renameFile(oldParentDir, oldFile, newName)
        } else {
          if (oldVolume instanceof Dos33Volume) {
            throw new Error("Not allowed on a Dos 3.3 volume")
          }
          if (oldFile.name != newName) {
            throw new Error("Expected old and new name to match")
          }
          const newParentDir = this.mustFindParentDir(newVolume, newUri)
          oldVolume.moveFile(oldFile, newParentDir)
        }
      } else {
        // move a file/directory from one volume to another
        if (oldFile.type == FileType.DIR) {

          if (newVolume instanceof Dos33Volume) {
            throw new Error("Not allowed on a Dos 3.3 volume")
          }
          const newFile = <ProdosFileEntry>this.mustFindParentDir(newVolume, newUri)
          newVolume.copyDir(newFile, <ProdosVolume>oldVolume, <ProdosFileEntry>oldFile)
        } else {

          const oldContents = oldFile.getContents()
          const newParentDir = this.mustFindParentDir(newVolume, newUri)
          const newFile = newVolume.createFile(newParentDir, newName, oldFile.type, oldFile.auxType)
          newFile.setContents(oldContents)
          newUri = this.renameUri(newUri, newFile)
        }

        oldVolume.deleteFile(oldParentDir, oldFile, true)
      }

      // TODO: check for existing file/directory at target

      newVolume.commitChanges()
      oldVolume.commitChanges()
      this.fireSoon(
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri }
      )
    } catch (e: any) {
      newVolume?.revertChanges()
      oldVolume?.revertChanges()
      throw e
    }
  }

  // NOTE: The destination uri always has " copy" appended to the name
  //  even if there's no existing file at the destination.
  public copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean }): void | Thenable<void> {
    let srcVolume: Volume | undefined
    let dstVolume: Volume | undefined
    try {
      srcVolume = this.getVolume(source)
      dstVolume = this.getVolume(destination)

      const srcParentDir = this.mustFindParentDir(srcVolume, source)
      const srcFile = this.mustFindFileOrDir(srcVolume, srcParentDir, source)
      if (srcFile.type == FileType.DIR) {
        if (dstVolume instanceof Dos33Volume) {
          throw new Error("Not allowed on a Dos 3.3 volume")
        }
        let dstFile = <ProdosFileEntry>this.mustFindParentDir(dstVolume, destination)
        dstVolume.copyDir(dstFile, <ProdosVolume>srcVolume, <ProdosFileEntry>srcFile)
      } else {
        const srcContents = srcFile.getContents()
        const dstParentDir = this.mustFindParentDir(dstVolume, destination)

        const dstInfo = this.getCleanFileName(dstVolume, destination)
        let dstFile = this.mayFindFileOrDir(dstVolume, dstParentDir, destination)
        if (dstFile) {
          if (!options.overwrite) {
            throw vscode.FileSystemError.FileExists(destination)
          }
        } else {
          let fileType = srcFile.type
          let auxType = srcFile.auxType
          if (srcVolume instanceof Dos33Volume) {
            if (dstVolume instanceof ProdosVolume) {
              if (srcFile.type == FileType.BAS) {
                auxType = 0x0801
              }
            }
          } else if (dstVolume instanceof Dos33Volume) {
            // TODO: convert from ProDOS -> DOS 3.3 type?
          }
          dstFile = dstVolume.createFile(dstParentDir, dstInfo.name, fileType, auxType)
        }
        dstFile.setContents(srcContents)
        destination = this.renameUri(destination, dstFile)
      }

      dstVolume.commitChanges()
      this.fireSoon(
        { type: vscode.FileChangeType.Created, uri: destination }
      )
    } catch (e: any) {
      srcVolume?.revertChanges()
      dstVolume?.revertChanges()
      throw e
    }
  }

  private getVolume(uri: vscode.Uri): ProdosVolume | Dos33Volume {
    const volumeUri = vscode.Uri.parse(uri.query)
    const volume = this.volumes.get(volumeUri.path)
    if (!volume) {
      throw vscode.FileSystemError.FileNotFound(volumeUri)
    }
    volume.revertChanges()
    return volume
  }

  private getDirName(uri: vscode.Uri): string {
    let dirPath = uri.path.slice(1)  // trim leading '/'
    let dirName = path.posix.dirname(dirPath)
    if (dirName == ".") {
      dirName = ""
    }
    return dirName
  }

  // find full directory path, not just parent dirname
  private mustFindDir(volume: Volume, uri: vscode.Uri): FileEntry {
    let dirPath = uri.path.slice(1)  // trim leading '/'
    if (dirPath == ".") {
      dirPath = ""
    }
    const file = volume.findFileEntry(dirPath)
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    if (file.type != FileType.DIR) {
      throw vscode.FileSystemError.FileNotADirectory(uri)
    }
    return file
  }

  private mustFindFile(volume: Volume, uri: vscode.Uri): FileEntry {
    const parentDir = this.mustFindParentDir(volume, uri)
    const file = this.mustFindFileOrDir(volume, parentDir, uri)
    if (file.type == FileType.DIR) {
      throw vscode.FileSystemError.FileIsADirectory(uri)
    }
    return file
  }

  private mustFindParentDir(volume: Volume, uri: vscode.Uri): FileEntry {
    const dirName = this.getDirName(uri)
    const file = volume.findFileEntry(dirName)
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    if (file.type != FileType.DIR) {
      throw vscode.FileSystemError.FileNotADirectory(uri)
    }
    return file
  }

  private mustFindFileOrDir(volume: Volume, parent: FileEntry, uri: vscode.Uri): FileEntry {
    const file = this.mayFindFileOrDir(volume, parent, uri)
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return file
  }

  private mayFindFileOrDir(volume: Volume, parent: FileEntry, uri: vscode.Uri): FileEntry | undefined {

    const fileInfo = this.getCleanFileName(volume, uri)

    let file: FileEntry | undefined
    volume.forEachAllocatedFile(parent, (fileEntry: FileEntry) => {
      if (fileEntry.name != fileInfo.name) {
        return true
      }
      file = fileEntry
      return false
    })

    return file
  }

  private renameUri(uri: vscode.Uri, file: FileEntry): vscode.Uri {
    const parts = path.parse(uri.path)
    const fileName = this.getFullFileName(file)
    const newPath = path.format({ ...parts, base: fileName })
    return uri.with({ path: newPath })
  }

  private getFullFileName(fileEntry: FileEntry): string {

    let name = fileEntry.name
    let type = fileEntry.type
    if (type == FileType.DIR) {
      // no change
    } else if (type == FileType.BAS) {
      if (!fileEntry.name.endsWith(".BAS")) {
        name += "_.BAS"
      }
    } else if (type == FileType.INT) {
      if (!fileEntry.name.endsWith(".INT")) {
        name += "_.INT"
      }
    } else if (type == FileType.TXT) {
      if (!fileEntry.name.endsWith(".TXT")) {
        if (!fileEntry.name.endsWith(".S")) {
          name += "_.TXT"
        }
      }
    } else if (type == FileType.Y) {

      const config = vscode.workspace.getConfiguration("rpwa2.filesystem.convert")
      const convertLisa2 = config.get<boolean>("lisa2", true)
      // getContents so auxType gets filled in
      const contents = fileEntry.getContents()
      // add .L suffix to LISA source files
      if (convertLisa2 && fileEntry.auxType == 0x1800) {
        name += "_.L"
      } else {
        name += "_.Y"
      }
    } else if (type == FileType.BIN) {
      let suffix = ".BIN"
      const binLength = fileEntry.getContents()?.length ?? 0x0000
      if (binLength >= 0x1FF8 && binLength <= 0x2000) {
        if (fileEntry.auxType == 0x2000 || fileEntry.auxType == 0x4000) {
          suffix = ".PIC"
        }
      } else if (binLength == 0x0400) {
        if (fileEntry.auxType == 0x0400) {
          suffix = ".PIC"
        }
      } else if (binLength == 0x0800) {
        if (fileEntry.auxType == 0x0400) {
          suffix = ".PIC"
        }
      } else if (binLength == 0x4000) {
        if (fileEntry.auxType == 0x2000) {
          suffix = ".PIC"
        }
      }
      name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0")
      name += suffix
    } else if (type == FileType.SYS) {
      name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0")
      name += ".SYS"
    } else {
      if (FileType[type]) {
        name += "_." + FileType[type]
      } else {
        name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0") +
                ".$" + type.toString(16).toUpperCase().padStart(2, "0")
      }
    }
    return name
  }

  private getCleanFileName(volume: Volume, uri: vscode.Uri): FileInfo {
    let base = path.posix.basename(uri.path)
    let suffix = ""
    let typeStr: string | undefined
    let auxStr: string | undefined
    let hasCopySuffix = false

    // NOTE: strip out " copy" that VSCode incorrectly inserts
    let n = base.lastIndexOf(" copy.")
    if (n >= 0) {
      base = base.substring(0, n) + base.substring(n + 5)
      hasCopySuffix = true
    }

    // strip extra extensions
    n = base.lastIndexOf("_$")
    if (n >= 0) {
      typeStr = base.substring(n + 2).toUpperCase()
      const x = typeStr.lastIndexOf(".")
      if (x >= 0) {
        auxStr = typeStr.substring(0, x)
        typeStr = typeStr.substring(x + 1)
      } else {
        typeStr = undefined
      }
      base = base.substring(0, n)
    } else {
      n = base.lastIndexOf("_.")
      if (n >= 0) {
        typeStr = base.substring(n + 2).toUpperCase()
        base = base.substring(0, n)
      }
    }

    n = base.lastIndexOf(".")
    if (n >= 0) {
      suffix = base.substring(n)    // including "."
      base = base.substring(0, n)
    }

    // put the copy suffix back in at correct location
    if (hasCopySuffix) {
      // TODO: something shorter?
      base += " COPY"
    }

    let lengthLimit
    if (volume instanceof Dos33Volume) {
      base = base.toUpperCase()
      suffix = suffix.toUpperCase()
      lengthLimit = 30
    } else {
      lengthLimit = 15
    }

    // truncate and append "~"
    if (base.length > lengthLimit - suffix.length) {
      base = base.substring(0, lengthLimit - suffix.length - 1) + "~"
    }

    const typeMap = new Map<string, FileType>([
      [ "TXT", FileType.TXT ],
      [ "BIN", FileType.BIN ],
      [ "DIR", FileType.DIR ],
      [ "AWP", FileType.AWP ],
      [ "INT", FileType.INT ],
      [ "BAS", FileType.BAS ],
      [ "REL", FileType.REL ],
      [ "SYS", FileType.SYS ],
      [ "S",   FileType.S   ],
      [ "X",   FileType.X   ],
      [ "Y",   FileType.Y   ]
    ])

    let auxType = 0x0000
    if (auxStr) {
      auxType = parseInt(auxStr, 16)
    }

    let fileType : FileType | undefined
    if (typeStr) {
      if (typeStr.startsWith("$")) {
        fileType = parseInt(typeStr.substring(1), 16)
      } else {
        fileType = typeMap.get(typeStr)
        if (!fileType) {
          // check for artificial suffixes
          if (typeStr == "PIC") {
            fileType = FileType.BIN
            if (auxType == 0x0000) {
              auxType = 0x2000
            }
          } else if (typeStr == "L") {
            fileType = FileType.Y
            auxType = 0x1800
          } else {
            fileType = FileType.BIN
          }
        }
      }
    // check actual (not artificial) suffixes
    } else if (suffix.toUpperCase() == ".S") {
      fileType = FileType.TXT
    } else if (suffix.toUpperCase() == ".PIC") {
      fileType = FileType.BIN
      auxType = 0x2000
    } else {
      fileType = FileType.BIN
    }

    return { name: base + suffix, type: fileType, auxType }
  }
}
