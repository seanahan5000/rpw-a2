import * as vscode from 'vscode'
import * as fs from 'fs'
import { DiskImage, ProdosVolume, FileEntry, ProdosFileEntry } from "./filesys/prodos"
import { Dos33Volume } from './filesys/dos33'
import { HiresEditorProvider } from "./editor"

class Apple2FileSystem implements vscode.FileSystemProvider {

  private volumes = new Map<string, Dos33Volume | ProdosVolume>()

  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event

  public watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
    return new class {
      dispose() {
        // debugger  // ***
        // *** remove from volumes ***
      }
    }
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {

    const volumeUri = vscode.Uri.parse(uri.query)
    let volume = this.volumes.get(volumeUri.path)
    if (!volume) {

      const n = volumeUri.path.lastIndexOf(".")
      if (n < 0) {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      const ext = volumeUri.path.slice(n + 1).toLowerCase()

      const diskData = fs.readFileSync(volumeUri.path)
      const diskImage = new DiskImage(diskData)
      if (ext == "dsk" || ext == "do") {
        volume = new Dos33Volume(diskImage)
      } else if (ext == "po" || ext == "2mg") {
        volume = new ProdosVolume(diskImage)
      } else {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      this.volumes.set(volumeUri.path, volume)
    }

    let path = uri.path.slice(1)  // trim leading '/'
    if (!path) {
      const { ctime, mtime, size } = await vscode.workspace.fs.stat(volumeUri)
      return { type: vscode.FileType.Directory, ctime, mtime, size }
    }

    const fileEntry = this.findFile(volume, uri)
    if (!fileEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    const ctime = Date.now()
    const mtime = Date.now()
    let size = 0
    if (fileEntry.type == "DIR") {
      return { type: vscode.FileType.Directory, ctime, mtime, size }
    } else {
      size = fileEntry.getContents().length
      return { type: vscode.FileType.File, ctime, mtime, size }
    }
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {

    const entries: [string, vscode.FileType][] = []
    const volume = this.getVolume(uri)

    let path = uri.path.slice(1)  // trim leading '/'
    let dirFileEntry: ProdosFileEntry | undefined
    while (path.length > 0) {

      let subDir: string | undefined
      const n = path.indexOf("/")
      if (n >= 0) {
        subDir = path.substring(0, n)
        path = path.substring(n + 1)
      } else {
        subDir = path
        path = ""
      }

      volume.forEachAllocatedFile((fileEntry: FileEntry) => {
        const fileName = this.getFullFileName(fileEntry)
        if (fileEntry.type == "DIR") {
          if (fileEntry.name == subDir) {
            if (fileEntry instanceof ProdosFileEntry) {
              dirFileEntry = fileEntry
              return false
            }
          }
        }
        return true
      }, dirFileEntry)
    }

    volume.forEachAllocatedFile((fileEntry: FileEntry) => {
      const fileName = this.getFullFileName(fileEntry)
      if (fileEntry.type == "DIR") {
        entries.push([fileName, vscode.FileType.Directory])
      } else {
        entries.push([fileName, vscode.FileType.File])
      }
      return true
    }, dirFileEntry)

    return entries
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {

    const volume = this.getVolume(uri)
    const fileEntry = this.findFile(volume, uri)
    if (!fileEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return volume.getFileContents(fileEntry)
  }

  public createDirectory(uri: vscode.Uri): void | Thenable<void> {
    const volume = this.getVolume(uri)
    if (volume instanceof Dos33Volume) {
      throw vscode.FileSystemError.NoPermissions(uri)
    }

    debugger  // ***
  }

  public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
    debugger  // ***
  }

  public delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
    debugger  // ***
  }

  public rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
    debugger  // ***
  }

  private getVolume(uri: vscode.Uri): ProdosVolume | Dos33Volume {
    const volumeUri = vscode.Uri.parse(uri.query)
    const volume = this.volumes.get(volumeUri.path)
    if (!volume) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return volume
  }

  private getFullFileName(fileEntry: FileEntry): string {

    // *** clean this up ***
    let name = fileEntry.name
    let type = fileEntry.type
    if (type == "DIR") {
      // no change
    } else if (type == "A") {
      name += ".BAS"
    } else if (type == "B") {
      name += ".BIN"
    } else if (type == "I") {
      name += ".INT"
    } else if (type == "T") {
      name += ".TXT"
    } else {
      name += "." + type
    }
    // *** more here
    // *** auxType?

    return name
  }

  private findFile(volume: Dos33Volume | ProdosVolume, uri: vscode.Uri): FileEntry | undefined {

    let path = uri.path.slice(1)  // trim leading '/'

    let dirFileEntry: ProdosFileEntry | undefined
    while (true) {

      let subDir: string | undefined
      const n = path.indexOf("/")
      if (n >= 0) {
        subDir = path.substring(0, n)
        path = path.substring(n + 1)
      } else {
        break
      }

      let matchDirEntry: ProdosFileEntry | undefined

      volume.forEachAllocatedFile((fileEntry: FileEntry) => {
        const fileName = this.getFullFileName(fileEntry)
        if (fileEntry.type == "DIR") {
          if (fileEntry.name == subDir) {
            if (fileEntry instanceof ProdosFileEntry) {
              matchDirEntry = fileEntry
              return false
            }
          }
        }
        return true
      }, dirFileEntry)

      if (!matchDirEntry) {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      dirFileEntry = matchDirEntry
    }

    // strip file extension
    const dirName = path
    let fileName = path
    const n = fileName.lastIndexOf(".")
    if (n >= 0) {
      fileName = fileName.substring(0, n)
    }

    let matchEntry: FileEntry | undefined
    volume.forEachAllocatedFile((fileEntry: FileEntry) => {
      if (fileEntry.type == "DIR") {
        if (fileEntry.name != dirName) {
          return true
        }
      } else {
        if (fileEntry.name != fileName) {
          return true
        }
      }
      matchEntry = fileEntry
      return false
    }, dirFileEntry)

    if (!matchEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    return matchEntry
  }
}

export function activate(context: vscode.ExtensionContext) {
  const a2fs = new Apple2FileSystem()

  // *** are all of these needed?
  // *** make writeable later ***
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('dsk', a2fs, { isReadonly: true, isCaseSensitive: true }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('do', a2fs, { isReadonly: true, isCaseSensitive: true }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('po', a2fs, { isReadonly: true, isCaseSensitive: true }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('2mg', a2fs, { isReadonly: true, isCaseSensitive: true }))

  context.subscriptions.push(HiresEditorProvider.register(context));

  // *** could this be made to work with multiple volumes at the same time? ***
  context.subscriptions.push(vscode.commands.registerCommand('extension.mountApple2FileSystem', (uri: vscode.Uri) => {

    const wsUri = vscode.Uri.parse(`dsk:/?${uri}`)
    // *** other file systems ***

    if (vscode.workspace.getWorkspaceFolder(wsUri) === undefined) {
      const name = vscode.workspace.asRelativePath(uri, true)
      const index = vscode.workspace.workspaceFolders?.length || 0
      const workspaceFolder: vscode.WorkspaceFolder = { uri: wsUri, name, index }
      vscode.workspace.updateWorkspaceFolders(index, 0, workspaceFolder)
    }
  }))
}
