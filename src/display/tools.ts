
export enum Cursor {
  None = -1,
  Bucket,
  Cross,
  Text,
  Hand,
  Lasso,
  Marquee,
  Move,
  Dropper,
  Brush,
  Eraser,
  Pencil,
  UpLeft,
  UpRight,
  Zoom,
  ZoomIn,
  ZoomOut
}

export enum Tool {
  None = -1,
  Select,
  Lasso,
  Text,
  Zoom,
  Eraser,
  Bucket,
  Dropper,
  Brush,
  Pencil,
  Line,
  FillRect,
  FrameRect,
  FillOval,
  FrameOval
}

export const ToolCursors: Cursor[] = [
  Cursor.Marquee,
  Cursor.Lasso,
  Cursor.Text,
  Cursor.ZoomIn,
  Cursor.Eraser,
  Cursor.Bucket,
  Cursor.Dropper,
  Cursor.Brush,
  Cursor.Pencil,
  Cursor.Cross,
  Cursor.Cross,
  Cursor.Cross,
  Cursor.Cross,
  Cursor.Cross
]

export const ToolIconNames: string[] = [
  require("../../media/tool-marquee.png"),
  require("../../media/tool-lasso.png"),
  require("../../media/tool-text.png"),
  require("../../media/tool-magnify.png"),
  require("../../media/tool-eraser.png"),
  require("../../media/tool-bucket.png"),
  require("../../media/tool-dropper.png"),
  require("../../media/tool-brush.png"),
  require("../../media/tool-pencil.png"),
  require("../../media/tool-line.png"),
  require("../../media/tool-rectfill.png"),
  require("../../media/tool-rectframe.png"),
  require("../../media/tool-ovalfill.png"),
  require("../../media/tool-ovalframe.png"),
]

export const ToolCursorNames: string[] = [
  require("../../media/curs-bucket.png"),
  require("../../media/curs-cross.png"),
  require("../../media/curs-text.png"),
  require("../../media/curs-hand.png"),
  require("../../media/curs-lasso.png"),
  require("../../media/curs-marquee.png"),
  require("../../media/curs-move.png"),
  require("../../media/curs-dropper.png"),
  require("../../media/curs-brush.png"),
  require("../../media/curs-eraser.png"),
  require("../../media/curs-pencil.png"),
  require("../../media/curs-up-left.png"),
  require("../../media/curs-up-right.png"),
  require("../../media/curs-zoom.png"),
  require("../../media/curs-zoom-in.png"),
  require("../../media/curs-zoom-out.png"),
]

export const ToolCursorOrigins = [
  {  x: 14, y: 15 },    // bucket
  {  x:  9, y:  9 },    // cross
  {  x:  9, y: 13 },    // text
  {  x:  9, y:  9 },    // hand
  {  x:  3, y: 16 },    // lasso
  {  x:  9, y:  9 },    // marquee
  {  x:  9, y:  9 },    // move
  {  x:  1, y: 15 },    // dropper
  {  x:  9, y:  9 },    // brush
  {  x:  9, y:  9 },    // eraser
  {  x:  5, y: 16 },    // pencil
  {  x:  9, y:  9 },    // up-left
  {  x:  9, y:  9 },    // up-right
  {  x:  6, y:  6 },    // zoom
  {  x:  6, y:  6 },    // zoom-in
  {  x:  6, y:  6 },    // zoom-out
]

