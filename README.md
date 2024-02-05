
### Features

* .dsk, .do, .po, .2mg, .hdv image files supported

### Known Problems

* After adding a new file or directory to the root of a drive image, the new file/directory appears in every mounted image instead of just in the target.  Clicking away from VSCode and then back updates all drive images to their correct state.  (Possibly a VSCode bug.)

#### Prodos:

* Sparse files are not directly supported and will be converted to their expanded form if copied.

#### DOS 3.3

* Non-sequential text files are not supported.
