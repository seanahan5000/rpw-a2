import * as fs from 'fs'
import * as vscode from 'vscode'
import * as path from 'path'
import { DiskImage, FileEntry, ProdosVolume, ProdosFileType, ProdosFileEntry } from "../filesys/prodos"
import { Dos33Volume } from '../filesys/dos33'
import { TestProdosVolume } from "../filesys/test_prodos"

type Volume = Dos33Volume | ProdosVolume

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
    try {
      const volumeUri = vscode.Uri.parse(uri.query)
      let volume = this.volumes.get(volumeUri.path)
      if (!volume) {

        const n = volumeUri.path.lastIndexOf(".")
        if (n < 0) {
          throw vscode.FileSystemError.FileNotFound(uri)
        }
        const ext = volumeUri.path.slice(n + 1).toLowerCase()

        const diskData = fs.readFileSync(volumeUri.path)
        const isReadOnly = false    // *** get this from somewhere ***
        const diskImage = new DiskImage(diskData, isReadOnly)
        if (ext == "dsk" || ext == "do") {
          volume = new Dos33Volume(diskImage)
        } else if (ext == "po" || ext == "2mg") {
          // volume = new ProdosVolume(diskImage)

          volume = new TestProdosVolume(diskImage);  // ***
          (<TestProdosVolume>volume).verify()       // ***
        } else {
          throw vscode.FileSystemError.FileNotFound(uri)
        }
        this.volumes.set(volumeUri.path, volume)
      }

      volume.resetChanges()

      const dirName = this.getDirName(uri)
      if (dirName == "") {
        const { ctime, mtime, size } = await vscode.workspace.fs.stat(volumeUri)
        return { type: vscode.FileType.Directory, ctime, mtime, size }
      }

      const parentDir = this.mustFindParentDir(volume, uri)
      const file = this.mustFindFileOrDir(volume, parentDir, uri)

      // *** TODO: get time information from actual files ***
      const ctime = Date.now()
      const mtime = Date.now()
      let size = 0
      if (file.type == "DIR") {
        return { type: vscode.FileType.Directory, ctime, mtime, size }
      } else {
        const contents = file.getContents()
        return { type: vscode.FileType.File, ctime, mtime, size: contents.length }
      }
    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e
      }
      throw vscode.FileSystemError.NoPermissions("stat failed - " + e.message)
    }
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      const volume = this.getVolume(uri)
      const dir = this.mustFindDir(volume, uri)
      const entries: [string, vscode.FileType][] = []
      volume.forEachAllocatedFile(dir, (fileEntry: FileEntry) => {
        const fileName = this.getFullFileName(fileEntry)
        if (fileEntry.type == "DIR") {
          entries.push([fileName, vscode.FileType.Directory])
        } else {
          entries.push([fileName, vscode.FileType.File])
        }
        return true
      })
      // NOTE: no need to commitChanges on read-only operation
      return entries
    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e
      }
      throw vscode.FileSystemError.NoPermissions("readDirectory failed - " + e.message)
    }
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const volume = this.getVolume(uri)
      const file = this.mustFindFile(volume, uri)
      return volume.getFileContents(file)
    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e
      }
      throw vscode.FileSystemError.NoPermissions("readFile failed - " + e.message)
    }
  }

  public createDirectory(uri: vscode.Uri): void | Thenable<void> {
    try {
      const volume = this.getVolume(uri)
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
      volume.createFile(parentDir, baseName, ProdosFileType.DIR, 0x0000)
      volume.commitChanges()

      const dirName = uri.with({ path: path.posix.dirname(uri.path) })
      this.fireSoon(
        { type: vscode.FileChangeType.Changed, uri: dirName },
        { type: vscode.FileChangeType.Created, uri: uri }
      )
    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e
      }
      throw vscode.FileSystemError.NoPermissions("createDirectory failed - " + e.message)
    }
  }

  public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
    try {
      const volume = this.getVolume(uri)
      const parentDir = this.mustFindParentDir(volume, uri)
      let file = this.mayFindFileOrDir(volume, parentDir, uri)
      if (file) {
        if (file.type == "DIR") {
          throw vscode.FileSystemError.FileIsADirectory(uri)
        }
        if (options.overwrite) {
          // TODO: check for same file type?
          volume.setFileContents(file, content)
          volume.commitChanges()
        } else {
          throw vscode.FileSystemError.FileExists(uri)
        }
      } else if (options.create) {
        const baseName = path.posix.basename(uri.path)
        // TODO: what should default type and auxType be?
        file = volume.createFile(parentDir, baseName, ProdosFileType.BIN, 0x2000)
        volume.setFileContents(file, content)
        volume.commitChanges()
        this.fireSoon({ type: vscode.FileChangeType.Created, uri })
      } else {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      this.fireSoon({ type: vscode.FileChangeType.Changed, uri })
    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e
      }
      throw vscode.FileSystemError.NoPermissions("writeFile failed - " + e.message)
    }
  }

  public delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
    try {
      const volume = this.getVolume(uri)
      const parentDir = this.mustFindParentDir(volume, uri)
      const file = this.mustFindFileOrDir(volume, parentDir, uri)

      // REVIEW: When recursively deleting directory contents,
      //  do change events need to be fired for every file deleted
      //  or will VSCode handle that?
      volume.deleteFile(parentDir, file, options.recursive)
      volume.commitChanges()

      const dirName = uri.with({ path: path.posix.dirname(uri.path) })
      this.fireSoon(
        { type: vscode.FileChangeType.Changed, uri: dirName },
        { type: vscode.FileChangeType.Deleted, uri: uri }
      )
    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e
      }
      throw vscode.FileSystemError.NoPermissions("delete failed - " + e.message)
    }
  }

  public rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
    try {
      const oldVolume = this.getVolume(oldUri)
      const newVolume = this.getVolume(newUri)

      // TODO: check new name for auxType information
      // TODO: look at options.overwrite

      // move/rename file within volume
      if (newVolume == oldVolume) {

        const oldDirName = this.getDirName(oldUri)
        const oldParentDir = this.mustFindParentDir(oldVolume, oldUri)
        const oldFile = this.mustFindFileOrDir(oldVolume, oldParentDir, oldUri)

        const newDirName = this.getDirName(newUri)
        const newName = path.posix.basename(newUri.path)

        // is path the same for both old and new?
        if (oldDirName == newDirName) {
          // simple rename
          oldVolume.renameFile(oldParentDir, oldFile, newName)
        } else {
          if (oldVolume instanceof Dos33Volume) {
            throw new Error("Not allowed on a Dos 3.3 volume")
          }
          if (path.posix.basename(oldUri.path) != newName) {
            throw new Error("Expected old and new name to match")
          }
          const newParentDir = this.mustFindParentDir(newVolume, newUri)
          oldVolume.moveFile(oldFile, newParentDir)
        }
      } else {
        // TODO: move file/directory across a2fs volumes
        throw new Error("Not supported yet")
      }

      // TODO: check for existing file/directory at target

      newVolume.commitChanges()
      oldVolume.commitChanges()
      this.fireSoon(
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri }
      )
    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e
      }
      throw vscode.FileSystemError.NoPermissions("rename failed - " + e.message)
    }
  }

  public copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean }): void | Thenable<void> {
    try {
      // *** copy/paste appears to use this ***
      // *** source and destination could be directories? ***

      debugger  // ***

    } catch (e: any) {
      if (e instanceof vscode.FileSystemError) {
        throw e
      }
      throw vscode.FileSystemError.NoPermissions("rename failed - " + e.message)
    }
  }

  private getVolume(uri: vscode.Uri): ProdosVolume | Dos33Volume {
    const volumeUri = vscode.Uri.parse(uri.query)
    const volume = this.volumes.get(volumeUri.path)
    if (!volume) {
      throw vscode.FileSystemError.FileNotFound(volumeUri)
    }
    volume.resetChanges()
    return volume
  }

  private getFullFileName(fileEntry: FileEntry): string {
    let name = fileEntry.name
    let type = fileEntry.type
    if (type == "DIR") {
      // no change
    } else if (type == "A") {
      name += ".BAS"
    } else if (type == "I") {
      name += ".INT"
    } else if (type == "T") {
      if (!fileEntry.name.endsWith(".TXT")) {
        name += ".TXT"
      }
    } else if (type == "B" || type == "BIN") {
      let defaultBin = true
      const binLength = fileEntry.getContents()?.length ?? 0x0000
      if (binLength >= 0x1FF8 && binLength <= 0x2000) {
        if (fileEntry.auxType == 0x2000 || fileEntry.auxType == 0x4000) {
          if (!fileEntry.name.endsWith(".PIC")) {
            name += ".PIC"
          }
          defaultBin = false
        }
      }
      if (defaultBin) {
        name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0")
        name += ".BIN"
      }
    } else if (type == "SYS") {
      name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0")
      name += ".SYS"
    } else if (type != "DIR") {
      if (type.startsWith("$")) {
        name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0")
      }
      name += "." + type
    }
    return name
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
    if (file.type != "DIR") {
      throw vscode.FileSystemError.FileNotADirectory(uri)
    }
    return file
  }

  private mustFindFile(volume: Volume, uri: vscode.Uri): FileEntry {
    const parentDir = this.mustFindParentDir(volume, uri)
    const file = this.mustFindFileOrDir(volume, parentDir, uri)
    if (file.type == "DIR") {
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
    if (file.type != "DIR") {
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
    let fileName = path.posix.basename(uri.path)

    // strip "magic" extensions
    let n = fileName.lastIndexOf("_$")
    if (n >= 0) {
      fileName = fileName.substring(0, n)
    }

    // get name without type extension
    let coreName = fileName
    n = fileName.lastIndexOf(".")
    if (n >= 0) {
      coreName = fileName.substring(0, n)
    }

    let file: FileEntry | undefined
    volume.forEachAllocatedFile(parent, (fileEntry: FileEntry) => {
      if (fileEntry.type == "DIR") {
        if (fileEntry.name != fileName) {
          return true
        }
      } else {
        if (fileEntry.name != fileName && fileEntry.name != coreName) {
          return true
        }
      }
      file = fileEntry
      return false
    })

    return file
  }
}
