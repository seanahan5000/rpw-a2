import * as vscode from 'vscode'

//------------------------------------------------------------------------------

function getNonce() {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

//------------------------------------------------------------------------------

function disposeAll(disposables: vscode.Disposable[]): void {
  while (disposables.length) {
    const item = disposables.pop()
    item?.dispose()
  }
}

abstract class Disposable {
  private disposed = false
  protected disposables: vscode.Disposable[] = []

  public dispose(): any {
    if (!this.disposed) {
      this.disposed = true
      disposeAll(this.disposables)
    }
  }

  protected register<T extends vscode.Disposable>(value: T): T {
    if (this.disposed) {
      value.dispose()
    } else {
      this.disposables.push(value)
    }
    return value
  }
}

//------------------------------------------------------------------------------

class WebviewCollection {

  private readonly webviews = new Set<{
    readonly resource: string
    readonly webviewPanel: vscode.WebviewPanel
  }>()

  public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
    const key = uri.toString()
    for (const entry of this.webviews) {
      if (entry.resource === key) {
        yield entry.webviewPanel
      }
    }
  }

  public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
    const entry = { resource: uri.toString(), webviewPanel }
    this.webviews.add(entry)
    webviewPanel.onDidDispose(() => {
      this.webviews.delete(entry)
    })
  }
}

//------------------------------------------------------------------------------

interface HiresDocumentDelegate {
  getFileData(): Promise<Uint8Array>;
}

class HiresDocument extends Disposable implements vscode.CustomDocument {

  static async create(
    uri: vscode.Uri,
    backupId: string | undefined,
    delegate: HiresDocumentDelegate,
  ): Promise<HiresDocument | PromiseLike<HiresDocument>> {
    // If we have a backup, read that. Otherwise read the resource from the workspace
    const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
    const fileData = await HiresDocument.readFile(dataFile);
    return new HiresDocument(uri, fileData, delegate);
  }

  private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.scheme === 'untitled') {
      return new Uint8Array(0x1ff8)
    }
    return new Uint8Array(await vscode.workspace.fs.readFile(uri));
  }

  private readonly _uri: vscode.Uri;

  private _documentData: Uint8Array;
  private saveIndex = 0
  private editIndex = 0

  private readonly _delegate: HiresDocumentDelegate;

  private constructor(
    uri: vscode.Uri,
    initialContent: Uint8Array,
    delegate: HiresDocumentDelegate
  ) {
    super();
    this._uri = uri;
    this._documentData = initialContent;
    this._delegate = delegate;
  }

  public get uri() { return this._uri; }

  public get documentData(): Uint8Array { return this._documentData; }

  private readonly _onDidDispose = this.register(new vscode.EventEmitter<void>());

  // Fired when the document is disposed of.
  public readonly onDidDispose = this._onDidDispose.event;

  private readonly _onDidChangeDocument = this.register(new vscode.EventEmitter<{
    readonly content?: Uint8Array;
    readonly editType?: string
    readonly editIndex?: number
  }>());

  // Fired to notify webviews that the document has changed.
  public readonly onDidChangeContent = this._onDidChangeDocument.event;

  private readonly _onDidChange = this.register(new vscode.EventEmitter<{
    readonly label: string,
    undo(): void,
    redo(): void,
  }>())

  // Fired to tell VS Code that an edit has occurred in the document.
  //
  // This updates the document's dirty indicator.
  //
  public readonly onDidChange = this._onDidChange.event;

  // Called by VS Code when there are no more references to the document.
  //
  // This happens when all editors for it have been closed.
  //
  dispose(): void {
    this._onDidDispose.fire();
    super.dispose();
  }

  // Called when the user edits the document in a webview.
  //
  // This fires an event to notify VS Code that the document has been edited.
  //
  makeEdit(editIndex: number) {
    this.editIndex = editIndex
    this._onDidChange.fire({
      label: "edit",
      undo: async () => {
        this.editIndex = editIndex - 1
        this._onDidChangeDocument.fire({
          editType: "undo",
          editIndex: editIndex
        });
      },
      redo: async () => {
        this.editIndex = editIndex
        this._onDidChangeDocument.fire({
          editType: "redo",
          editIndex: editIndex
        });
      }
    });
  }

  async save(cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveAs(this.uri, cancellation)
    this.saveIndex = this.editIndex
  }

  async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
    const fileData = await this._delegate.getFileData()
    if (cancellation.isCancellationRequested) {
      return
    }
    await vscode.workspace.fs.writeFile(targetResource, fileData)
  }

  async revert(_cancellation: vscode.CancellationToken): Promise<void> {
    const diskContent = await HiresDocument.readFile(this.uri)
    this._documentData = diskContent
    this._onDidChangeDocument.fire({
      content: diskContent,
      editType: "revert",
      editIndex: this.saveIndex
    })
  }

  // Called by VS Code to backup the edited document.
  //
  // These backups are used to implement hot exit.
  //
  async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
    await this.saveAs(destination, cancellation);

    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // nop
        }
      }
    };
  }
}

