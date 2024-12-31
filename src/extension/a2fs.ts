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

type VolumeEntry = {
  uri: vscode.Uri
  volume: Volume
}

type VolumeAndSubPath = {
  volume: Volume
  subPath: string   // path within volume
  uri: vscode.Uri   // full URI for error reporting
}

export class Apple2FileSystem implements vscode.FileSystemProvider {

  private volumeEntries: VolumeEntry[] = []

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
    let volumeEntry: VolumeEntry | undefined
    try {

      volumeEntry = this.findVolume(uri)
      if (!volumeEntry) {
        const ext = path.extname(uri.path).toLowerCase()
        if (ext == ".dsk" || ext == ".do" || ext == ".po" || ext == "2mg" || ext == "hdv") {
          // TODO: get readOnly state from actual image file?
          const isReadOnly = false
          const volume = createVolume(uri, isReadOnly)
          volumeEntry = { uri, volume }
          this.volumeEntries.push(volumeEntry)
        } else {
          throw vscode.FileSystemError.FileNotFound(uri)
        }
      }

      const subPath = uri.path.substring(volumeEntry.uri.path.length)
      if (!subPath) {
        const volumeUri = vscode.Uri.parse(uri.path)
        const { ctime, mtime, size } = await vscode.workspace.fs.stat(volumeUri)
        return { type: vscode.FileType.Directory, ctime, mtime, size }
      }

      const vasp = { volume: volumeEntry.volume, subPath, uri }
      const parentDir = this.mustFindParentDir(vasp)
      const file = this.mustFindFileOrDir(vasp, parentDir)

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
      volumeEntry?.volume.revertChanges()
      throw e
    }
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    let vasp: VolumeAndSubPath | undefined
    try {
      vasp = this.getVolumeAndSubPath(uri)
      const dir = this.mustFindDir(vasp)
      const entries: [string, vscode.FileType][] = []
      vasp.volume.forEachAllocatedFile(dir, (fileEntry: FileEntry) => {
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
      vasp?.volume.revertChanges()
      throw e
    }
  }

  public createDirectory(uri: vscode.Uri): void | Thenable<void> {
    let vasp: VolumeAndSubPath | undefined
    try {
      vasp = this.getVolumeAndSubPath(uri)
      if (vasp.volume instanceof Dos33Volume) {
        throw new Error("Not allowed on a Dos 3.3 volume")
      }

      const parentDir = this.mustFindParentDir(vasp)
      let file = this.mayFindFileOrDir(vasp, parentDir)
      if (file) {
        // TODO: should create on existing directory be ignored?
        vscode.FileSystemError.FileExists(uri)
      }

      const baseName = path.posix.basename(uri.path)
      vasp.volume.createFile(parentDir, baseName, FileType.DIR, 0x0000)
      vasp.volume.commitChanges()

      const dirName = uri.with({ path: path.posix.dirname(uri.path) })
      this.fireSoon(
        { type: vscode.FileChangeType.Changed, uri: dirName },
        { type: vscode.FileChangeType.Created, uri: uri }
      )
    } catch (e: any) {
      vasp?.volume.revertChanges()
      throw e
    }
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    let vasp: VolumeAndSubPath | undefined
    try {
      vasp = this.getVolumeAndSubPath(uri)
      const file = this.mustFindFile(vasp)
      const fileData = vasp.volume.getFileContents(file)
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

      let fileCache: Map<string, FileCacheEntry> = (vasp.volume as any).fileCache
      if (convertedData) {
        if (!fileCache) {
          fileCache = new Map<string, FileCacheEntry>();
          (vasp.volume as any).fileCache = fileCache
        }
        fileCache.set(uri.path, { fileData, convertedData })
        return convertedData
      } else {
        fileCache?.delete(uri.path)
        return fileData
      }
    } catch (e: any) {
      vasp?.volume.revertChanges()
      throw e
    }
  }

  public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {

    // TODO: could NoPermissions handle disk full?

    let vasp: VolumeAndSubPath | undefined
    try {
      vasp = this.getVolumeAndSubPath(uri)
      const parentDir = this.mustFindParentDir(vasp)
      let file = this.mayFindFileOrDir(vasp, parentDir)
      if (file) {
        if (file.type == FileType.DIR) {
          throw vscode.FileSystemError.FileIsADirectory(uri)
        }
        if (options.overwrite) {

          // for now, only allow writing .PIC files
          if (!uri.path.toUpperCase().endsWith(".PIC")) {
            throw Error("Write of read-only file attempted")
          }

          vasp.volume.setFileContents(file, content)
          vasp.volume.commitChanges()
          uri = this.renameUri(uri, file)
          // TODO: fire a deleted/created instead?
        } else {
          throw vscode.FileSystemError.FileExists(uri)
        }
      } else if (options.create) {

        // NOTE: Undo on a file delete will call here to recreate the file,
        //  so allow writing of fileData if the contents matches known
        //  converted data cached on file read.

        const fileCache: Map<string, FileCacheEntry> = (vasp.volume as any).fileCache
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

        const fileInfo = this.getCleanFileName(vasp)

        // an empty file is assumed to be a HIRES .PIC
        if (content.length == 0) {
          content = new Uint8Array(0x1ff8)
          fileInfo.type = FileType.BIN
          fileInfo.auxType = 0x2000
        }

        file = vasp.volume.createFile(parentDir, fileInfo.name, fileInfo.type, fileInfo.auxType)
        vasp.volume.setFileContents(file, content)
        vasp.volume.commitChanges()

        uri = this.renameUri(uri, file)
        this.fireSoon({ type: vscode.FileChangeType.Created, uri })
      } else {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      // *** dir changed? ***
      this.fireSoon({ type: vscode.FileChangeType.Changed, uri })
    } catch (e: any) {
      vasp?.volume.revertChanges()
      throw e
    }
  }

  public delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
    let vasp: VolumeAndSubPath | undefined
    try {
      vasp = this.getVolumeAndSubPath(uri)
      const parentDir = this.mustFindParentDir(vasp)
      const file = this.mustFindFileOrDir(vasp, parentDir)

      // REVIEW: When recursively deleting directory contents,
      //  do change events need to be fired for every file deleted
      //  or will VSCode handle that?
      vasp.volume.deleteFile(parentDir, file, options.recursive)
      vasp.volume.commitChanges()

      // TODO: force rescan of directory so delete files are removed

      const dirName = uri.with({ path: path.posix.dirname(uri.path) })
      this.fireSoon(
        { type: vscode.FileChangeType.Changed, uri: dirName },
        { type: vscode.FileChangeType.Deleted, uri: uri }
      )
    } catch (e: any) {
      vasp?.volume.revertChanges()
      throw e
    }
  }

  public rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
    let oldVasp: VolumeAndSubPath | undefined
    let newVasp: VolumeAndSubPath | undefined
    try {
      oldVasp = this.getVolumeAndSubPath(oldUri)
      newVasp = this.getVolumeAndSubPath(newUri)

      // TODO: check new name for auxType information
      // TODO: look at options.overwrite

      const oldDirName = this.getDirName(oldVasp.subPath)
      const oldParentDir = this.mustFindParentDir(oldVasp)
      const oldFile = this.mustFindFileOrDir(oldVasp, oldParentDir)

      const newDirName = this.getDirName(newVasp.subPath)
      let newInfo = this.getCleanFileName(newVasp, newDirName)
      let newName = newInfo.name

      // move/rename file within volume
      if (newVasp.volume == oldVasp.volume) {
        // is path the same for both old and new?
        if (oldDirName == newDirName) {
          // simple file rename
          // NOTE: omit newDirName so file name doesn't get
          //  stripped of the directory name
          const newInfo2 = this.getCleanFileName(newVasp)
          oldVasp.volume.renameFile(oldParentDir, oldFile, newInfo2.name)
        } else {
          if (oldVasp.volume instanceof Dos33Volume) {
            throw new Error("Not allowed on a Dos 3.3 volume")
          }
          const newParentDir = this.mustFindParentDir(newVasp)
          const newFile = oldVasp.volume.moveFile(oldFile, newParentDir)
          if (oldFile.name != newName) {
            newVasp.volume.renameFile(newParentDir, newFile, newName)
          }
        }
      } else {
        // move a file/directory from one volume to another
        if (oldFile.type == FileType.DIR) {
          // move directory
          if (newVasp.volume instanceof Dos33Volume) {
            throw new Error("Not allowed on a Dos 3.3 volume")
          }
          const newFile = <ProdosFileEntry>this.mustFindParentDir(newVasp)
          newVasp.volume.copyDir(newFile, <ProdosVolume>oldVasp.volume, <ProdosFileEntry>oldFile)
        } else {
          // move file
          const oldContents = oldFile.getContents()
          const newParentDir = this.mustFindParentDir(newVasp)
          const newFile = newVasp.volume.createFile(newParentDir, newName, oldFile.type, oldFile.auxType)
          newFile.setContents(oldContents)
          newUri = this.renameUri(newUri, newFile)
        }

        oldVasp.volume.deleteFile(oldParentDir, oldFile, true)
      }

      // Always force a change on the new volume to refresh
      //  truncated names and magic suffixes.
      //
      // NOTE: A fake file name is used in order to force
      //  VSCode to do a full refresh.  If the actual name
      //  is given, it ignores the notification.
      const parts = path.parse(newUri.path)
      const newPath = path.format({ ...parts, base: "FAKE" })
      newUri = newUri.with({ path: newPath })

      // TODO: check for existing file/directory at target

      newVasp.volume.commitChanges()
      oldVasp.volume.commitChanges()
      this.fireSoon(
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri }
      )
    } catch (e: any) {
      newVasp?.volume.revertChanges()
      oldVasp?.volume.revertChanges()
      throw e
    }
  }

  // NOTE: The destination uri always has " copy" appended to the name
  //  even if there's no existing file at the destination.
  public copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean }): void | Thenable<void> {
    let srcVasp: VolumeAndSubPath | undefined
    let dstVasp: VolumeAndSubPath | undefined
    try {
      srcVasp = this.getVolumeAndSubPath(source)
      dstVasp = this.getVolumeAndSubPath(destination)

      const srcParentDir = this.mustFindParentDir(srcVasp)
      const srcFile = this.mustFindFileOrDir(srcVasp, srcParentDir)
      if (srcFile.type == FileType.DIR) {
        if (dstVasp.volume instanceof Dos33Volume) {
          throw new Error("Not allowed on a Dos 3.3 volume")
        }
        let dstFile = <ProdosFileEntry>this.mustFindParentDir(dstVasp)
        dstVasp.volume.copyDir(dstFile, <ProdosVolume>srcVasp.volume, <ProdosFileEntry>srcFile)
      } else {
        const srcContents = srcFile.getContents()
        const dstParentDir = this.mustFindParentDir(dstVasp)

        const dstInfo = this.getCleanFileName(dstVasp)
        let dstFile = this.mayFindFileOrDir(dstVasp, dstParentDir)
        if (dstFile) {
          if (!options.overwrite) {
            throw vscode.FileSystemError.FileExists(destination)
          }
        } else {
          let fileType = srcFile.type
          let auxType = srcFile.auxType
          if (srcVasp.volume instanceof Dos33Volume) {
            if (dstVasp.volume instanceof ProdosVolume) {
              if (srcFile.type == FileType.BAS) {
                auxType = 0x0801
              }
            }
          } else if (dstVasp.volume instanceof Dos33Volume) {
            // TODO: convert from ProDOS -> DOS 3.3 type?
          }
          dstFile = dstVasp.volume.createFile(dstParentDir, dstInfo.name, fileType, auxType)
        }
        dstFile.setContents(srcContents)
        destination = this.renameUri(destination, dstFile)
      }

      dstVasp.volume.commitChanges()
      this.fireSoon(
        { type: vscode.FileChangeType.Created, uri: destination }
      )
    } catch (e: any) {
      srcVasp?.volume.revertChanges()
      dstVasp?.volume.revertChanges()
      throw e
    }
  }

  private findVolume(uri: vscode.Uri): VolumeEntry | undefined {
    for (let volumeEntry of this.volumeEntries) {
      if (uri.path.startsWith(volumeEntry.uri.path)) {
        return volumeEntry
      }
    }
  }

  private getVolumeAndSubPath(uri: vscode.Uri): VolumeAndSubPath {
    const volumeEntry = this.findVolume(uri)
    if (!volumeEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    volumeEntry.volume.revertChanges()
    const subPath = uri.path.substring(volumeEntry.uri.path.length)
    return { volume: volumeEntry.volume, subPath, uri }
  }

  private getDirName(subPath: string): string {
    let dirPath = subPath.slice(1)  // trim leading '/'
    let dirName = path.posix.dirname(dirPath)
    if (dirName == ".") {
      dirName = ""
    }
    return dirName
  }

  // find full directory path, not just parent dirname
  private mustFindDir(vasp: VolumeAndSubPath): FileEntry {
    let dirPath = vasp.subPath.slice(1)  // trim leading '/'
    if (dirPath == ".") {
      dirPath = ""
    }
    const file = vasp.volume.findFileEntry(dirPath)
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(vasp.uri)
    }
    if (file.type != FileType.DIR) {
      throw vscode.FileSystemError.FileNotADirectory(vasp.uri)
    }
    return file
  }

  private mustFindFile(vasp: VolumeAndSubPath): FileEntry {
    const parentDir = this.mustFindParentDir(vasp)
    const file = this.mustFindFileOrDir(vasp, parentDir)
    if (file.type == FileType.DIR) {
      throw vscode.FileSystemError.FileIsADirectory(vasp.uri)
    }
    return file
  }

  private mustFindParentDir(vasp: VolumeAndSubPath): FileEntry {
    const dirName = this.getDirName(vasp.subPath)
    const file = vasp.volume.findFileEntry(dirName)
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(vasp.uri)
    }
    if (file.type != FileType.DIR) {
      throw vscode.FileSystemError.FileNotADirectory(vasp.uri)
    }
    return file
  }

  private mustFindFileOrDir(vasp: VolumeAndSubPath, parent: FileEntry): FileEntry {
    const file = this.mayFindFileOrDir(vasp, parent)
    if (!file) {
      throw vscode.FileSystemError.FileNotFound(vasp.uri)
    }
    return file
  }

  private mayFindFileOrDir(vasp: VolumeAndSubPath, parent: FileEntry): FileEntry | undefined {

    const fileInfo = this.getCleanFileName(vasp)

    let file: FileEntry | undefined
    vasp.volume.forEachAllocatedFile(parent, (fileEntry: FileEntry) => {
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

  private getCleanFileName(vasp: VolumeAndSubPath, parentDirName?: string): FileInfo {
    let base = path.posix.basename(vasp.subPath)
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

    let lengthLimit
    if (vasp.volume instanceof Dos33Volume) {
      base = base.toUpperCase()
      suffix = suffix.toUpperCase()
      lengthLimit = 30
    } else {
      lengthLimit = 15
    }

    // put the copy suffix back in at correct location
    if (hasCopySuffix) {
      // TODO: something shorter?
      base += " COPY"
    }

    // strip parent directory name from start of filename

    // TODO: there are problems with VSCode reporting bogus
    //  errors when the file name is changed like this.

    // if (parentDirName) {
    //   const lastSlash = parentDirName.lastIndexOf("/")
    //   if (lastSlash >= 0) {
    //     parentDirName = parentDirName.substring(lastSlash + 1)
    //   }
    //   if (base.startsWith(parentDirName)) {
    //     if (parentDirName.length + 2 < base.length) {
    //       base = base.substring(parentDirName.length)
    //       base = base.trimStart()
    //     }
    //   }
    //
    //   // on ProDos, strip .PIC suffix from actual file name
    //   // (only if parentDirName provided, meaning it's a rename)
    //   // if (base.endsWith(".PIC")) {
    //   //   if (typeStr == "PIC") {
    //   //     base = base.substring(0, base.length - 4)
    //   //   }
    //   // }
    // }

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

//------------------------------------------------------------------------------
