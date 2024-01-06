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

interface HiresEdit {
  readonly color: string;
  readonly stroke: ReadonlyArray<[number, number]>;
}

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
      return new Uint8Array();
    }
    return new Uint8Array(await vscode.workspace.fs.readFile(uri));
  }

  private readonly _uri: vscode.Uri;

  private _documentData: Uint8Array;
  private _edits: Array<HiresEdit> = [];
  private _savedEdits: Array<HiresEdit> = [];

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
  /**
   * Fired when the document is disposed of.
   */
  public readonly onDidDispose = this._onDidDispose.event;

  private readonly _onDidChangeDocument = this.register(new vscode.EventEmitter<{
    readonly content?: Uint8Array;
    readonly edits: readonly HiresEdit[];
  }>());
  /**
   * Fired to notify webviews that the document has changed.
   */
  public readonly onDidChangeContent = this._onDidChangeDocument.event;

  private readonly _onDidChange = this.register(new vscode.EventEmitter<{
    readonly label: string,
    undo(): void,
    redo(): void,
  }>());
  /**
   * Fired to tell VS Code that an edit has occurred in the document.
   *
   * This updates the document's dirty indicator.
   */
  public readonly onDidChange = this._onDidChange.event;

  /**
   * Called by VS Code when there are no more references to the document.
   *
   * This happens when all editors for it have been closed.
   */
  dispose(): void {
    this._onDidDispose.fire();
    super.dispose();
  }

  /**
   * Called when the user edits the document in a webview.
   *
   * This fires an event to notify VS Code that the document has been edited.
   */
  makeEdit(edit: HiresEdit) {
    this._edits.push(edit);

    this._onDidChange.fire({
      label: 'Stroke',
      undo: async () => {
        this._edits.pop();
        this._onDidChangeDocument.fire({
          edits: this._edits,
        });
      },
      redo: async () => {
        this._edits.push(edit);
        this._onDidChangeDocument.fire({
          edits: this._edits,
        });
      }
    });
  }

  /**
   * Called by VS Code when the user saves the document.
   */
  async save(cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveAs(this.uri, cancellation);
    this._savedEdits = Array.from(this._edits);
  }

  /**
   * Called by VS Code when the user saves the document to a new location.
   */
  async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
    const fileData = await this._delegate.getFileData();
    if (cancellation.isCancellationRequested) {
      return;
    }
    await vscode.workspace.fs.writeFile(targetResource, fileData);
  }

  /**
   * Called by VS Code when the user calls `revert` on a document.
   */
  async revert(_cancellation: vscode.CancellationToken): Promise<void> {
    const diskContent = await HiresDocument.readFile(this.uri);
    this._documentData = diskContent;
    this._edits = this._savedEdits;
    this._onDidChangeDocument.fire({
      content: diskContent,
      edits: this._edits,
    });
  }

  /**
   * Called by VS Code to backup the edited document.
   *
   * These backups are used to implement hot exit.
   */
  async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
    await this.saveAs(destination, cancellation);

    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // noop
        }
      }
    };
  }
}

//------------------------------------------------------------------------------

export class HiresEditorProvider implements vscode.CustomEditorProvider<HiresDocument> {

  // private static newPawDrawFileId = 1;

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    // vscode.commands.registerCommand('catCustoms.pawDraw.new', () => {
    //   const workspaceFolders = vscode.workspace.workspaceFolders;
    //   if (!workspaceFolders) {
    //     vscode.window.showErrorMessage("Creating new Paw Draw files currently requires opening a workspace");
    //     return;
    //   }
    //
    //   const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, `new-${HiresEditorProvider.newPawDrawFileId++}.pawdraw`)
    //     .with({ scheme: 'untitled' });
    //
    //   vscode.commands.executeCommand('vscode.openWith', uri, HiresEditorProvider.viewType);
    // });

    return vscode.window.registerCustomEditorProvider(
      HiresEditorProvider.viewType,
      new HiresEditorProvider(context),
      {
        // For this demo extension, we enable `retainContextWhenHidden` which keeps the
        // webview alive even when it is not visible. You should avoid using this setting
        // unless is absolutely required as it does have memory overhead.
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      });
  }

  private static readonly viewType = 'rpwa2.BIN';
  private readonly webviews = new WebviewCollection()

  constructor(
    private readonly _context: vscode.ExtensionContext
  ) { }

  //#region CustomEditorProvider

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
          edits: e.edits,
          content: e.content,
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
    // Add the webview to our internal set of active webviews
    this.webviews.add(document.uri, webviewPanel);

    // Setup initial content for the webview
    webviewPanel.webview.options = {
      enableScripts: true,
    };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

    // Wait for the webview to be properly ready before we init
    webviewPanel.webview.onDidReceiveMessage(e => {
      if (e.type === 'ready') {
        if (document.uri.scheme === 'untitled') {
          this.postMessage(webviewPanel, 'init', {
            untitled: true,
            editable: true,
          });
        } else {
          const editable = vscode.workspace.fs.isWritableFileSystem(document.uri.scheme);

          this.postMessage(webviewPanel, 'init', {
            value: document.documentData,
            editable,
          });
        }
      }
    });
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

  //#endregion

  /**
   * Get the static HTML used for in our editor's webviews.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    // Local path to script and css for the webview
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this._context.extensionUri, 'out', 'webview.js'));

    // const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
    //   this._context.extensionUri, 'media', 'reset.css'));

    // const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
    //   this._context.extensionUri, 'media', 'vscode.css'));

    // const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
    //   this._context.extensionUri, 'media', 'pawDraw.css'));

    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this._context.extensionUri, 'src', 'display_view.css'));

    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce();

    // <link href="${styleResetUri}" rel="stylesheet" />
    // <link href="${styleVSCodeUri}" rel="stylesheet" />
    // <link href="${styleMainUri}" rel="stylesheet" />

    return /* html */`
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

        <!--
        <div class="drawing-canvas"></div>
        <canvas tabindex="-1" id="hires-canvas" width="560px" height="384px" style="image-rendering: pixelated"></canvas>
        -->

        <div id="top-div"></div>

        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  private _requestId = 1;
  private readonly _callbacks = new Map<number, (response: any) => void>();

  private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
    const requestId = this._requestId++;
    const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
    panel.webview.postMessage({ type, requestId, body });
    return p;
  }

  private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
    panel.webview.postMessage({ type, body });
  }

  private onMessage(document: HiresDocument, message: any) {
    switch (message.type) {
      case 'stroke': {
        document.makeEdit(message as HiresEdit);
        return;
      }
      case 'response': {
        const callback = this._callbacks.get(message.requestId);
        callback?.(message.body);
        return;
      }
    }
  }
}

//------------------------------------------------------------------------------