//------------------------------------------------------------------------------

class ViewerDocument extends Disposable implements vscode.CustomDocument {

  private readonly _uri: vscode.Uri
  public documentData: Uint8Array

  static async create(
    uri: vscode.Uri,
    backupId: string | undefined
  ): Promise<ViewerDocument | PromiseLike<ViewerDocument>> {
    const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri
    const fileData = await ViewerDocument.readFile(dataFile)
    return new ViewerDocument(uri, fileData)
  }

  private constructor(
    uri: vscode.Uri,
    initialContent: Uint8Array
  ) {
    super()
    this._uri = uri
    this.documentData = initialContent
  }

  public get uri() {
    return this._uri
  }

  private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return new Uint8Array(await vscode.workspace.fs.readFile(uri))
  }
}

export class ViewerProvider implements vscode.CustomReadonlyEditorProvider<ViewerDocument> {

  public static register(context: vscode.ExtensionContext, type: string): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      "rpwa2." + type,
      new ViewerProvider(context, type),
      {
        webviewOptions: {
          retainContextWhenHidden: false
        },
        supportsMultipleEditorsPerDocument: false
      })
  }

  private readonly context: vscode.ExtensionContext
  private readonly type: string
  private readonly webviews = new WebviewCollection()

  constructor(context: vscode.ExtensionContext, type: string) {
    this.context = context
    this.type = type
  }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: { backupId?: string },
    _token: vscode.CancellationToken
  ): Promise<ViewerDocument> {
    return await ViewerDocument.create(uri, openContext.backupId)
  }

  async resolveCustomEditor(
    document: ViewerDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    this.webviews.add(document.uri, webviewPanel)
    webviewPanel.webview.options = { enableScripts: true }
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview)
    // webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e))

    let auxType = 0x0000
    let n = document.uri.path.lastIndexOf("_$")
    if (n >= 0) {
      const extra = document.uri.path.substring(n + 2)
      n = extra.lastIndexOf(".")
      if (n >= 0) {
        const hex = extra.substring(0, n)
        auxType = parseInt(hex, 16)
      }
    }

    // Wait for the webview to be properly ready before we init
    webviewPanel.webview.onDidReceiveMessage(e => {
      if (e.type === 'ready') {
        this.postMessage(webviewPanel, 'init', {
          type: this.type,
          auxType: auxType,
          value: document.documentData,
          editable: false
        })
      }
    })
  }

  private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
    panel.webview.postMessage({ type, body })
  }

  // private onMessage(document: ViewerDocument, message: any) {
  // }

  private getHtmlForWebview(webview: vscode.Webview): string {

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this.context.extensionUri, 'out', 'webview.js'));

    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this.context.extensionUri, 'src', 'data_viewer.css'));

    const nonce = getNonce()

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body>
        <link href="${styleMainUri}" rel="stylesheet" />
        <div id="top-div"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`
  }
}

//------------------------------------------------------------------------------

export class HiresEditorProvider implements vscode.CustomEditorProvider<HiresDocument> {

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    // TODO: could do registerCommand here to add editor-specific commands
    return vscode.window.registerCustomEditorProvider(
      HiresEditorProvider.viewType,
      new HiresEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      })
  }

  private static readonly viewType = 'rpwa2.PIC';
  private readonly webviews = new WebviewCollection()

  constructor(
    private readonly _context: vscode.ExtensionContext
  ) { }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: { backupId?: string },
    _token: vscode.CancellationToken
  ): Promise<HiresDocument> {
    const document: HiresDocument = await HiresDocument.create(uri, openContext.backupId, {
      getFileData: async () => {
        const webviewsForDocument = Array.from(this.webviews.get(document.uri));
        if (!webviewsForDocument.length) {
          throw new Error('Could not find webview to save for');
        }
        const panel = webviewsForDocument[0];
        const response = await this.postMessageWithResponse<number[]>(panel, 'getFileData', {});
        return new Uint8Array(response);
      }
    });

    const listeners: vscode.Disposable[] = [];

    listeners.push(document.onDidChange(e => {
      // Tell VS Code that the document has been edited by the user
      this._onDidChangeCustomDocument.fire({
        document,
        ...e,
      });
    }));

    listeners.push(document.onDidChangeContent(e => {
      // Update all webviews when the document changes
      for (const webviewPanel of this.webviews.get(document.uri)) {
        this.postMessage(webviewPanel, 'update', {
          // edits: e.edits,
          editType: e.editType,
          editIndex: e.editIndex,
          content: e.content
        });
      }
    }));

    document.onDidDispose(() => disposeAll(listeners))
    return document
  }

  async resolveCustomEditor(
    document: HiresDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.webviews.add(document.uri, webviewPanel)
    webviewPanel.webview.options = {
      enableScripts: true
    }
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview)
    webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e))
    webviewPanel.webview.onDidReceiveMessage(e => {
      if (e.type === 'ready') {
        if (document.uri.scheme === 'untitled') {
          this.postMessage(webviewPanel, 'init', {
            type: "PIC",
            untitled: true,
            editable: true,
          })
        } else {
          const editable = vscode.workspace.fs.isWritableFileSystem(document.uri.scheme)
          this.postMessage(webviewPanel, 'init', {
            type: "PIC",
            value: document.documentData,
            editable
          })
        }
      }
    })
  }

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<HiresDocument>>();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  public saveCustomDocument(document: HiresDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    return document.save(cancellation);
  }

  public saveCustomDocumentAs(document: HiresDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
    return document.saveAs(destination, cancellation);
  }

  public revertCustomDocument(document: HiresDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    return document.revert(cancellation);
  }

  public backupCustomDocument(document: HiresDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    // Local path to script and css for the webview
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this._context.extensionUri, 'out', 'webview.js'));

    // const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
    //   this._context.extensionUri, 'media', 'vscode.css'));

    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this._context.extensionUri, 'src', 'display_view.css'));

    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce();

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">

        <!--
        Use a content security policy to only allow loading images from https or from our extension directory,
        and only allow scripts that have a specific nonce.
        -->
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body>

        <link href="${styleMainUri}" rel="stylesheet" />
        <div id="top-div"></div>

        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`
  }

  private _requestId = 1
  private readonly _callbacks = new Map<number, (response: any) => void>()

  private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
    const requestId = this._requestId++
    const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve))
    panel.webview.postMessage({ type, requestId, body })
    return p
  }

  private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
    panel.webview.postMessage({ type, body })
  }

  private onMessage(document: HiresDocument, message: any) {
    switch (message.type) {
      case "edit": {
        if (message.body?.index != undefined) {
          document.makeEdit(message.body.index)
        }
        break
      }
      case "response": {
        // TODO: does webview ever expect a response?
        const callback = this._callbacks.get(message.requestId)
        callback?.(message.body)
        break
      }
    }
  }
}

//------------------------------------------------------------------------------
