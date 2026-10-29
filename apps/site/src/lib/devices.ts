/**
 * Hero device catalog: one parametric shell that morphs between every device.
 *
 * Geometry, edge rings and palettes are adapted from react-mockframe
 * (https://github.com/mbdev3/react-mockframe, commit d1e7e27, MIT, Copyright (c) 2026
 * Mohammed Banani), whose frame styles are adapted from Marvel devices.css
 * (https://github.com/marvelapp/devices.css, MIT, Copyright (c) 2014 Marvelapp). The laptop's
 * geometry is our own measurement of the 16" MacBook Pro with PROLED XDR Display (see `MBP`).
 * Their per-device DOM is replaced here by one set of numbers per shape, so any
 * two devices can morph into each other. All lengths are the source's natural px.
 * No logos, no product names in the interface (LANDING §5).
 */

export type DeviceId = 'laptop' | 'phone' | 'foldable' | 'tablet';
export type FoldPose = 'closed' | 'open';
export type ShellId = 'laptop' | 'phone' | 'tablet' | 'foldable-closed' | 'foldable-open';
export type Finish = 'light' | 'dark';
/** Page skeleton drawn inside the screen (`components/frame/frame-skeleton.tsx`). */
export type SkeletonKind = 'desktop' | 'mobile' | 'tablet';

export const DEVICE_IDS: readonly DeviceId[] = ['laptop', 'phone', 'foldable', 'tablet'];

