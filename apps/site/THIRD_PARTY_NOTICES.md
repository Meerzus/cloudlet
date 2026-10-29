# Third-party notices — `apps/site`

The landing site's hero device mockups (`src/lib/devices.ts`, the "Hero device" and "Fold scene"
sections of `src/app/globals.css`, and the fold scene in `src/components/hero/device-stage.tsx`) adapt
device geometry, edge-ring palettes and the foldable's fold animation from **react-mockframe**
(https://github.com/mbdev3/react-mockframe, commit `d1e7e272ea94928409b7b7e992feb907129d082f`), whose
device frame styles are themselves adapted from **Marvel devices.css**
(https://github.com/marvelapp/devices.css). The source's per-device markup was replaced by one
parametric shell that morphs between devices; values were transcribed, not the files copied whole.
These notices cover only the site; the `@cloudlet/toast` package contains no third-party code.

## react-mockframe

```text
MIT License

Copyright (c) 2026 Mohammed Banani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Marvel devices.css

```text
MIT License — Copyright (c) 2014 Marvelapp

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the above copyright notice and this permission
notice being included in all copies or substantial portions of the Software.
```