export const ToolHelp: string[] = [
  // marquee help
  `<b><u>Select Tool</u></b> (s)<br>
  Select a rectangular area of pixels<br>
  <br>
  <b>Making a Selection:</b><br>
  Double-click to select all<br>
  Use shift key to constrain to square<br>
  Use option key to draw from center<br>
  Use command key to shink to minimum size<br>
  Use + key at any time to toggle crosshairs<br>
  <br>
  <b>Moving a Selection:</b><br>
  Drag selection to move pixels<br>
  Use option key to stamp a copy<br>
  Use control key to grab anywhere<br>
  Use shift key to constrain drag direction<br>
  Use arrow keys to move<br>
  <br>
  <b>Modifying a Selection:</b><br>
  Delete key to delete<br>
  Shift-h to flip horizontal<br>
  Shift-v to flip vertical<br>
  Shift-t to toggle transparency<br>
  Shift-x to XOR with foreground color<br>
  <br>
  <b>At any time:</b><br>
  Use x to XOR screen with foreground color<br>`,

  // lasso help
  `<b><u>Lasso Select Tool</u></b> (l)<br>
  Select a hand-drawn area of pixels<br>
  Background color area is removed<br>
  <br>
  Double-click to select all<br>
  <br>
  <b>Modifying a Selection:</b><br>
  Shift-p to pad outward<br>
  (See Select Tool for other moving and modifying)<br>`,

  // text help
  `<b><u>Text Tool</u></b> (t)<br>
  Draw text in foreground color<br>`,

  // zoom help
  `<b><u>Zoom Tool</u></b> (z)<br>
  Adjust the zoom level<br>
  Use shift key to zoom out<br>
  <br>
  <b>In zoom mode:</b><br>
  Use g key to toggle grid mode<br>
  Use control key to grab and scroll<br>
  Drag actual-size box center to move<br>
  Drag actual-size box corner to resize<br>
  <br>
  <b>At any time:</b><br>
  Use command key and mouse wheel<br>
  or 1,2,3,4,5,6,7,8 keys to zoom in/out<br>
  at current mouse position`,

  // eraser help
  `<b><u>Eraser Tool</u></b> (e)<br>
  Erase to background color<br>
  <br>
  Double-click to erase all<br>
  Use shift key to constrain direction<br>`,

  // bucket help
  `<b><u>Flood Fill Tool</u></b> (f)<br>
  Fill selected area with foreground color<br>`,

  // dropper help
  `<b><u>Dropper Tool</u></b> (tab)<br>
  Set foreground color from image pixels<br>
  <br>
  Use option key to select background color<br>
  Use tab key again to reselect previous tool<br>`,

  // brush help
  `<b><u>Brush Tool</u></b> (b)<br>
  Draw with brush shape in foreground color<br>
  <br>
  Use shift key to constrain direction<br>`,

  // pencil help
  `<b><u>Pencil Tool</u></b> (.)<br>
  Toggle pixels between foreground and background colors<br>
  <br>
  Use shift key to constrain direction<br>`,

  // line help
  `<b><u>Line Tool</u></b> (/)<br>
  Draw straight line in foreground color<br>
  <br>
  Use shift key to constrain direction<br>
  Use option key to draw from center<br>`,

  // rectfill help
  `<b><u>Rectangle Fill Tool</u></b> (r)<br>
  Fill rectangle in foreground color<br>
  <br>
  Use shift key to constrain to square<br>
  Use option key to draw from center<br>`,

  // rectframe help
  `<b><u>Rectangle Frame Tool</u></b> (shift-r)<br>
  Frame rectangle in foreground color<br>
  <br>
  Use shift key to constrain to square<br>
  Use option key to draw from center<br>`,

  // ovalfill help
  `<b><u>Oval Fill Tool</u></b> (o)<br>
  Fill oval in foreground color<br>
  <br>
  Use shift key to constrain to circle<br>
  Use option key to draw from center<br>`,

  // ovalframe help
  `<b><u>Oval Fill Tool</u></b> (shift-o)<br>
  Frame oval in foreground color<br>
  <br>
  Use shift key to constrain to circle<br>
  Use option key to draw from center<br>`,
]

export const ColorHelp: string = `
  <u>Colors</u><br>
  Click to set as foreground color<br>
  Use option key to set as background color<br>
  <br>
  <b>At any time:</b><br>
  Use left/right arrows to change foreground color<br>
  Use with option key to change background color<br>
`