export function shellOf(device: DeviceId, pose: FoldPose): ShellId {
  return device === 'foldable' ? `foldable-${pose}` : device;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ButtonId = 'action' | 'volume-up' | 'volume-down' | 'side' | 'top-1' | 'top-2' | 'left-1';
export const BUTTON_IDS: readonly ButtonId[] = ['action', 'volume-up', 'volume-down', 'side', 'top-1', 'top-2', 'left-1'];

export type ExtraId = 'base' | 'earpiece' | 'spine' | 'strips' | 'hinge';

export interface ShellGeometry {
  /**
   * The page viewport inside the screen (CSS px of the iframe): readability over the device's real
   * points. Laptop and tablet stay ≥ 768 px wide (desktop layout, toasts on top) but small enough that
   * toasts render at ~0.9 of their size in the hero.
   */
  readonly viewport: Size;
  /** The screen in the source's px. */
  readonly screen: Size;
  /** Bezel around the screen: top, right, bottom, left. */
  readonly bezel: readonly [number, number, number, number];
  /** Corner radii (top-left, top-right, bottom-right, bottom-left). */
  readonly bodyRadius: readonly [number, number, number, number];
  readonly screenRadius: readonly [number, number, number, number];
  /** Everything the device occupies (base, feet, spine), the body placed at `body`. */
  readonly footprint: Size;
  readonly body: { readonly x: number; readonly y: number };
  /** Notch, Dynamic Island or punch-hole: a rect in body coordinates, corner radii and the lens. */
  readonly cutout: Rect & {
    readonly radius: readonly [number, number, number, number];
    readonly lens: { readonly x: number; readonly y: number; readonly size: number };
  };
  /** Widths of the inset edge rings, outermost first (colours come from the finish). */
  readonly rings: readonly number[];
  /** A soft inner glow of the glass: blur and spread, or none. */
  readonly glass: { readonly blur: number; readonly spread: number } | null;
  readonly buttons: Partial<Record<ButtonId, Rect>>;
  readonly extras: readonly ExtraId[];
  readonly skeleton: SkeletonKind | 'by-width';
}

const PHONE_RINGS = [0.667, 1.333, 2, 2.667, 3.333, 4, 4.333, 4.667, 5, 5.333, 5.667, 6.333];
const DUO_CLOSED_RINGS = [
  0.333, 0.667, 1, 1.333, 1.667, 2, 2.333, 2.667, 3, 3.333, 4, 4.667, 5.333, 6, 6.333, 7, 7.667, 8.333, 9, 9.667,
  10.667, 12, 13.667, 15.667,
];
const DUO_OPEN_RINGS = [0.667, 1.333, 1.667, 2, 2.333, 2.667, 3, 3.333, 3.667, 4, 4.333, 4.667, 5, 6, 7, 16.667, 17.333, 18];

/** Duo outer (closed) display and inner (open) display, from Apple's bezels at 1px = 1pt. */
const DUO_OUTER = { sw: 466, sh: 678, bx: 41.67, by: 32, spine: 11.67 };
const DUO_INNER = { sw: 951, sh: 669, bx: 41.33, by: 41.33 };

/**
 * 16" MacBook Pro with PROLED XDR Display, measured off Apple's straight-on product render and
 * scaled so the screen keeps the hero's 960 px width; the lid's tilt in the render is undone
 * from the panel's 3472×2266 aspect. The screen runs up to an even bezel as in Apple's
 * promo shots, the Dynamic Island floating in it. Bezels: top, sides, bottom.
 */
const MBP = { sw: 960, sh: 626.5, top: 12.6, side: 12.6, bottom: 20 };
const MBP_BODY = { width: MBP.sw + 2 * MBP.side, height: MBP.sh + MBP.top + MBP.bottom };

const r4 = (value: number) => [value, value, value, value] as const;

export const SHELLS: Record<ShellId, ShellGeometry> = {
  // 16" MacBook Pro with PROLED XDR Display at 0.553 scale (1736×1133 pt → 960×626.5): no notch, a Dynamic
  // Island pill in the screen under an even bezel; slab base with scoop, feet.
  laptop: {
    viewport: { width: 900, height: 587 },
    screen: { width: MBP.sw, height: MBP.sh },
    bezel: [MBP.top, MBP.side, MBP.bottom, MBP.side],
    bodyRadius: [23, 23, 0, 0],
    screenRadius: r4(10.4),
    footprint: { width: MBP_BODY.width + 212, height: MBP_BODY.height + 31.7 + 7 },
    body: { x: 106, y: 0 },
    cutout: {
      x: (MBP_BODY.width - 34) / 2,
      y: MBP.top + 4,
      width: 34,
      height: 18,
      radius: r4(9),
      lens: { x: 25, y: 9, size: 4 },
    },
    rings: [0.35, 0.7, 1, 2.5, 6],
    glass: null,
    buttons: {},
    extras: ['base'],
    skeleton: 'desktop',
  },
  // iPhone 18 Pro, 402×874 pt: titanium band rings, Dynamic Island, Action + volume left, side button right.
  phone: {
    viewport: { width: 402, height: 874 },
    screen: { width: 402, height: 874 },
    bezel: [15.67, 15.83, 15.67, 15.83],
    bodyRadius: r4(80.5),
    screenRadius: r4(63.6),
    footprint: { width: 433.66, height: 905.34 },
    body: { x: 0, y: 0 },
    cutout: { x: (433.66 - 94) / 2, y: 30, width: 94, height: 36, radius: r4(18), lens: { x: 76, y: 18, size: 10 } },
    rings: PHONE_RINGS,
    glass: { blur: 3, spread: 9.3 },
    buttons: {
      action: { x: -3, y: 186, width: 3, height: 41.67 },
      'volume-up': { x: -3, y: 258.33, width: 3, height: 67.67 },
      'volume-down': { x: -3, y: 344, width: 3, height: 67.67 },
      side: { x: 433.66, y: 281.67, width: 2.67, height: 107 },
    },
    extras: ['earpiece'],
    skeleton: 'mobile',
  },
  // 13" iPad Pro in landscape at 0.496 scale (1376×1032 pt → 683×512); camera on the long (top) edge.
  tablet: {
    viewport: { width: 800, height: 600 },
    screen: { width: 683, height: 512 },
    bezel: r4(22.33),
    bodyRadius: r4(37.25),
    screenRadius: r4(14.4),
    footprint: { width: 727.66, height: 556.66 },
    body: { x: 0, y: 0 },
    cutout: { x: 727.66 * 0.47 - 2.5, y: 9.4, width: 5, height: 5, radius: r4(2.5), lens: { x: 2.5, y: 2.5, size: 5 } },
    rings: [0.5, 1, 1.75, 2.5],
    glass: { blur: 1, spread: 3 },
    buttons: {
      'left-1': { x: -1.5, y: 36, width: 1.5, height: 30.8 },
      'top-1': { x: 50.1, y: -1.5, width: 25.8, height: 1.5 },
      'top-2': { x: 81.4, y: -1.5, width: 25.8, height: 1.5 },
    },
    extras: [],
    skeleton: 'tablet',
  },
  // Foldable, closed: the 466×678 pt outer display; the other half's spine peeks out on the hinge side.
  'foldable-closed': {
    viewport: { width: DUO_OUTER.sw, height: DUO_OUTER.sh },
    screen: { width: DUO_OUTER.sw, height: DUO_OUTER.sh },
    bezel: [16, 16, 16, 25.67 - DUO_OUTER.spine],
    bodyRadius: [4, 73.97, 73.97, 4],
    screenRadius: [7.97, 58.04, 58.04, 7.97],
    footprint: { width: DUO_OUTER.sw + DUO_OUTER.bx, height: DUO_OUTER.sh + DUO_OUTER.by },
    body: { x: DUO_OUTER.spine, y: 0 },
    cutout: {
      x: DUO_OUTER.sw + DUO_OUTER.bx - DUO_OUTER.spine - 45.67 - 36,
      y: 45.83,
      width: 36,
      height: 36,
      radius: r4(18),
      lens: { x: 18, y: 18, size: 12 },
    },
    rings: DUO_CLOSED_RINGS,
    glass: null,
    buttons: {
      side: { x: DUO_OUTER.sw + DUO_OUTER.bx - DUO_OUTER.spine, y: 202.33, width: 2.67, height: 112.67 },
      'top-1': { x: DUO_OUTER.sw + DUO_OUTER.bx - DUO_OUTER.spine - 207 - 65.67, y: -2.67, width: 65.67, height: 2.67 },
      'top-2': { x: DUO_OUTER.sw + DUO_OUTER.bx - DUO_OUTER.spine - 126 - 65.67, y: -2.67, width: 65.67, height: 2.67 },
    },
    extras: ['spine', 'strips'],
    skeleton: 'by-width',
  },
  // Foldable, open: the 951×669 pt inner display with hinge slots in the bezel. Its FaceTime camera sits
  // under the display (as in Apple's promo shots), so the cutout shrinks to nothing where the hole was.
  'foldable-open': {
    viewport: { width: DUO_INNER.sw, height: DUO_INNER.sh },
    screen: { width: DUO_INNER.sw, height: DUO_INNER.sh },
    bezel: r4(20.67),
    bodyRadius: r4(75.11),
    screenRadius: r4(53.49),
    footprint: { width: DUO_INNER.sw + DUO_INNER.bx, height: DUO_INNER.sh + DUO_INNER.by },
    body: { x: 0, y: 0 },
    cutout: {
      x: DUO_INNER.sw + DUO_INNER.bx - 278.2 - 14.75,
      y: 47.21 + 14.75,
      width: 0,
      height: 0,
      radius: r4(0),
      lens: { x: 0, y: 0, size: 0 },
    },
    rings: DUO_OPEN_RINGS,
    glass: null,
    buttons: {
      side: { x: DUO_INNER.sw + DUO_INNER.bx, y: 202.33, width: 2.67, height: 112.67 },
      'top-1': { x: DUO_INNER.sw + DUO_INNER.bx - 206.67 - 65.67, y: -2.67, width: 65.67, height: 2.67 },
      'top-2': { x: DUO_INNER.sw + DUO_INNER.bx - 125.67 - 65.67, y: -2.67, width: 65.67, height: 2.67 },
    },
    extras: ['hinge'],
    skeleton: 'by-width',
  },
};

/** The body's outer size: screen plus bezels. */
export function bodySize(shell: ShellGeometry): Size {
  const [top, right, bottom, left] = shell.bezel;
  return { width: shell.screen.width + left + right, height: shell.screen.height + top + bottom };
}

/** Which skeleton a shell shows: the foldable follows its width, like a responsive page. */
export function skeletonOf(shell: ShellId): SkeletonKind {
  const kind = SHELLS[shell].skeleton;
  if (kind !== 'by-width') return kind;
  return SHELLS[shell].viewport.width < 768 ? 'mobile' : 'tablet';
}

/* ---------------------------------------------------------------- finishes */

export interface FinishPalette {
  /** Ring colours, one per ring of the shell, outermost first. */
  readonly rings: readonly string[];
  readonly glass: string;
  readonly bezel: string;
  /** Side buttons. */
  readonly button: string;
  /** Laptop base, scoop and feet; foldable spine, strips and hinge. */
  readonly parts?: Readonly<Record<string, string>>;
}

const PHONE_BLACK = ['#141314', '#161516', '#1b191b', '#222022', '#2e2c2e', '#444144', '#605d60', '#747173', '#747174', '#4f4c4f', '#272527', '#232223'];
const PHONE_SILVER = ['#727272', '#8c8c8c', '#a4a4a4', '#b9b9b9', '#c9c9c9', '#d7d7d7', '#e2e2e2', '#e8e8e8', '#e8e8e8', '#d4d4d4', '#aaaaaa', '#777777'];
const DUO_NIGHT_K = ['#4c5564', '#252d3a', '#121821', '#1a202a', '#333d4c', '#b9d1f3', '#a8c3ea', '#90aacf', '#778eaf', '#5f738e', '#45556c', '#2d3949', '#1e2631', '#151b24', '#10161d', '#030406', '#010102', '#1c2028', '#181b21', '#111318', '#0b0d10', '#040506', '#000000', '#000000'];
const DUO_WHITE_K = ['#6c6d6d', '#616160', '#444442', '#383836', '#41403d', '#6d6a65', '#f8f8f7', '#f7f6f5', '#f2f2f1', '#edecea', '#e2e1df', '#d2d1cc', '#bab8b1', '#a09d95', '#8c8982', '#686661', '#3f3e3d', '#1b1d21', '#3a3f4a', '#25292f', '#1a1d21', '#0c0d0f', '#010101', '#000000'];
const DUO_NIGHT_O = ['#4f5b72', '#141b27', '#111826', '#252f42', '#46546e', '#637594', '#7d92b9', '#98afda', '#697b9b', '#232c3d', '#03070e', '#141618', '#252628', '#434345', '#414243', '#2f2f31', '#2a2a2c', '#141516'];
const DUO_WHITE_O = ['#74726e', '#4e4c46', '#615f59', '#82807a', '#b3b1aa', '#d6d4ce', '#eae8e3', '#f5f4f0', '#dbd9d3', '#837f77', '#23211c', '#1c1d1e', '#363738', '#4c4d4f', '#48494a', '#343536', '#2f3031', '#171819'];

const sideButton = (stops: readonly string[]) =>
  `linear-gradient(to right, ${stops[0]} 0%, ${stops[2]} 25%, ${stops[3]} 50%, ${stops[5]} 68%, ${stops[7]} 80%, ${stops[9]} 100%)`;

const DUO_NIGHT_PARTS = {
  spine: 'linear-gradient(to right, #2b3545 0.33px, #1a2233 1px, #47556d 1.67px, #7e94b5 2.33px, #6b7d9a 3px, #404b5e 3.67px, #2c3546 4.33px, #212837 5px, #1d2330 5.67px, #1c232f 6.33px, #1c222e 7px, #1b212d 7.67px, #1c222e 8.33px, #1b222e 9px, #1c232f 9.67px, #1e2531 10.33px, #1e2531 11px, #26303f 11.67px)',
  stripLeft: 'linear-gradient(to right, #26303e 0.33px, #89a3c7 1px, #262f3c 1.67px, #020305 2.33px, #010203 3px, #000102 3.67px, #000102 4.33px, #000101 5px, #07080a 5.67px, #21252e 6.33px, #14171d 7px, #0f1115 7.67px, #0b0c0f 8.33px, #07080a 9px, #040405 9.67px, #010101 10.33px, #000 11px)',
  stripRight: 'linear-gradient(to left, #495260 0.33px, #0b0f14 1px, #050607 1.67px, #030305 2.33px, #232c38 3px, #44546a 3.67px, #5b6f8a 4.33px, #8099bb 5px, #acc5e9 5.67px, #1e232b 6.33px, #000104 7px, #0f1217 7.67px, #1e232b 8.33px, #13161b 9px, #0e1014 9.67px, #0a0c0f 10.33px, #060709 11px, #030304 11.67px, #010101 12.33px, #000 13px)',
  stripBottom: 'linear-gradient(to top, #454e5b 0.33px, #191e25 1px, #111317 1.67px, #090a0d 2.33px, #7d93b3 3px, #8ba4c8 3.67px, #5d708c 4.33px, #3e4c61 5px, #2e394a 5.67px, #1a2029 6.33px, #0b0c0f 7px, #111318 7.67px, #1d2129 8.33px, #13161b 9px, #0e1014 9.67px, #090b0e 10.33px, #060708 11px, #020303 11.67px, #010101 12.33px, #000 13px)',
  hingeSlot: '#1e1f20',
  hingeHighlight: '#ceddf7',
  openBezel: '#030303',
} as const;

const DUO_WHITE_PARTS = {
  spine: 'linear-gradient(to right, #615f5e 0.33px, #53514c 1px, #7f7c75 1.67px, #c5c2bb 2.33px, #97948d 3px, #636159 3.67px, #5a5750 4.33px, #5a574f 5px, #5f5b53 5.67px, #6e6b62 6.33px, #817e74 7px, #969389 7.67px, #a9a69d 8.33px, #b7b4ab 9px, #bfbcb4 9.67px, #bebbb4 10.33px, #b1aea7 11px, #82817c 11.67px)',
  stripLeft: 'linear-gradient(to right, #4e4d4b 0.33px, #9a9993 1px, #55534f 1.67px, #d4d2ce 2.33px, #e8e7e5 3px, #ebeae8 3.67px, #ececea 4.33px, #edecea 5px, #2d2c2d 5.67px, #3f4550 6.33px, #282b32 7px, #1e2126 7.67px, #16181c 8.33px, #0e0f11 9px, #070809 9.67px, #020203 10.33px, #000 11px)',
  stripRight: 'linear-gradient(to left, #3f3e3d 0.33px, #232220 1px, #33312d 1.67px, #474440 2.33px, #908d86 3px, #c7c4be 3.67px, #d7d5d0 4.33px, #e5e4e0 5px, #f1f0ee 5.67px, #746f69 6.33px, #54504c 7px, #333539 7.67px, #3b404b 8.33px, #262930 9px, #1c1f24 9.67px, #14161a 10.33px, #0d0e10 11px, #060708 11.67px, #010202 12.33px, #000 13px)',
  stripBottom: 'linear-gradient(to top, #41403f 0.33px, #292725 1px, #383532 1.67px, #4e4944 2.33px, #d1cfcc 3px, #e5e4e1 3.67px, #d4d2ce 4.33px, #b9b6af 5px, #96938b 5.67px, #65635e 6.33px, #464543 7px, #1d1f23 7.67px, #373c45 8.33px, #25282e 9px, #1b1e23 9.67px, #131418 10.33px, #0b0c0e 11px, #050506 11.67px, #010101 12.33px, #000 13px)',
  hingeSlot: '#212223',
  hingeHighlight: '#dbdbdb',
  openBezel: '#040404',
} as const;

const DUO_NIGHT_BUTTON = 'linear-gradient(to right, #25313f 6.2%, #2e3b4d 18.8%, #324156 31.2%, #37475e 43.8%, #3d4f68 56.2%, #4b5f78 68.8%, #a1b7da 81.2%, #03070d 93.8%)';
const DUO_WHITE_BUTTON = 'linear-gradient(to right, #83817c 6.2%, #9d998f 18.8%, #a5a298 31.2%, #adaaa0 43.8%, #b6b3aa 56.2%, #cfcdc6 68.8%, #ffffff 81.2%, #444038 93.8%)';

/** Light theme: silver / Star White; dark theme: Space Black / Black / Night Sky. */
export const FINISHES: Record<ShellId, Record<Finish, FinishPalette>> = {
  laptop: {
    dark: {
      rings: ['#3a383a', '#807e80', '#656366', '#424043', '#232323'],
      glass: 'transparent',
      bezel: '#000',
      button: 'transparent',
      parts: {
        base: 'linear-gradient(to bottom, #b4b2b5 0, #686669 0.7px, #5d5b5e 20%, #5f5d60 42%, #4e4c4f 58%, #3c3a3d 68%, #2a282a 78%, #1f1d1f 86%, #2a282b 94%, #3e3c3f 100%)',
        scoop: 'linear-gradient(to bottom, #a29fa3 0%, #8f8d90 45%, #747275 100%)',
        scoopTop: '#a29fa3',
        foot: 'linear-gradient(to bottom, #1c1a1c 0%, #3a383b 70%, #2a282b 100%)',
      },
    },
    light: {
      rings: ['#d8d9db', '#b7b8ba', '#9a9b9d', '#9c9d9f', '#232323'],
      glass: 'transparent',
      bezel: '#000',
      button: 'transparent',
      parts: {
        base: 'linear-gradient(to bottom, #f0f1f3 0, #d6d7d9 0.7px, #d0d1d3 20%, #cecfd1 42%, #c3c4c6 55%, #a8a9ab 64%, #8e8f91 74%, #858688 84%, #9fa0a2 92%, #c9cacc 100%)',
        scoop: 'linear-gradient(to bottom, #e6e7e9 0%, #ebeced 50%, #f3f4f6 100%)',
        scoopTop: '#e6e7e9',
        foot: 'linear-gradient(to bottom, #6e6f71 0%, #a3a4a6 70%, #8e8f91 100%)',
      },
    },
  },
  phone: {
    dark: { rings: PHONE_BLACK, glass: '#3d3d3d', bezel: '#000', button: sideButton(PHONE_BLACK) },
    light: { rings: PHONE_SILVER, glass: '#3d3d3d', bezel: '#000', button: sideButton(PHONE_SILVER) },
  },
  tablet: {
    dark: {
      rings: ['#4a484c', '#736e71', '#3b3739', '#2d2b2e'],
      glass: '#1d1d1d',
      bezel: '#000',
      button: 'linear-gradient(to right, #413e40 0%, #2f2d30 15%, #555358 35%, #77767d 55%, #979397 78%, #333134 100%)',
    },
    light: {
      rings: ['#9e9fa0', '#cccdce', '#959697', '#818283'],
      glass: '#2e2e2e',
      bezel: '#000',
      button: 'linear-gradient(to right, #8d8e8f 0%, #818283 15%, #b1b2b3 35%, #c0c1c2 55%, #c3c4c5 78%, #646566 100%)',
    },
  },
  'foldable-closed': {
    dark: { rings: DUO_NIGHT_K, glass: 'transparent', bezel: '#000', button: DUO_NIGHT_BUTTON, parts: DUO_NIGHT_PARTS },
    light: { rings: DUO_WHITE_K, glass: 'transparent', bezel: '#000', button: DUO_WHITE_BUTTON, parts: DUO_WHITE_PARTS },
  },
  'foldable-open': {
    dark: { rings: DUO_NIGHT_O, glass: 'transparent', bezel: DUO_NIGHT_PARTS.openBezel, button: DUO_NIGHT_BUTTON, parts: DUO_NIGHT_PARTS },
    light: { rings: DUO_WHITE_O, glass: 'transparent', bezel: DUO_WHITE_PARTS.openBezel, button: DUO_WHITE_BUTTON, parts: DUO_WHITE_PARTS },
  },
};

/** Every shell renders the same number of rings, so CSS can interpolate the shadow lists pairwise. */
export const RING_SLOTS = 24;

/**
 * The bezel's edge as one inset box-shadow list of exactly RING_SLOTS + 1 entries (rings, then
 * the glass glow). Missing rings repeat the last width in transparent, which CSS interpolates
 * smoothly into the next shell's rings.
 */
export function ringShadow(shell: ShellId, finish: Finish): string {
  const geometry = SHELLS[shell];
  const palette = FINISHES[shell][finish];
  const last = geometry.rings.at(-1) ?? 0;
  const rings: string[] = [];
  for (let index = 0; index < RING_SLOTS; index += 1) {
    const width = geometry.rings[index];
    rings.push(width === undefined ? `inset 0 0 0 ${last}px transparent` : `inset 0 0 0 ${width}px ${palette.rings[index]}`);
  }
  const glass = geometry.glass;
  rings.push(glass ? `inset 0 0 ${glass.blur}px ${glass.spread}px ${palette.glass}` : 'inset 0 0 0 0 transparent');
  return rings.join(', ');
}

/* ---------------------------------------------------------------- fold */

/**
 * Fold animation from react-mockframe's iPhone Duo renderer: two 3D leaves hinged in the
 * middle under the perspective fitted to Apple's half-open render (~29.8° per half at
 * ~2139 px). Closing swings the left leaf over; its back is the outer display.
 */
export const FOLD = {
  durationMs: 900,
  easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
  perspective: 2139,
  /** The hinge's x in each pose's footprint. */
  hinge: { closed: DUO_OUTER.spine, open: (DUO_INNER.sw + DUO_INNER.bx) / 2 },
  /** Left leaf angle per pose (the right leaf stays flat). */
  leftAngle: { closed: 180, open: 0 },
  outer: DUO_OUTER,
  inner: DUO_INNER,
} as const;
